import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { registerCmsRoutes } from '../../src/rest/routes.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  collections: [
    collection('posts', { softDelete: true, fields: [fields.text('title', { required: true })] }),
  ],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

type Route = { method: string; path: string; handler: (ctx: unknown) => Promise<unknown> };

function mount(cms: ReturnType<typeof createCms>) {
  const routes: Route[] = [];
  const push = (method: string) => (path: string, handler: (ctx: unknown) => Promise<unknown>) =>
    routes.push({ method, path, handler });

  registerCmsRoutes(
    { get: push('GET'), post: push('POST'), patch: push('PATCH'), delete: push('DELETE') },
    cms,
  );
  return (method: string, path: string) => {
    const route = routes.find((item) => item.method === method && item.path === path);
    if (!route) throw new Error(`route ${method} ${path} not mounted`);
    return route;
  };
}

function ctxFor(params: Record<string, string>, query: Record<string, string> = {}) {
  const captured: { status?: number; body?: unknown } = {};
  return {
    captured,
    ctx: {
      method: 'GET',
      params,
      request: { qs: () => query, body: () => undefined, headers: () => ({}) },
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

describe('soft delete over REST', () => {
  test('DELETE soft-deletes, ?deleted=true lists it, restore brings it back', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'u1' } });
    const post = await cms.collection('posts').create({ title: 'Recover me' });
    const route = mount(cms);

    const removed = ctxFor({ slug: 'posts', id: post.id });
    await route('DELETE', '/api/cms/collections/:slug/:id').handler(removed.ctx);
    expect(removed.captured.status).toBe(204);

    const live = ctxFor({ slug: 'posts' });
    await route('GET', '/api/cms/collections/:slug').handler(live.ctx);
    expect((live.captured.body as { totalDocs: number }).totalDocs).toBe(0);

    const trashed = ctxFor({ slug: 'posts' }, { deleted: 'true' });
    await route('GET', '/api/cms/collections/:slug').handler(trashed.ctx);
    expect((trashed.captured.body as { totalDocs: number }).totalDocs).toBe(1);

    const restored = ctxFor({ slug: 'posts', id: post.id });
    await route('POST', '/api/cms/collections/:slug/:id/restore').handler(restored.ctx);
    expect(restored.captured.status).toBe(200);
    expect(restored.captured.body).toMatchObject({ title: 'Recover me' });

    const after = ctxFor({ slug: 'posts' });
    await route('GET', '/api/cms/collections/:slug').handler(after.ctx);
    expect((after.captured.body as { totalDocs: number }).totalDocs).toBe(1);
  });

  test('DELETE ?force=true removes the row for real', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'u1' } });
    const post = await cms.collection('posts').create({ title: 'Gone' });
    const route = mount(cms);

    const forced = ctxFor({ slug: 'posts', id: post.id }, { force: 'true' });
    await route('DELETE', '/api/cms/collections/:slug/:id').handler(forced.ctx);

    expect(await kit.db('cms_posts').where({ id: post.id })).toEqual([]);
  });
});
