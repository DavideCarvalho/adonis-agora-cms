import { afterEach, describe, expect, test } from 'vitest';
import { createApiToken, resolveApiToken } from '../../src/auth/api_tokens.js';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { registerCmsRoutes } from '../../src/rest/routes.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  db: { id: 'uuid' },
  tenancy: { strategy: 'row', required: true },
  collections: [collection('posts', { fields: [fields.text('title', { required: true })] })],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

type Route = { method: string; path: string; handler: (ctx: unknown) => Promise<unknown> };

function fakeRouter() {
  const routes: Route[] = [];
  const push = (method: string) => (path: string, handler: (ctx: unknown) => Promise<unknown>) =>
    routes.push({ method, path, handler });
  return {
    routes,
    router: { get: push('GET'), post: push('POST'), patch: push('PATCH'), delete: push('DELETE') },
  };
}

function ctxFor(method: string, params: Record<string, string>, token?: string, body?: unknown) {
  const captured: { status?: number; body?: unknown } = {};
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};

  return {
    captured,
    ctx: {
      method,
      params,
      request: {
        qs: () => ({}),
        body: () => body,
        hostname: () => 'acme.example.com',
        headers: () => headers,
      },
      response: {
        status(code: number) {
          captured.status = code;
          return {
            json(payload: unknown) {
              captured.body = payload;
            },
            noContent() {
              captured.body = null;
            },
          };
        },
      },
    },
  };
}

describe('app tokens over REST', () => {
  test('the token tenant scopes reads and writes are refused', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'admin' } });

    await cms.forTenant('acme').collection('posts').create({ title: 'Acme post' });
    await cms.forTenant('globex').collection('posts').create({ title: 'Globex post' });

    const readToken = await createApiToken(cms.repoContext(), {
      name: 'acme-reader',
      tenant: 'acme',
      abilities: ['read'],
    });

    const { router, routes } = fakeRouter();
    let resolvedToken: string | null = null;

    registerCmsRoutes(router, cms, {
      resolveToken: async (token) => {
        resolvedToken = token;
        return resolveApiToken(cms.repoContext(), token);
      },
    });

    const find = routes.find((route) => route.path === '/api/cms/collections/:slug');
    const create = routes.find(
      (route) => route.method === 'POST' && route.path === '/api/cms/collections/:slug',
    );

    const read = ctxFor('GET', { slug: 'posts' }, readToken);
    await find?.handler(read.ctx);

    expect(resolvedToken).toBe(readToken);
    expect(read.captured.status).toBe(200);
    expect(
      (read.captured.body as { docs: { title: string }[] }).docs.map((doc) => doc.title),
    ).toEqual(['Acme post']);

    const write = ctxFor('POST', { slug: 'posts' }, readToken, { title: 'nope' });
    await create?.handler(write.ctx);
    expect(write.captured.status).toBe(403);
    expect(write.captured.body).toMatchObject({ error: { code: 'CMS_FORBIDDEN' } });
  });

  test('a write token can create inside its tenant only', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'admin' } });

    const writeToken = await createApiToken(cms.repoContext(), {
      name: 'acme-writer',
      tenant: 'acme',
      abilities: ['read', 'write'],
    });

    const { router, routes } = fakeRouter();
    registerCmsRoutes(router, cms, {
      resolveToken: async (token) => resolveApiToken(cms.repoContext(), token),
    });

    const create = routes.find(
      (route) => route.method === 'POST' && route.path === '/api/cms/collections/:slug',
    );
    const write = ctxFor('POST', { slug: 'posts' }, writeToken, { title: 'From token' });
    await create?.handler(write.ctx);
    expect(write.captured.status).toBe(201);

    const acme = await cms.forTenant('acme').collection('posts').find();
    const globex = await cms.forTenant('globex').collection('posts').find();
    expect(acme.docs.map((doc) => doc.title)).toContain('From token');
    expect(globex.docs.map((doc) => doc.title)).not.toContain('From token');
  });
});
