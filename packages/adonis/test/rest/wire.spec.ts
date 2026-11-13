import { filterQuery } from '@adonis-agora/filter-client';
import { Qs } from '@adonisjs/core/http';
import { afterEach, describe, expect, test } from 'vitest';
import type { CmsConfig } from '../../src/config/types.js';
import type { Cms } from '../../src/local_api/index.js';
import { createCms } from '../../src/local_api/index.js';
import { handleCollectionFind } from '../../src/rest/handlers.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';
import { repositoryConfig } from '../fixtures/repo_config.js';

/** AdonisJS's default query-string parser settings (`config/app.ts` → `http.qs`). */
const qs = new Qs({
  parse: { depth: 5, parameterLimit: 1000, allowSparse: false, arrayLimit: 20, comma: true },
  stringify: { encode: true, encodeValuesOnly: false, arrayFormat: 'indices', skipNulls: false },
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

async function setup(): Promise<Cms<CmsConfig>> {
  kit = await createTestCms({ config: repositoryConfig });
  const cms = createCms({ config: repositoryConfig, client: kit.client });
  for (const [title, status] of [
    ['Alpha', 'published'],
    ['Beta', 'draft'],
    ['Gamma', 'draft'],
    ['Delta', 'published'],
  ] as const) {
    await cms.collection('posts').create({ title, status });
  }
  return cms;
}

async function list(cms: Cms<CmsConfig>, queryString: string) {
  const response = await handleCollectionFind(cms, {
    params: { slug: 'posts' },
    query: qs.parse(queryString),
    body: undefined,
  });
  return response as {
    status: number;
    body: { data: { title: string }[]; meta: Record<string, number> };
  };
}

describe('filter-client query strings', () => {
  test('flat filters, sort and page', async () => {
    const cms = await setup();
    const query = filterQuery()
      .where('status', 'published')
      .where('title', 'in', ['Alpha', 'Delta', 'Gamma'])
      .sortAsc('title')
      .page(1, 1)
      .toQueryString();

    const first = await list(cms, query);
    expect(first.status).toBe(200);
    expect(first.body.data.map((doc) => doc.title)).toEqual(['Alpha']);
    expect(first.body.meta).toEqual({
      total: 2,
      perPage: 1,
      currentPage: 1,
      lastPage: 2,
      firstPage: 1,
    });

    const second = await list(
      cms,
      filterQuery()
        .where('status', 'published')
        .where('title', 'in', ['Alpha', 'Delta', 'Gamma'])
        .sortAsc('title')
        .page(2, 1)
        .toQueryString(),
    );
    expect(second.body.data.map((doc) => doc.title)).toEqual(['Delta']);
  });

  test('OR groups', async () => {
    const cms = await setup();
    const query = filterQuery()
      .where('status', 'draft')
      .or((q) => q.where('title', 'iContains', 'gam').where('slug', 'equals', 'alpha'))
      .sortAsc('title')
      .toQueryString();

    const response = await list(cms, query);
    expect(response.status).toBe(200);
    expect(response.body.data.map((doc) => doc.title)).toEqual(['Gamma']);
  });

  test('an unknown field from the builder is a 400', async () => {
    const cms = await setup();
    const response = await list(cms, filterQuery().where('nope', 'x').toQueryString());
    expect(response.status).toBe(400);
  });
});
