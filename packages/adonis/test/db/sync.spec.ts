import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterEach, describe, expect, test } from 'vitest';
import { diffSchema } from '../../src/db/diff.js';
import { introspectSqlite } from '../../src/db/introspect/sqlite.js';
import { dropCmsTables, readSchemaState, syncCmsSchema } from '../../src/db/sync.js';
import { planIsEmpty } from '../../src/db/types.js';
import { CmsSchemaError } from '../../src/errors.js';
import type { FieldConfig } from '../../src/index.js';
import { collection, defineConfig, fields } from '../../src/index.js';
import { compileSchema } from '../../src/schema/compile.js';
import { asCmsKnex, sqliteClient } from '../helpers/db.js';

const clients: Knex[] = [];
afterEach(async () => {
  await Promise.all(clients.map((client) => client.destroy()));
  clients.length = 0;
});

function client(): Knex {
  const instance = sqliteClient();
  clients.push(instance);
  return instance;
}

function config(fieldList: readonly FieldConfig[]) {
  return defineConfig({
    collections: [collection('posts', { fields: fieldList })],
  });
}

describe('syncCmsSchema', () => {
  test('creates the schema, then is idempotent', async () => {
    const knex = client();
    const spec = compileSchema(
      config([
        fields.text('title', { required: true }),
        fields.array('tags', { fields: [fields.text('label')] }),
      ]),
      { engine: 'sqlite' },
    );

    await syncCmsSchema(asCmsKnex(knex), spec, { skipState: true });

    const introspection = await introspectSqlite(asCmsKnex(knex));
    expect(introspection.tables.map((table) => table.name).sort()).toEqual([
      'cms_posts',
      'cms_posts__tags',
    ]);

    const second = await syncCmsSchema(asCmsKnex(knex), spec, { skipState: true });
    expect(planIsEmpty(second)).toBe(true);
    expect(planIsEmpty(diffSchema(spec, introspection))).toBe(true);
  });

  test('adds a column without touching existing data', async () => {
    const knex = client();
    const before = compileSchema(config([fields.text('title')]), { engine: 'sqlite' });
    await syncCmsSchema(asCmsKnex(knex), before, { skipState: true });

    await knex('cms_posts').insert({ id: randomUUID(), title: 'hello' });

    const after = compileSchema(config([fields.text('title'), fields.text('body')]), {
      engine: 'sqlite',
    });
    const plan = await syncCmsSchema(asCmsKnex(knex), after, { skipState: true });

    expect(plan.alters).toHaveLength(1);
    expect(plan.alters[0]?.addColumns.map((column) => column.name)).toEqual(['body']);
    expect(plan.destructive).toBe(false);

    const rows = await knex('cms_posts').select('title', 'body');
    expect(rows).toEqual([{ title: 'hello', body: null }]);
  });

  test('refuses destructive changes without the flag, applies with it', async () => {
    const knex = client();
    const before = compileSchema(config([fields.text('title'), fields.text('body')]), {
      engine: 'sqlite',
    });
    await syncCmsSchema(asCmsKnex(knex), before, { skipState: true });

    const after = compileSchema(config([fields.text('title')]), { engine: 'sqlite' });

    await expect(syncCmsSchema(asCmsKnex(knex), after, { skipState: true })).rejects.toThrow(
      CmsSchemaError,
    );

    const plan = await syncCmsSchema(asCmsKnex(knex), after, {
      skipState: true,
      allowDestructive: true,
    });
    expect(plan.destructive).toBe(true);

    const introspection = await introspectSqlite(asCmsKnex(knex));
    const posts = introspection.tables.find((table) => table.name === 'cms_posts');
    expect(posts?.columns.map((column) => column.name)).not.toContain('body');
  });

  test('renames a column preserving data when db.renames is declared', async () => {
    const knex = client();
    const before = compileSchema(config([fields.text('title')]), { engine: 'sqlite' });
    await syncCmsSchema(asCmsKnex(knex), before, { skipState: true });
    await knex('cms_posts').insert({ id: randomUUID(), title: 'keep me' });

    const after = compileSchema(
      defineConfig({
        db: { renames: { 'posts.title': 'heading' } },
        collections: [collection('posts', { fields: [fields.text('heading')] })],
      }),
      { engine: 'sqlite' },
    );

    const plan = await syncCmsSchema(asCmsKnex(knex), after, { skipState: true });
    expect(plan.destructive).toBe(false);
    expect(plan.alters[0]?.renames).toEqual([{ from: 'title', to: 'heading' }]);

    const rows = await knex('cms_posts').select('heading');
    expect(rows).toEqual([{ heading: 'keep me' }]);
  });

  test('records the applied spec hash in cms_schema_state', async () => {
    const knex = client();
    const spec = compileSchema(config([fields.text('title')]), { engine: 'sqlite' });

    expect(await readSchemaState(asCmsKnex(knex))).toBeNull();

    await syncCmsSchema(asCmsKnex(knex), spec);
    const state = await readSchemaState(asCmsKnex(knex));
    expect(state?.hash).toBe(spec.hash);
    expect(state?.engine).toBe('sqlite');
  });

  test('dropCmsTables removes children before parents', async () => {
    const knex = client();
    const spec = compileSchema(
      config([fields.text('title'), fields.array('tags', { fields: [fields.text('label')] })]),
      { engine: 'sqlite' },
    );
    await syncCmsSchema(asCmsKnex(knex), spec, { skipState: true });

    await dropCmsTables(asCmsKnex(knex));

    const introspection = await introspectSqlite(asCmsKnex(knex));
    expect(introspection.tables.filter((table) => table.name.startsWith('cms_'))).toEqual([]);
  });
});
