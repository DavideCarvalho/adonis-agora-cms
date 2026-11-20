import { afterEach, describe, expect, test } from 'vitest';
import { createApiToken, listApiTokens } from '../../src/auth/api_tokens.js';
import { cmsAuth, registerAuthRoutes, usersPlugin } from '../../src/auth/builtin.js';
import { syncCmsSchema } from '../../src/db/sync.js';
import { collection, defineConfig, fields, withPlugins } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const kits: TestCms[] = [];
afterEach(async () => {
  await Promise.all(kits.map((kit) => kit.destroy()));
  kits.length = 0;
});

const config = withPlugins(
  defineConfig({
    versions: { drafts: true },
    collections: [collection('notes', { fields: [fields.text('title')] })],
  }),
  [usersPlugin()],
);

async function setup() {
  const kit = await createTestCms({ config });
  kits.push(kit);
  const cms = createCms({ config, client: kit.client, user: { id: 'u1' } });
  return { kit, cms: cms as never as typeof cms & { collection(slug: string): any } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('created/updated timestamps on the CMS-owned tables', () => {
  test('a schedule keeps its creation date when rescheduled and moves its update date', async () => {
    const { cms } = await setup();
    const notes = cms.collection('notes');
    const note = await notes.create({ title: 'X' }, { draft: true });

    const first = await notes.schedule(note.id, { at: new Date('2999-01-01'), action: 'publish' });
    expect(first.createdAt).toBeInstanceOf(Date);
    expect(first.updatedAt?.getTime()).toBe(first.createdAt?.getTime());

    await tick();
    await notes.schedule(note.id, { at: new Date('2999-06-01'), action: 'unpublish' });
    const read = await notes.scheduled(note.id);
    expect(read.createdAt.getTime()).toBe(first.createdAt?.getTime());
    expect(read.updatedAt.getTime()).toBeGreaterThan(first.createdAt?.getTime() ?? 0);

    // The JSON the REST endpoint answers with: ISO strings.
    const json = JSON.parse(JSON.stringify(read));
    expect(json.createdAt).toBe(first.createdAt?.toISOString());
    expect(typeof json.updatedAt).toBe('string');
  });

  test('a schedule written before the columns existed reads back with null dates', async () => {
    const { kit, cms } = await setup();
    const notes = cms.collection('notes');
    const note = await notes.create({ title: 'X' }, { draft: true });
    await kit.db('cms_document_schedules').insert({
      collection: 'notes',
      document_id: note.id,
      action: 'publish',
      run_at: '2999-01-01T00:00:00.000Z',
    });

    const read = await notes.scheduled(note.id);
    expect(read).toMatchObject({ action: 'publish', createdAt: null, updatedAt: null });
    expect(JSON.parse(JSON.stringify(read))).toMatchObject({ createdAt: null, updatedAt: null });
  });

  test('api tokens expose when they were issued', async () => {
    const { cms } = await setup();
    const before = Date.now();
    await createApiToken(cms.repoContext(), { name: 'site' });
    const [token] = await listApiTokens(cms.repoContext());
    expect(token?.createdAt).toBeInstanceOf(Date);
    expect(token?.createdAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  test('a password credential records its creation date', async () => {
    const { kit, cms } = await setup();
    const routes = new Map<string, (context: unknown) => Promise<unknown>>();
    const add =
      (method: string) => (path: string, handler: (context: unknown) => Promise<unknown>) =>
        void routes.set(`${method} ${path}`, handler);
    registerAuthRoutes(
      { get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') },
      cms as never,
      cmsAuth({ secret: 'x'.repeat(32) }),
      { prefix: '/api/cms', adminPath: '/admin' },
    );

    await routes.get('POST /api/cms/auth/first-user')?.({
      params: {},
      request: {
        body: () => ({ email: 'a@b.test', password: 'a-long-password', name: 'A' }),
        header: () => undefined,
      },
      response: { header: () => {}, status: () => ({ json: () => {} }) },
    });

    const row = await kit.db('cms_auth_credentials').first();
    expect(row?.created_at).toBeTruthy();
    expect(row?.created_at).toBe(row?.updated_at);
  });

  test('sync adds the new columns to an existing table as nullable, keeping old rows', async () => {
    const { kit } = await setup();
    await kit.db.schema.alterTable('cms_document_schedules', (table) => {
      table.dropColumn('created_at');
      table.dropColumn('updated_at');
    });
    await kit.db('cms_document_schedules').insert({
      collection: 'notes',
      document_id: 1,
      action: 'publish',
      run_at: '2999-01-01T00:00:00.000Z',
    });

    await syncCmsSchema(kit.client, kit.spec, { engine: kit.engine });

    const columns = await kit.introspect();
    const table = columns.tables.find((item) => item.name === 'cms_document_schedules');
    const created = table?.columns.find((column) => column.name === 'created_at');
    expect(created?.nullable).toBe(true);
    const row = await kit.db('cms_document_schedules').first();
    expect(row).toMatchObject({ action: 'publish', created_at: null, updated_at: null });
  });
});
