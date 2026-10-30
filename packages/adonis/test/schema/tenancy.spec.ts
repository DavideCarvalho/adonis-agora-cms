import { describe, expect, test } from 'vitest';
import { validateConfig } from '../../src/config/validate.js';
import { collection, defineConfig, fields } from '../../src/index.js';
import { compileSchema } from '../../src/schema/compile.js';
import type { TableSpec } from '../../src/schema/types.js';

const tenantConfig = defineConfig({
  integrations: { media: true },
  tenancy: {
    strategy: 'row',
    required: true,
    overrides: {
      acme: { collections: { only: ['posts'] } },
    },
  },
  collections: [
    collection('posts', {
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { unique: true }),
        fields.array('tags', { fields: [fields.text('label')] }),
      ],
    }),
    collection('pages', { fields: [fields.text('title')] }),
  ],
});

const spec = compileSchema(tenantConfig, { engine: 'sqlite' });

function table(name: string): TableSpec {
  const found = spec.tables.find((item) => item.name === name);
  if (!found) throw new Error(`missing table ${name}`);
  return found;
}

describe('row tenancy', () => {
  test('records the strategy in the spec', () => {
    expect(spec.tenancy).toEqual({ strategy: 'row', required: true, column: '_tenant_id' });
  });

  test('every document table carries a required, indexed tenant column', () => {
    const posts = table('cms_posts');
    const tenantColumn = posts.columns.find((column) => column.name === '_tenant_id');
    expect(tenantColumn).toMatchObject({ type: 'string', length: 64, nullable: false });
    expect(posts.indexes).toContainEqual({
      name: expect.stringContaining('_tenant_id'),
      columns: ['_tenant_id'],
    });
  });

  test('child tables carry the tenant column too, so children are scoped without a join', () => {
    expect(table('cms_posts__tags').columns.map((column) => column.name)).toEqual([
      'id',
      '_parent_id',
      '_order',
      '_tenant_id',
      'label',
    ]);
  });

  test('unique constraints become per-tenant', () => {
    const unique = table('cms_posts').indexes.find((index) => index.unique);
    expect(unique?.columns).toEqual(['slug', '_tenant_id']);
  });

  test('tenant overrides are validated against declared collections', () => {
    const invalid = defineConfig({
      tenancy: { strategy: 'row', overrides: { acme: { collections: { only: ['nope'] } } } },
      collections: [collection('posts', { fields: [fields.text('title')] })],
    });
    expect(validateConfig(invalid)[0]?.message).toMatch(/not a declared collection/);
  });

  test('database strategy rejects a missing connection resolver', () => {
    const invalid = defineConfig({ tenancy: { strategy: 'database' } });
    expect(validateConfig(invalid)[0]?.message).toMatch(/connection resolver/);
  });

  test('database strategy keeps the schema tenant-free', () => {
    const databaseSpec = compileSchema(
      defineConfig({
        tenancy: { strategy: 'database', connection: (tenant) => tenant },
        collections: [collection('posts', { fields: [fields.text('title')] })],
      }),
      { engine: 'sqlite' },
    );
    expect(databaseSpec.tenancy.column).toBeNull();
    expect(
      databaseSpec.tables
        .find((item) => item.name === 'cms_posts')
        ?.columns.some((column) => column.name === '_tenant_id'),
    ).toBe(false);
  });

  test('single tenancy adds no columns and no unique composition', () => {
    const single = compileSchema(
      defineConfig({ collections: [collection('posts', { fields: [fields.text('title')] })] }),
      { engine: 'sqlite' },
    );
    expect(single.tenancy.strategy).toBe('single');
    expect(single.tables[0]?.columns.some((column) => column.name === '_tenant_id')).toBe(false);
  });
});
