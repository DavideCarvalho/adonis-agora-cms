import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { registerCmsRoutes } from '../../src/rest/routes.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR' },
  collections: [collection('posts', { fields: [fields.text('title', { localized: true })] })],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

type Route = { method: string; path: string; handler: (ctx: unknown) => Promise<unknown> };

function mount(cms: ReturnType<typeof createCms>, locale?: string) {
  const routes: Route[] = [];
  const push = (method: string) => (path: string, handler: (ctx: unknown) => Promise<unknown>) =>
    routes.push({ method, path, handler });

  registerCmsRoutes(
    { get: push('GET'), post: push('POST'), patch: push('PATCH'), delete: push('DELETE') },
    cms,
    { ...(locale !== undefined ? { resolveLocale: () => locale } : {}) },
  );

  return routes.find(
    (route) => route.method === 'GET' && route.path === '/api/cms/collections/:slug',
  );
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

describe('content locale negotiation', () => {
  test('uses the host locale when the request does not pass ?locale', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'u1' } });
    await cms.collection('posts').create({ title: { 'pt-BR': 'Oi', en: 'Hi' } });

    const route = mount(cms, 'en');
    const call = ctxFor({ slug: 'posts' });
    await route?.handler(call.ctx);

    const docs = (call.captured.body as { docs: { title: string }[] }).docs;
    expect(docs[0]?.title).toBe('Hi');
  });

  test('?locale wins over the negotiated locale', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'u1' } });
    await cms.collection('posts').create({ title: { 'pt-BR': 'Oi', en: 'Hi' } });

    const route = mount(cms, 'en');
    const call = ctxFor({ slug: 'posts' }, { locale: 'pt-BR' });
    await route?.handler(call.ctx);

    const docs = (call.captured.body as { docs: { title: string }[] }).docs;
    expect(docs[0]?.title).toBe('Oi');
  });

  test('without negotiation the response keeps the locale map', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'u1' } });
    await cms.collection('posts').create({ title: { 'pt-BR': 'Oi', en: 'Hi' } });

    const route = mount(cms);
    const call = ctxFor({ slug: 'posts' });
    await route?.handler(call.ctx);

    const docs = (call.captured.body as { docs: { title: unknown }[] }).docs;
    expect(docs[0]?.title).toEqual({ 'pt-BR': 'Oi', en: 'Hi' });
  });
});
