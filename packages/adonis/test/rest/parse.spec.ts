import { describe, expect, test } from 'vitest';
import { parseFindQuery } from '../../src/rest/parse.js';

describe('parseFindQuery', () => {
  test('parses the full query string shape produced by qs', () => {
    const query = parseFindQuery({
      where: { status: { equals: 'published' } },
      sort: '-publishedAt',
      limit: '5',
      page: '2',
      depth: '0',
      draft: 'true',
      select: 'title,slug',
    });

    expect(query).toEqual({
      where: { status: { equals: 'published' } },
      sort: '-publishedAt',
      limit: 5,
      page: 2,
      depth: 0,
      draft: true,
      select: ['title', 'slug'],
    });
  });

  test('accepts filter-style operator aliases and normalizes them', () => {
    const query = parseFindQuery({
      where: {
        title: { contains: 'adonis', notEquals: 'x' },
        views: { gt: '10', lte: '100' },
      },
    });

    expect(query.where).toEqual({
      title: { contains: 'adonis', not_equals: 'x' },
      views: { greater_than: '10', less_than_equal: '100' },
    });
  });

  test('splits comma-separated list operands', () => {
    const query = parseFindQuery({ where: { status: { in: 'draft,published' } } });
    expect(query.where).toEqual({ status: { in: ['draft', 'published'] } });
  });

  test('normalizes or/and groups recursively', () => {
    const query = parseFindQuery({
      where: {
        or: [{ title: { like: 'a' } }, { status: { equals: 'published' } }],
      },
    });

    expect(query.where).toEqual({
      or: [{ title: { like: 'a' } }, { status: { equals: 'published' } }],
    });
  });

  test('drops prototype-pollution keys', () => {
    const query = parseFindQuery({
      where: {
        __proto__: { equals: 'x' },
        constructor: { equals: 'y' },
        title: { equals: 'ok' },
      },
    });

    expect(Object.keys(query.where ?? {})).toEqual(['title']);
  });

  test('ignores unknown operators instead of passing them through', () => {
    const query = parseFindQuery({ where: { title: { bogus: 'x', equals: 'ok' } } });
    expect(query.where).toEqual({ title: { equals: 'ok' } });
  });
});
