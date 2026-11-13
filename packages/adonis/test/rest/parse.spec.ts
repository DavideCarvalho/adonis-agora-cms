import { InvalidColumnFilterError } from '@adonis-agora/filter';
import { describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { listableFields, parseListQuery, parseVersionsQuery } from '../../src/rest/list.js';
import { parseReadOptions } from '../../src/rest/parse.js';
import { compileSchema } from '../../src/schema/compile.js';
import { repositoryConfig } from '../fixtures/repo_config.js';

const spec = compileSchema(repositoryConfig, { engine: 'sqlite' });
const parse = (qs: Record<string, unknown>) => parseListQuery(spec, repositoryConfig, 'posts', qs);

describe('parseListQuery', () => {
  test('maps filter, sort and paging onto the repository query', () => {
    const query = parse({
      filter: { status: 'published', title: { iContains: 'cms' } },
      sort: '-createdAt,title',
      page: '2',
      size: '5',
      depth: '0',
      locale: 'en',
    });

    expect(query).toEqual({
      where: {
        and: [{ status: { equals: 'published' } }, { title: { icontains: 'cms' } }],
      },
      sort: '-createdAt,title',
      page: 2,
      limit: 5,
      depth: 0,
      locale: 'en',
    });
  });

  test('translates the filter operators', () => {
    const where = parse({
      filter: {
        title: { notEquals: 'a', startsWith: 'b', endsWith: 'c', contains: 'd', notContains: 'e' },
        author: { isNull: '', '!=': 'x' },
        createdAt: { gte: '2026-01-01', lt: '2027-01-01' },
        slug: { notIn: 'x,y', isAnyOf: ['z'] },
        status: { between: ['a', 'b'] },
      },
    }).where as { and: Record<string, unknown>[] };

    expect(where.and).toEqual([
      { title: { not_equals: 'a' } },
      { title: { starts_with: 'b' } },
      { title: { ends_with: 'c' } },
      { title: { contains: 'd' } },
      { title: { not_contains: 'e' } },
      { author: { is_null: '' } },
      { author: { not_equals: 'x' } },
      { createdAt: { greater_than_equal: '2026-01-01' } },
      { createdAt: { less_than: '2027-01-01' } },
      { slug: { not_in: ['x', 'y'] } },
      { slug: { in: ['z'] } },
      { status: { greater_than_equal: 'a', less_than_equal: 'b' } },
    ]);
  });

  test('keeps OR and AND groups', () => {
    const query = parse({
      where: [
        {
          field: '',
          operator: 'equals',
          OR: [
            { field: 'title', operator: 'equals', value: 'a' },
            { field: 'slug', operator: 'iContains', value: 'b' },
          ],
        },
      ],
    });

    expect(query.where).toEqual({
      and: [{ or: [{ title: { equals: 'a' } }, { slug: { icontains: 'b' } }] }],
    });
  });

  test('reads list operands past the query-string array limit', () => {
    const query = parse({ filter: { slug: { in: { 0: 'a', 1: 'b' } } } });
    expect(query.where).toEqual({ and: [{ slug: { in: ['a', 'b'] } }] });
  });

  test('defaults to page 1 of 20', () => {
    expect(parse({})).toEqual({ page: 1, limit: 20 });
  });

  test.each([
    [{ filter: { nope: 'x' } }],
    [{ filter: { title: { like: '%x%' } } }],
    [{ filter: { _status: { in: 'draft,published' } } }],
    [{ filter: { status: { between: 'a' } } }],
    [{ sort: 'body' }],
    [{ sort: 'layout.type' }],
    [{ where: { title: { equals: 'x' } } }],
    [{ where: [{ field: 'title', operator: 'equals', value: 'x', OR: [] }] }],
  ])('rejects %j', (qs) => {
    expect(() => parse(qs)).toThrow(InvalidColumnFilterError);
  });

  test('never lists a password field', () => {
    const config = defineConfig({
      collections: [
        collection('members', {
          fields: [fields.text('name'), fields.password('secret')],
        }),
      ],
    });
    const fieldsOf = listableFields(compileSchema(config, { engine: 'sqlite' }), config, 'members');

    expect(fieldsOf.filterable.has('name')).toBe(true);
    expect(fieldsOf.filterable.has('secret')).toBe(false);
    expect(fieldsOf.sortable).not.toContain('secret');
  });
});

describe('parseVersionsQuery', () => {
  test('pages newest first, with an optional locale', () => {
    expect(parseVersionsQuery({})).toEqual({ page: 1, limit: 20 });
    expect(
      parseVersionsQuery({ page: '3', size: '500', sort: '-version', filter: { locale: 'en' } }),
    ).toEqual({ page: 3, limit: 100, locale: 'en' });
  });

  test.each([
    [{ sort: 'version' }],
    [{ sort: '-createdAt' }],
    [{ filter: { status: 'draft' } }],
    [{ filter: { locale: { in: 'en,pt-BR' } } }],
  ])('rejects %j', (qs) => {
    expect(() => parseVersionsQuery(qs)).toThrow(InvalidColumnFilterError);
  });
});

describe('parseReadOptions', () => {
  test('reads the document options only', () => {
    expect(
      parseReadOptions({
        locale: 'en',
        depth: '2',
        draft: 'true',
        deleted: '1',
        select: 'title, slug',
        filter: { title: 'ignored' },
      }),
    ).toEqual({
      locale: 'en',
      depth: 2,
      draft: true,
      deleted: true,
      select: ['title', 'slug'],
    });
  });
});
