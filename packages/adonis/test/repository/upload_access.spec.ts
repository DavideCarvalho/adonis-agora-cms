import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createMediaAdapter } from '../../src/integrations/media.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const role = (user: unknown) => (user as { role?: string } | null)?.role;

const config = defineConfig({
  tenancy: { strategy: 'row' },
  collections: [
    collection('assets', {
      access: {
        read: ({ user }) =>
          user ? { field: 'owner', operator: 'equals', value: role(user) ?? '' } : false,
      },
      fields: [fields.text('owner')],
    }),
    collection('posts', {
      access: { read: () => true },
      fields: [fields.text('title'), fields.upload('cover', { relationTo: 'assets' })],
    }),
  ],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

async function setup() {
  kit = await createTestCms({ config });
  const asked: { ids: readonly string[]; context: unknown }[] = [];
  const media = createMediaAdapter(async (ids, context) => {
    asked.push({ ids, context });
    return ids.map((id) => ({ id, url: `/files/${id}` }));
  });
  const as = (user: unknown, tenant: string | null = 't1') =>
    createCms({ config, client: kit.client, media, user: user as never, tenant });
  const admin = as({ id: 'a', role: 'admin' });
  const mine = await as({ id: 'e', role: 'editor' })
    .collection('assets')
    .create({ owner: 'editor' } as never, { overrideAccess: true });
  const theirs = await admin.collection('assets').create({ owner: 'admin' } as never);
  const elsewhere = await as({ id: 'a', role: 'admin' }, 't2')
    .collection('assets')
    .create({ owner: 'editor' } as never);
  const post = await admin
    .collection('posts')
    .create({ title: 'p', cover: theirs.id } as never, { overrideAccess: true });
  const own = await admin
    .collection('posts')
    .create({ title: 'q', cover: mine.id } as never, { overrideAccess: true });
  const cross = await admin
    .collection('posts')
    .create({ title: 'x', cover: elsewhere.id } as never, { overrideAccess: true });
  asked.length = 0;
  return {
    as,
    asked,
    ids: { mine: mine.id, theirs: theirs.id, elsewhere: elsewhere.id },
    post,
    own,
    cross,
  };
}

describe('uploads into a collection follow its rules', () => {
  test('an upload the reader cannot read is never resolved', async () => {
    const { as, asked, ids, post, own } = await setup();
    const editor = as({ id: 'e', role: 'editor' });
    const hidden = await editor.collection('posts').findByID(post.id);
    expect(hidden?.cover).toEqual({ id: ids.theirs });
    const visible = await editor.collection('posts').findByID(own.id);
    expect(visible?.cover).toEqual({ id: ids.mine, url: `/files/${ids.mine}` });
    // The adapter was never asked for the one the editor cannot read, and got the reader.
    expect(asked.flatMap((call) => call.ids)).not.toContain(ids.theirs);
    expect(asked[0]?.context).toMatchObject({ user: { id: 'e' }, tenant: 't1' });
  });

  test('anonymous readers and other tenants get the bare shape', async () => {
    const { as, ids, own, cross } = await setup();
    const anonymous = await as(null).collection('posts').findByID(own.id);
    expect(anonymous?.cover).toEqual({ id: ids.mine });
    // An id pointing into another tenant never resolves, whoever reads.
    const admin = await as({ id: 'a', role: 'admin' }).collection('posts').findByID(cross.id, {
      overrideAccess: true,
    });
    expect(admin?.cover).toEqual({ id: ids.elsewhere });
  });

  test('overrideAccess resolves every upload of the tenant', async () => {
    const { as, ids, post } = await setup();
    const doc = await as(null).collection('posts').findByID(post.id, { overrideAccess: true });
    expect(doc?.cover).toEqual({ id: ids.theirs, url: `/files/${ids.theirs}` });
  });

  test('a resolved upload stored in a snapshot is checked again for the reader', async () => {
    const { as, ids, post } = await setup();
    const editor = as({ id: 'e', role: 'editor' });
    const version = await editor.collection('posts').version(post.id, 1);
    const doc = (version?.snapshot as { doc: Record<string, unknown> } | undefined)?.doc;
    expect(doc?.cover).toEqual({ id: ids.theirs });
  });
});
