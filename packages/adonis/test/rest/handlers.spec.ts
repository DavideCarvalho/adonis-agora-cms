import { afterEach, describe, expect, test } from 'vitest';
import type { CmsConfig } from '../../src/config/types.js';
import type { Cms } from '../../src/local_api/index.js';
import { createCms } from '../../src/local_api/index.js';
import {
  handleCollectionCreate,
  handleCollectionDelete,
  handleCollectionFind,
  handleCollectionFindOne,
  handleCollectionUpdate,
  handleGlobalGet,
  handleGlobalUpdate,
} from '../../src/rest/handlers.js';
import { registerCmsRoutes } from '../../src/rest/routes.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';
import { repositoryConfig } from '../fixtures/repo_config.js';

let kit: TestCms;

async function setup(): Promise<Cms<CmsConfig>> {
  kit = await createTestCms({ config: repositoryConfig });
  return createCms({ config: repositoryConfig, client: kit.client });
}

afterEach(async () => {
  await kit?.destroy();
});

const base = { params: {}, query: {}, body: undefined } as const;

describe('REST handlers', () => {
  test('create returns 201 and the serialized document', async () => {
    const cms = await setup();
    const response = await handleCollectionCreate(cms, {
      ...base,
      params: { slug: 'posts' },
      body: { title: 'Hello World' },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ title: 'Hello World', slug: 'hello-world' });
  });

  test('list returns the offset envelope', async () => {
    const cms = await setup();
    for (const title of ['One', 'Two', 'Three']) await cms.collection('posts').create({ title });

    const response = await handleCollectionFind(cms, {
      ...base,
      params: { slug: 'posts' },
      query: { size: '2', page: '2', sort: '-title' },
    });

    expect(response.status).toBe(200);
    const body = response.body as { data: { title: string }[]; meta: Record<string, number> };
    expect(body.data.map((doc) => doc.title)).toEqual(['One']);
    expect(body.meta).toEqual({ total: 3, perPage: 2, currentPage: 2, lastPage: 2, firstPage: 1 });
  });

  test('list defaults to page 1 of 20 and caps the size at 200', async () => {
    const cms = await setup();
    await cms.collection('posts').create({ title: 'Only' });

    const first = await handleCollectionFind(cms, { ...base, params: { slug: 'posts' } });
    expect((first.body as { meta: unknown }).meta).toMatchObject({ perPage: 20, currentPage: 1 });

    const capped = await handleCollectionFind(cms, {
      ...base,
      params: { slug: 'posts' },
      query: { size: '5000' },
    });
    expect((capped.body as { meta: unknown }).meta).toMatchObject({ perPage: 200 });
  });

  test('filter[...] dispatches every wire shape to the field', async () => {
    const cms = await setup();
    await cms.collection('posts').create({ title: 'Início', status: 'published' });
    await cms.collection('posts').create({ title: 'Second', status: 'draft' });
    await cms.collection('posts').create({ title: 'Third', status: 'draft' });

    const titles = async (query: Record<string, unknown>) => {
      const response = await handleCollectionFind(cms, {
        ...base,
        params: { slug: 'posts' },
        query: { sort: 'title', ...query },
      });
      expect(response.status).toBe(200);
      return (response.body as { data: { title: string }[] }).data.map((doc) => doc.title);
    };

    expect(await titles({ filter: { status: 'published' } })).toEqual(['Início']);
    expect(await titles({ filter: { title: { iContains: 'inicio' } } })).toEqual(['Início']);
    expect(await titles({ filter: { title: { notEquals: 'Second' } } })).toEqual([
      'Início',
      'Third',
    ]);
    expect(await titles({ filter: { title: ['Second', 'Third'] } })).toEqual(['Second', 'Third']);
    expect(await titles({ filter: { title: 'Second,Third' } })).toEqual(['Second', 'Third']);
    expect(await titles({ filter: { title: { in: 'Início,Third' } } })).toEqual([
      'Início',
      'Third',
    ]);
    expect(await titles({ filter: { status: 'draft', title: { startsWith: 'T' } } })).toEqual([
      'Third',
    ]);
  });

  test('OR groups from filter-client reach the repository', async () => {
    const cms = await setup();
    await cms.collection('posts').create({ title: 'Alpha', status: 'published' });
    await cms.collection('posts').create({ title: 'Beta', status: 'draft' });
    await cms.collection('posts').create({ title: 'Gamma', status: 'draft' });

    // `filterQuery().or(q => q.equals('title', 'Alpha').equals('title', 'Gamma'))`, decoded.
    const response = await handleCollectionFind(cms, {
      ...base,
      params: { slug: 'posts' },
      query: {
        sort: 'title',
        where: [
          {
            field: '',
            operator: 'equals',
            OR: [
              { field: 'title', operator: 'equals', value: 'Alpha' },
              { field: 'title', operator: 'equals', value: 'Gamma' },
            ],
          },
        ],
      },
    });

    expect(response.status).toBe(200);
    expect((response.body as { data: { title: string }[] }).data.map((d) => d.title)).toEqual([
      'Alpha',
      'Gamma',
    ]);
  });

  test('filters nested paths and the workflow status', async () => {
    const cms = await setup();
    await cms.collection('posts').create({ title: 'Tagged', tags: [{ label: 'news' }] });
    await cms.collection('posts').create({ title: 'Plain' });

    const tagged = await handleCollectionFind(cms, {
      ...base,
      params: { slug: 'posts' },
      query: { filter: { 'tags.label': 'news' } },
    });
    expect((tagged.body as { data: { title: string }[] }).data.map((d) => d.title)).toEqual([
      'Tagged',
    ]);

    const status = await handleCollectionFind(cms, {
      ...base,
      params: { slug: 'posts' },
      query: { filter: { _status: 'published' } },
    });
    expect(status.status).toBe(200);
  });

  test.each([
    ['an unknown filter field', { filter: { nope: 'x' } }, 'Unknown filter field: "nope"'],
    ['an unsupported operator', { filter: { title: { isEmpty: '' } } }, 'isEmpty'],
    ['a bogus operator', { filter: { title: { bogus: 'x' } } }, 'bogus'],
    ['an unknown sort field', { sort: '-nope' }, 'Unknown sort field: "nope"'],
    ['sorting by a nested path', { sort: 'tags.label' }, 'Unknown sort field'],
    ['the old where[field] form', { where: { title: { equals: 'x' } } }, 'filter[field]'],
  ])('answers 400 for %s', async (_label, query, message) => {
    const cms = await setup();
    const response = await handleCollectionFind(cms, {
      ...base,
      params: { slug: 'posts' },
      query,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'CMS_INVALID_QUERY' } });
    expect((response.body as { error: { message: string } }).error.message).toContain(message);
  });

  test('an unknown collection is a 404', async () => {
    const cms = await setup();
    const response = await handleCollectionFind(cms, { ...base, params: { slug: 'nope' } });
    expect(response.status).toBe(404);
  });

  test('find one returns 404 when the document does not exist', async () => {
    const cms = await setup();
    const response = await handleCollectionFindOne(cms, {
      ...base,
      params: { slug: 'posts', id: '00000000-0000-0000-0000-000000000000' },
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'CMS_NOT_FOUND' } });
  });

  test('update returns the updated document', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({ title: 'Before' });

    const response = await handleCollectionUpdate(cms, {
      ...base,
      params: { slug: 'posts', id: post.id },
      body: { title: 'After' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ title: 'After' });
  });

  test('delete returns 204 with no body', async () => {
    const cms = await setup();
    const post = await cms.collection('posts').create({ title: 'Bye' });

    const response = await handleCollectionDelete(cms, {
      ...base,
      params: { slug: 'posts', id: post.id },
    });

    expect(response).toEqual({ status: 204, body: null });
  });

  test('validation errors map to 422 with field paths', async () => {
    const cms = await setup();
    const response = await handleCollectionCreate(cms, {
      ...base,
      params: { slug: 'posts' },
      body: { title: '' },
    });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: { code: 'CMS_VALIDATION', fields: { title: 'required' } },
    });
  });

  test('unique conflicts map to 409', async () => {
    const cms = await setup();
    await cms.collection('posts').create({ title: 'Same' });

    const response = await handleCollectionCreate(cms, {
      ...base,
      params: { slug: 'posts' },
      body: { title: 'Same' },
    });

    expect(response.status).toBe(409);
  });

  test('globals return 404 before the first write and 200 after', async () => {
    const cms = await setup();

    const empty = await handleGlobalGet(cms, { ...base, params: { slug: 'settings' } });
    expect(empty.status).toBe(404);

    const updated = await handleGlobalUpdate(cms, {
      ...base,
      params: { slug: 'settings' },
      body: { siteName: 'Acme' },
    });
    expect(updated.status).toBe(200);

    const read = await handleGlobalGet(cms, { ...base, params: { slug: 'settings' } });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ siteName: 'Acme' });
  });
});

describe('route wiring', () => {
  type Route = { method: string; path: string; handler: (ctx: unknown) => Promise<unknown> };

  function fakeRouter() {
    const routes: Route[] = [];
    const router = {
      get: (path: string, handler: (ctx: unknown) => Promise<unknown>) =>
        routes.push({ method: 'GET', path, handler }),
      post: (path: string, handler: (ctx: unknown) => Promise<unknown>) =>
        routes.push({ method: 'POST', path, handler }),
      patch: (path: string, handler: (ctx: unknown) => Promise<unknown>) =>
        routes.push({ method: 'PATCH', path, handler }),
      delete: (path: string, handler: (ctx: unknown) => Promise<unknown>) =>
        routes.push({ method: 'DELETE', path, handler }),
    };
    return { router, routes };
  }

  function fakeContext(
    params: Record<string, string>,
    query: Record<string, unknown> = {},
    hostname = 'acme.example.com',
  ) {
    const captured: { status?: number; body?: unknown } = {};
    return {
      captured,
      ctx: {
        params,
        request: {
          qs: () => query,
          body: () => ({}),
          hostname: () => hostname,
        },
        response: {
          status(code: number) {
            captured.status = code;
            return {
              json(payload: unknown) {
                captured.body = payload;
                return captured;
              },
              noContent() {
                captured.body = null;
                return captured;
              },
            };
          },
        },
      },
    };
  }

  test('registers the full surface under the prefix', async () => {
    const cms = await setup();
    const { router, routes } = fakeRouter();
    registerCmsRoutes(router, cms);

    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /api/cms/schema',
      'GET /api/cms/collections/:slug',
      'POST /api/cms/collections/:slug',
      'GET /api/cms/collections/:slug/:id',
      'PATCH /api/cms/collections/:slug/:id',
      'DELETE /api/cms/collections/:slug/:id',
      'POST /api/cms/collections/:slug/:id/publish',
      'POST /api/cms/collections/:slug/:id/unpublish',
      'GET /api/cms/collections/:slug/:id/versions',
      'GET /api/cms/collections/:slug/:id/versions/:version',
      'POST /api/cms/collections/:slug/:id/versions/:version/restore',
      'POST /api/cms/collections/:slug/:id/restore',
      'GET /api/cms/collections/:slug/:id/preview-token',
      'POST /api/cms/collections/:slug/:id/lock',
      'DELETE /api/cms/collections/:slug/:id/lock',
      'POST /api/cms/collections/:slug/:id/discard-draft',
      'GET /api/cms/collections/:slug/:id/schedule',
      'POST /api/cms/collections/:slug/:id/schedule',
      'DELETE /api/cms/collections/:slug/:id/schedule',
      'GET /api/cms/globals/:slug',
      'PATCH /api/cms/globals/:slug',
    ]);
  });

  test('resolveContext scopes the request to a tenant', async () => {
    kit = await createTestCms({
      config: {
        ...repositoryConfig,
        tenancy: { strategy: 'row', required: true },
      } as typeof repositoryConfig,
    });
    const cms = createCms({
      config: { ...repositoryConfig, tenancy: { strategy: 'row', required: true } },
      client: kit.client,
    });

    await cms.forTenant('acme').collection('posts').create({ title: 'Acme' });
    await cms.forTenant('globex').collection('posts').create({ title: 'Globex' });

    const { router, routes } = fakeRouter();
    registerCmsRoutes(router, cms, {
      resolveContext: (ctx) => ({
        user: null,
        tenant: ctx.request.hostname?.().startsWith('acme') ? 'acme' : 'globex',
      }),
    });

    const find = routes.find((route) => route.path === '/api/cms/collections/:slug');
    const acme = fakeContext({ slug: 'posts' });
    await find?.handler(acme.ctx);
    expect((acme.captured.body as { data: { title: string }[] }).data.map((d) => d.title)).toEqual([
      'Acme',
    ]);

    const globex = fakeContext({ slug: 'posts' }, {}, 'globex.example.com');
    await find?.handler(globex.ctx);
    expect(
      (globex.captured.body as { data: { title: string }[] }).data.map((d) => d.title),
    ).toEqual(['Globex']);
  });
});
