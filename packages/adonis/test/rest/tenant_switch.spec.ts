import { afterEach, describe, expect, test } from 'vitest';
import { createApiToken, resolveApiToken } from '../../src/auth/api_tokens.js';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { registerCmsRoutes } from '../../src/rest/routes.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  tenancy: { strategy: 'row', required: true },
  collections: [collection('posts', { fields: [fields.text('title', { required: true })] })],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

type Route = { method: string; path: string; handler: (ctx: unknown) => Promise<unknown> };

function setupRouter(cms: ReturnType<typeof createCms>) {
  const routes: Route[] = [];
  const push = (method: string) => (path: string, handler: (ctx: unknown) => Promise<unknown>) =>
    routes.push({ method, path, handler });
  registerCmsRoutes(
    { get: push('GET'), post: push('POST'), patch: push('PATCH'), delete: push('DELETE') },
    cms,
    { resolveToken: (token) => resolveApiToken(cms.repoContext(), token) },
  );
  return routes;
}

function ctxFor(params: Record<string, string>, headers: Record<string, string>) {
  const captured: { status?: number; body?: unknown } = {};
  return {
    captured,
    ctx: {
      method: 'GET',
      params,
      request: {
        qs: () => ({}),
        body: () => undefined,
        hostname: () => 'x',
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

describe('x-cms-tenant', () => {
  test('is refused without the tenant:switch ability', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'admin' } });
    await cms.forTenant('acme').collection('posts').create({ title: 'Acme' });
    await cms.forTenant('globex').collection('posts').create({ title: 'Globex' });

    const token = await createApiToken(cms.repoContext(), { name: 'acme', tenant: 'acme' });
    const routes = setupRouter(cms);
    const find = routes.find((route) => route.path === '/api/cms/collections/:slug');

    const attempt = ctxFor(
      { slug: 'posts' },
      { authorization: `Bearer ${token}`, 'x-cms-tenant': 'globex' },
    );
    await find?.handler(attempt.ctx);

    expect(attempt.captured.status).toBe(403);
    expect(attempt.captured.body).toMatchObject({ error: { code: 'CMS_FORBIDDEN' } });
  });

  test('is honoured with the tenant:switch ability', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'admin' } });
    await cms.forTenant('acme').collection('posts').create({ title: 'Acme' });
    await cms.forTenant('globex').collection('posts').create({ title: 'Globex' });

    const token = await createApiToken(cms.repoContext(), {
      name: 'platform',
      tenant: 'acme',
      abilities: ['read', 'tenant:switch'],
    });
    const routes = setupRouter(cms);
    const find = routes.find((route) => route.path === '/api/cms/collections/:slug');

    const attempt = ctxFor(
      { slug: 'posts' },
      { authorization: `Bearer ${token}`, 'x-cms-tenant': 'globex' },
    );
    await find?.handler(attempt.ctx);

    expect(attempt.captured.status).toBe(200);
    expect(
      (attempt.captured.body as { docs: { title: string }[] }).docs.map((doc) => doc.title),
    ).toEqual(['Globex']);
  });
});
