import type { Knex } from 'knex';
import { afterEach, describe, expect, test } from 'vitest';
import { diffSchema } from '../../src/db/diff.js';
import { introspectSqlite } from '../../src/db/introspect/sqlite.js';
import { renderPlan } from '../../src/db/plan_render.js';
import { compileSchema } from '../../src/schema/compile.js';
import { blogConfig } from '../fixtures/blog_config.js';
import { asCmsKnex, sqliteClient } from '../helpers/db.js';

const spec = compileSchema(blogConfig, { engine: 'sqlite' });
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

describe('diffSchema', () => {
  test('against an empty database it creates parents before children', async () => {
    const plan = diffSchema(spec, await introspectSqlite(asCmsKnex(client())));

    expect(plan.creates).toHaveLength(spec.tables.length);
    const names = plan.creates.map((table) => table.name);
    expect(names.indexOf('cms_posts')).toBeLessThan(names.indexOf('cms_posts__layout'));
    expect(names.indexOf('cms_posts__layout')).toBeLessThan(
      names.indexOf('cms_posts__layout__gallery'),
    );
    expect(plan.destructive).toBe(false);
  });

  test('orphan tables are warnings by default and drops with prune', async () => {
    const knex = client();
    await knex.schema.createTable('cms_old_thing', (table) => {
      table.increments('id');
    });

    const introspection = await introspectSqlite(asCmsKnex(knex));

    const safe = diffSchema(spec, introspection);
    expect(safe.drops).toEqual([]);
    expect(safe.warnings.join('\n')).toMatch(/cms_old_thing/);

    const pruning = diffSchema(spec, introspection, { prune: true, allowDestructive: true });
    expect(pruning.drops).toEqual(['cms_old_thing']);
    expect(pruning.destructive).toBe(true);
  });

  test('renders a readable plan', async () => {
    const plan = diffSchema(spec, await introspectSqlite(asCmsKnex(client())));
    const text = renderPlan(plan);
    expect(text).toContain('create');
    expect(text).toContain('cms_posts');
    expect(text).toContain('cms_posts__tags');
  });
});
