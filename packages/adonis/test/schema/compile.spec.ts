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

describe('compileSchema — documents', () => {
  test('creates one table per collection and one per global', () => {
    expect(spec.tables.map((item) => item.name).sort()).toEqual(
      expect.arrayContaining(['cms_posts', 'cms_pages', 'cms_users', 'cms_site_settings']),
    );
    expect(spec.idKind).toBe('uuid');
    expect(spec.locales).toEqual(['pt-BR', 'en']);
    expect(spec.defaultLocale).toBe('pt-BR');
  });

  test('compiles system, scalar, localized, group and relation columns in declaration order', () => {
    expect(columnNames(table('cms_posts'))).toEqual([
      'id',
      'created_at',
      'updated_at',
      '_status',
      'title',
      'slug',
      'body_pt_br',
      'body_en',
      'status',
      'published_at',
      'author_id',
      'cover_id',
      'seo_title',
      'seo_description',
    ]);
  });

  test('required fields are not nullable and keep their declared length', () => {
    const title = table('cms_posts').columns.find((column) => column.name === 'title');
    expect(title).toMatchObject({ type: 'string', length: 120, nullable: false });

    const publishedAt = table('cms_posts').columns.find((column) => column.name === 'published_at');
    expect(publishedAt).toMatchObject({ type: 'timestamp', nullable: true });
  });

  test('localized columns carry their locale', () => {
    const body = table('cms_posts').columns.filter((column) => column.path === 'body');
    expect(body.map((column) => [column.name, column.locale])).toEqual([
      ['body_pt_br', 'pt-BR'],
      ['body_en', 'en'],
    ]);
  });

  test('hasOne relation gets an FK column with a reference', () => {
    const author = table('cms_posts').columns.find((column) => column.name === 'author_id');
    expect(author).toMatchObject({
      type: 'uuid',
      nullable: true,
      references: { table: 'cms_users', column: 'id', onDelete: 'set null' },
    });
  });

  test('unique fields produce a unique index', () => {
    expect(table('cms_posts').indexes).toContainEqual({
      name: expect.stringContaining('slug'),
      columns: ['slug'],
      unique: true,
    });
  });

  test('globals compile through the same pipeline', () => {
    expect(columnNames(table('cms_site_settings'))).toEqual([
      'id',
      'created_at',
      'updated_at',
      '_status',
      'site_name',
      'logo_id',
    ]);
  });

  test('is deterministic across calls', () => {
    expect(compileSchema(blogConfig, { engine: 'sqlite' }).hash).toBe(spec.hash);
  });

  test('hash changes when a field is added', () => {
    const other = compileSchema(
      {
        ...blogConfig,
        collections: blogConfig.collections.map((item) =>
          item.slug === 'pages'
            ? { ...item, fields: [...item.fields, { type: 'text', name: 'extra' } as const] }
            : item,
        ),
      },
      { engine: 'sqlite' },
    );
    expect(other.hash).not.toBe(spec.hash);
  });
});
