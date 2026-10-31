import knexFactory, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { diffSchema } from '../../src/db/diff.js';
import { introspect } from '../../src/db/introspect/index.js';
import { dropCmsTables, syncCmsSchema } from '../../src/db/sync.js';
import type { CmsKnex } from '../../src/db/types.js';
import { planIsEmpty } from '../../src/db/types.js';
import {
  collection,
  defineConfig,
  fields,
  findRedirect,
  redirectsPlugin,
  withPlugins,
} from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { compileSchema } from '../../src/schema/compile.js';
import type { Engine } from '../../src/schema/types.js';

const baseConfig = defineConfig({
  db: { id: 'uuid', tablePrefix: 'cms_it_' },
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR' },
  collections: [
    collection('posts', {
      fields: [
        fields.text('title', { required: true, maxLength: 120 }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.richText('body', { localized: true }),
        fields.select('status', {
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
        fields.array('tags', { fields: [fields.text('label')] }),
        fields.blocks('layout', {
          blocks: [{ slug: 'hero', fields: [fields.text('heading', { required: true })] }],
        }),
      ],
    }),
  ],
  globals: [{ slug: 'settings', fields: [fields.text('siteName')] }],
});

/* What the panel relies on, on the engines production uses: SQLite forgives what these do not. */
const workflowConfig = withPlugins(
  defineConfig({
    db: { id: 'uuid', tablePrefix: 'cms_wf_' },
    versions: { drafts: true },
    collections: [
      collection('notes', {
        fields: [
          fields.tabs('main', {
            tabs: [{ label: 'One', fields: [fields.text('title', { required: true })] }],
          }),
          fields.select('kind', {
            options: [
              { label: 'Plain', value: 'plain' },
              { label: 'Link', value: 'link' },
            ],
          }),
        ],
      }),
    ],
  }),
  [redirectsPlugin()],
);

function suite(engine: Engine, clientName: string, envVar: string) {
  const url = process.env[envVar];
  const run = describe.skipIf(!url);

  run(`${engine} integration`, () => {
    let db: Knex;
    let client: CmsKnex;

    beforeAll(async () => {
      db = knexFactory({
        client: clientName,
        // Timestamps are stored as UTC; this makes MySQL read them back as UTC too.
        connection: clientName === 'mysql2' ? { uri: url, timezone: 'Z' } : url,
      } as never);
      client = db as unknown as CmsKnex;
      await dropCmsTables(client, 'cms_it_');
    });

    afterAll(async () => {
      if (db) {
        await dropCmsTables(client, 'cms_it_').catch(() => undefined);
        await db.destroy();
      }
    });

    test('sync is idempotent and diff is empty afterwards', async () => {
      const spec = compileSchema(baseConfig, { engine });

      await syncCmsSchema(client, spec, { engine, skipState: true });
      expect(planIsEmpty(diffSchema(spec, await introspect(client, engine)))).toBe(true);

      const second = await syncCmsSchema(client, spec, { engine, skipState: true });
      expect(planIsEmpty(second)).toBe(true);
    });

    test('adding a field produces an additive alter', async () => {
      const before = compileSchema(baseConfig, { engine });
      await syncCmsSchema(client, before, { engine, skipState: true });

      const after = compileSchema(
        {
          ...baseConfig,
          collections: baseConfig.collections.map((item) =>
            item.slug === 'posts'
              ? { ...item, fields: [...item.fields, { type: 'text' as const, name: 'extra' }] }
              : item,
          ),
        },
        { engine },
      );

      const plan = await syncCmsSchema(client, after, { engine, skipState: true });
      expect(
        plan.alters.flatMap((alter) => alter.addColumns.map((column) => column.name)),
      ).toContain('extra');
      expect(plan.destructive).toBe(false);
    });

    describe('panel workflow', () => {
      // The config is built by a plugin, so the slugs are not literal types here.
      // biome-ignore lint/suspicious/noExplicitAny: see above
      let cms: any;
      // biome-ignore lint/suspicious/noExplicitAny: see above
      let notes: any;

      beforeAll(async () => {
        await dropCmsTables(client, 'cms_wf_');
        const spec = compileSchema(workflowConfig, { engine });
        await syncCmsSchema(client, spec, { engine, skipState: true });
        cms = createCms({ config: workflowConfig, client, engine, user: { id: 'u1' } });
        notes = cms.collection('notes');
      });

      afterAll(async () => {
        await dropCmsTables(client, 'cms_wf_').catch(() => undefined);
      });

      test('timestamps round-trip exactly', async () => {
        const before = Date.now();
        const note = await notes.create({ title: 'Clock' });
        const read = await notes.findByID(note.id);
        const stored = new Date(read.createdAt).getTime();
        expect(Math.abs(stored - before)).toBeLessThan(60_000);
      });

      test('search ignores accents and case', async () => {
        await notes.create({ title: 'Início ÇÃO Ñandu' });
        for (const term of ['inicio', 'INÍCIO', 'cao', 'nandu']) {
          const found = await notes.find({ where: { title: { icontains: term } } });
          expect(found.totalDocs, term).toBe(1);
        }
        const none = await notes.find({ where: { title: { icontains: 'nada-disso' } } });
        expect(none.totalDocs).toBe(0);
      });

      test('filters by workflow status and sorts by a field', async () => {
        const draft = await notes.create({ title: 'Status draft', kind: 'link' }, { draft: true });
        const published = await notes.create({ title: 'Status published', kind: 'plain' });

        const drafts = await notes.find({
          draft: true,
          where: { _status: { equals: 'draft' }, kind: { equals: 'link' } },
        });
        expect(drafts.docs.map((doc: { id: string }) => doc.id)).toContain(draft.id);
        expect(drafts.docs.map((doc: { id: string }) => doc.id)).not.toContain(published.id);

        const sorted = await notes.find({ draft: true, sort: '-title', limit: 100 });
        const titles = sorted.docs.map((doc: { title: string }) => doc.title);
        expect(titles).toEqual([...titles].sort((a, b) => b.localeCompare(a)));
      });

      test('a reserved word works as a field name', async () => {
        await cms.collection('redirects').create({ from: '/old', to: '/new' });
        expect(await findRedirect(cms, '/old')).toEqual({ to: '/new', status: 301 });
        const found = await cms
          .collection('redirects')
          .find({ where: { from: { icontains: 'OLD' } } });
        expect(found.totalDocs).toBe(1);
      });

      test('scheduling runs what is due, once, and replaces a pending change', async () => {
        const due = await notes.create({ title: 'Due' }, { draft: true });
        const later = await notes.create({ title: 'Later' }, { draft: true });

        await notes.schedule(due.id, { at: new Date('2020-01-01'), action: 'publish' });
        await notes.schedule(later.id, { at: new Date('2037-01-01'), action: 'publish' });
        await notes.schedule(later.id, { at: new Date('2037-06-01'), action: 'unpublish' });

        expect(await cms.runDueSchedules()).toBe(1);
        expect(await cms.runDueSchedules()).toBe(0);
        expect((await notes.findByID(due.id, { draft: true }))._status).toBe('published');
        expect((await notes.scheduled(later.id)).action).toBe('unpublish');
        expect((await notes.scheduled(later.id)).at).toBeInstanceOf(Date);

        await notes.unschedule(later.id);
        expect(await notes.scheduled(later.id)).toBeNull();
      });

      test('a version snapshot reads back', async () => {
        const note = await notes.create({ title: 'One' });
        await notes.update(note.id, { title: 'Two' });
        const first = await notes.version(note.id, 1);
        expect((first.snapshot as { doc: { title: string } }).doc.title).toBe('One');
      });

      test('a document lock holds a second user off', async () => {
        const note = await notes.create({ title: 'Locked' });
        await notes.lock(note.id, 120);
        const other = createCms({ config: workflowConfig, client, engine, user: { id: 'u2' } });
        await expect(other.collection('notes' as never).lock(note.id, 120)).rejects.toThrow(
          /locked by u1/,
        );
      });
    });

    test('child tables survive a round-trip', async () => {
      const spec = compileSchema(baseConfig, { engine });
      // A previous test added a column; this sync brings the database back to the base shape.
      await syncCmsSchema(client, spec, { engine, skipState: true, allowDestructive: true });

      const introspection = await introspect(client, engine);
      const names = introspection.tables.map((table) => table.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'cms_it_posts',
          'cms_it_posts__tags',
          'cms_it_posts__layout',
          'cms_it_versions',
        ]),
      );

      const tags = introspection.tables.find((table) => table.name === 'cms_it_posts__tags');
      expect(tags?.columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['id', '_parent_id', '_order', 'label']),
      );
    });
  });
}

suite('pg', 'pg', 'CMS_TEST_PG_URL');
suite('mysql', 'mysql2', 'CMS_TEST_MYSQL_URL');
