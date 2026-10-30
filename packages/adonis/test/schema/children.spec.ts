import { describe, expect, test } from 'vitest';
import { compileSchema } from '../../src/schema/compile.js';
import type { TableSpec } from '../../src/schema/types.js';
import { blogConfig } from '../fixtures/blog_config.js';

const spec = compileSchema(blogConfig, { engine: 'sqlite' });

function table(name: string): TableSpec {
  const found = spec.tables.find((item) => item.name === name);
  if (!found) throw new Error(`missing table ${name}`);
  return found;
}

function columnNames(item: TableSpec): string[] {
  return item.columns.map((column) => column.name);
}

describe('compileSchema — child tables', () => {
  test('array compiles to a child table keyed by parent and order', () => {
    const tags = table('cms_posts__tags');
    expect(tags.kind).toBe('child');
    expect(tags.owner).toBe('cms_posts');
    expect(tags.rootTable).toBe('cms_posts');
    expect(tags.path).toBe('tags');
    expect(columnNames(tags)).toEqual(['id', '_parent_id', '_order', 'label']);
    expect(tags.columns.find((column) => column.name === '_parent_id')?.references).toEqual({
      table: 'cms_posts',
      column: 'id',
      onDelete: 'cascade',
    });
  });

  test('select hasMany compiles to a child table of values', () => {
    const channels = table('cms_posts__channels');
    expect(columnNames(channels)).toEqual(['id', '_parent_id', '_order', 'value']);
    expect(channels.columns.find((column) => column.name === 'value')).toMatchObject({
      type: 'string',
      nullable: false,
    });
  });

  test('hasMany polymorphic relation keeps the target collection', () => {
    const related = table('cms_posts__related');
    expect(columnNames(related)).toEqual([
      'id',
      '_parent_id',
      '_order',
      'related_id',
      'related_collection',
    ]);
    expect(related.columns.find((column) => column.name === 'related_id')?.type).toBe('uuid');
  });

  test('blocks compile to one child table with the union of block columns', () => {
    const layout = table('cms_posts__layout');
    expect(columnNames(layout)).toEqual([
      'id',
      '_parent_id',
      '_order',
      'type',
      'heading',
      'image_id',
    ]);
    expect(layout.indexes).toContainEqual({
      name: expect.stringContaining('type'),
      columns: ['type'],
    });
    expect(layout.indexes).toContainEqual({
      name: expect.any(String),
      columns: ['_parent_id', '_order'],
    });
  });

  test('a nested array inside a block gets its own table', () => {
    const nested = table('cms_posts__layout__gallery');
    expect(nested.path).toBe('layout.gallery');
    expect(nested.owner).toBe('cms_posts__layout');
    expect(nested.rootTable).toBe('cms_posts');
    expect(nested.chain).toEqual(['cms_posts__layout', 'cms_posts__layout__gallery']);
    expect(columnNames(nested)).toEqual(['id', '_parent_id', '_order', 'caption', 'link_id']);
  });

  test('query plan resolves nested paths to table, column and join chain', () => {
    expect(spec.queryPlan['layout.heading']).toMatchObject({
      table: 'cms_posts__layout',
      rootTable: 'cms_posts',
      chain: ['cms_posts__layout'],
      column: 'heading',
      path: ['layout', 'heading'],
    });

    expect(spec.queryPlan['layout.gallery.caption']).toMatchObject({
      table: 'cms_posts__layout__gallery',
      chain: ['cms_posts__layout', 'cms_posts__layout__gallery'],
      column: 'caption',
      path: ['layout', 'gallery', 'caption'],
    });
  });

  test('query plan resolves localized root fields to one column per locale', () => {
    expect(spec.queryPlan.body).toMatchObject({
      table: 'cms_posts',
      column: 'body_pt_br',
      columns: { 'pt-BR': 'body_pt_br', en: 'body_en' },
    });
  });

  test('group fields stay flat on the parent table and resolve through the dotted path', () => {
    expect(spec.queryPlan['seo.description']).toMatchObject({
      table: 'cms_posts',
      column: 'seo_description',
      chain: [],
    });
  });

  test('child tables are ordered by depth for DDL planning', () => {
    const child = table('cms_posts__layout__gallery');
    expect(child.path?.split('.')).toHaveLength(2);
  });

  test('blocks that share a field name compile to one column', () => {
    const config = {
      ...blogConfig,
      collections: [
        {
          slug: 'pages',
          fields: [
            {
              type: 'blocks' as const,
              name: 'layout',
              blocks: [
                { slug: 'hero', fields: [{ type: 'text' as const, name: 'heading' }] },
                { slug: 'list', fields: [{ type: 'text' as const, name: 'heading' }] },
              ],
            },
          ],
        },
      ],
      globals: [],
    };

    const spec = compileSchema(config, { engine: 'sqlite' });
    const child = spec.tables.find((item) => item.name === 'cms_pages__layout');
    expect(child).toBeDefined();
    expect(child?.columns.filter((column) => column.name === 'heading')).toHaveLength(1);
  });

  test('arrays with the same name in different blocks share one child table', () => {
    const config = {
      ...blogConfig,
      collections: [
        {
          slug: 'pages',
          fields: [
            {
              type: 'blocks' as const,
              name: 'layout',
              blocks: [
                {
                  slug: 'features',
                  fields: [
                    {
                      type: 'array' as const,
                      name: 'items',
                      fields: [{ type: 'text' as const, name: 'title' }],
                    },
                  ],
                },
                {
                  slug: 'steps',
                  fields: [
                    {
                      type: 'array' as const,
                      name: 'items',
                      fields: [
                        { type: 'text' as const, name: 'title' },
                        { type: 'text' as const, name: 'number' },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      globals: [],
    };

    const spec = compileSchema(config, { engine: 'sqlite' });
    const children = spec.tables.filter((item) => item.name === 'cms_pages__layout__items');
    expect(children).toHaveLength(1);

    const names = (children[0]?.columns ?? []).map((column) => column.name);
    expect(names).toContain('title');
    expect(names).toContain('number');
    expect(new Set(names).size).toBe(names.length);
  });

  test('incompatible block columns are rejected', () => {
    const config = {
      ...blogConfig,
      collections: [
        {
          slug: 'posts',
          fields: [
            {
              type: 'blocks' as const,
              name: 'layout',
              blocks: [
                { slug: 'a', fields: [{ type: 'text' as const, name: 'title' }] },
                {
                  slug: 'b',
                  fields: [{ type: 'number' as const, name: 'title', format: 'int' as const }],
                },
              ],
            },
          ],
        },
      ],
      globals: [],
    };

    expect(() => compileSchema(config, { engine: 'sqlite' })).toThrow(/incompatible types/);
  });
});
