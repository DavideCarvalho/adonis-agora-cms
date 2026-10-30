import knexFactory, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { diffSchema } from '../../src/db/diff.js';
import { introspect } from '../../src/db/introspect/index.js';
import { dropCmsTables, syncCmsSchema } from '../../src/db/sync.js';
import type { CmsKnex } from '../../src/db/types.js';
import { planIsEmpty } from '../../src/db/types.js';
import { collection, defineConfig, fields } from '../../src/index.js';
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

function suite(engine: Engine, clientName: string, envVar: string) {
  const url = process.env[envVar];
  const run = describe.skipIf(!url);

  run(`${engine} integration`, () => {
    let db: Knex;
    let client: CmsKnex;

    beforeAll(async () => {
      db = knexFactory({ client: clientName, connection: url });
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
