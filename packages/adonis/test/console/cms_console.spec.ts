import { afterEach, describe, expect, it } from 'vitest';
import { createCmsConsole } from '../../src/console/cms_console.js';
import { AGORA_CONSOLES_BINDING, type AgoraConsoleRegistry } from '../../src/console/registry.js';
import { collection, defineConfig, fields, global } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  db: { id: 'uuid' },
  versions: { drafts: true },
  admin: { title: 'Blog' },
  collections: [
    collection('posts', {
      labels: { singular: 'Post', plural: 'Posts' },
      admin: { useAsTitle: 'title' },
      fields: [fields.text('title'), fields.slug('slug', { from: 'title' })],
    }),
    collection('secrets', {
      admin: { useAsTitle: 'title' },
      access: { read: ({ user }) => Boolean(user) },
      fields: [fields.text('title')],
    }),
    collection('notes', {
      labels: { singular: 'Note', plural: 'Notes' },
      admin: { useAsTitle: 'title' },
      fields: [
        fields.tabs('main', { tabs: [{ label: 'Content', fields: [fields.text('title')] }] }),
      ],
    }),
    collection('untitled', { fields: [fields.number('count')] }),
  ],
  globals: [global('site', { fields: [fields.text('name')] })],
});

let kit: TestCms;
afterEach(() => kit?.destroy());

type Handler = (context: unknown) => Promise<unknown>;

function fakeContainer() {
  const values = new Map<string, unknown>();
  return {
    values,
    hasBinding: (key: string) => values.has(key),
    bindValue: (key: string, value: unknown) => void values.set(key, value),
    make: async (key: string) => values.get(key),
  };
}

function ctxFor(options: { q?: string; csrfToken?: string } = {}) {
  const captured: { status?: number; body?: unknown; headers: Record<string, string> } = {
    headers: {},
  };
  return {
    captured,
    ctx: {
      params: {},
      request: {
        qs: () => (options.q === undefined ? {} : { q: options.q }),
        body: () => ({}),
        headers: () => ({}),
        ...(options.csrfToken ? { csrfToken: options.csrfToken } : {}),
      },
      response: {
        header(name: string, value: string) {
          captured.headers[name] = value;
        },
        status(code: number) {
          captured.status = code;
          return {
            json(payload: unknown) {
              captured.body = payload;
            },
          };
        },
      },
    },
  };
}

async function mount(
  options: { user?: unknown; inProduction?: boolean; cmsConfig?: typeof config } = {},
) {
  const cmsConfig = options.cmsConfig ?? config;
  kit = await createTestCms({ config: cmsConfig });
  const cms = createCms({ config: cmsConfig, client: kit.client });
  const console = createCmsConsole({
    cms,
    request: { resolveContext: async () => ({ user: options.user ?? null, tenant: null }) },
    inProduction: options.inProduction ?? false,
  });
  return { cms, console };
}

describe('createCmsConsole', () => {
  it('opens to a signed-in reader, and to anyone outside production', async () => {
    const { console } = await mount({ inProduction: true });
    expect(await console.authorize(ctxFor().ctx)).toEqual({
      allowed: false,
      reason: 'unauthenticated',
    });
    const signedIn = await mount({ inProduction: true, user: { id: 1, email: 'ann@x.test' } });
    expect(await signedIn.console.authorize(ctxFor().ctx)).toEqual({ allowed: true });
    const dev = await mount();
    expect(await dev.console.authorize(ctxFor().ctx)).toEqual({ allowed: true });
  });

  it('refuses a principal that may read nothing', async () => {
    const closed = defineConfig({
      db: { id: 'uuid' },
      collections: [
        collection('posts', { access: { read: () => false }, fields: [fields.text('title')] }),
      ],
    });
    const { console } = await mount({ cmsConfig: closed as typeof config });
    expect(await console.authorize(ctxFor().ctx)).toEqual({ allowed: false, reason: 'forbidden' });
  });

  it('searches documents by title or slug, best match first, as the REST API reads them', async () => {
    const { cms, console } = await mount();
    const posts = cms.collection('posts' as never);
    const exact = await posts.create({ title: 'Launch' } as never);
    await posts.create({ title: 'Launch day recap' } as never);
    await posts.create({ title: 'Other', slug: 'pre-launch-notes' } as never);
    await cms.collection('secrets' as never).create(
      { title: 'Launch codes' } as never,
      {
        overrideAccess: true,
      } as never,
    );

    const hits = await console.search(ctxFor().ctx, 'LAUNCH', 5);
    expect(hits.map((hit) => hit.title)).toEqual(['Launch', 'Launch day recap', 'Other']);
    expect(hits[0]).toEqual({
      title: 'Launch',
      subtitle: 'Post · launch',
      href: `/admin#/collections/posts/${String((exact as { id: unknown }).id)}`,
    });
    // A title inside a layout container (tabs) is still a column.
    await cms.collection('notes' as never).create({ title: 'Tabbed launch' } as never);
    expect((await console.search(ctxFor().ctx, 'tabbed', 5))[0]).toMatchObject({
      title: 'Tabbed launch',
      subtitle: 'Note',
    });
    // Anonymous: the `secrets` read rule hides its documents, drafts are not searched.
    expect(hits.some((hit) => hit.title === 'Launch codes')).toBe(false);
    expect(await console.search(ctxFor().ctx, '  ', 5)).toEqual([]);
    expect(await console.search(ctxFor().ctx, 'launch', 1)).toHaveLength(1);
  });

  it('finds what a signed-in editor may read, drafts included', async () => {
    const { cms, console } = await mount({ user: { id: 1, email: 'ann@x.test' } });
    await cms
      .collection('posts' as never)
      .create({ title: 'Draft launch' } as never, { draft: true } as never);
    await cms.collection('secrets' as never).create({ title: 'Launch codes' } as never);
    const titles = (await console.search(ctxFor().ctx, 'launch', 5)).map((hit) => hit.title);
    expect(titles).toContain('Draft launch');
    expect(titles).toContain('Launch codes');
  });

  it('builds the data-block fields: switcher, search, viewer, sign-out', async () => {
    const { console } = await mount({
      user: { name: 'Ann Lee', email: 'ann@x.test', role: 'admin' },
    });
    const container = fakeContainer();
    const routes = new Map<string, Handler>();
    const router = {
      get: (path: string, handler: Handler) => routes.set(`GET ${path}`, handler),
      post: () => undefined,
      patch: () => undefined,
      delete: () => undefined,
    };
    await console.register(container, router);
    const registry = container.values.get(AGORA_CONSOLES_BINDING) as AgoraConsoleRegistry;
    expect(
      registry.entries.map((entry) => [entry.id, entry.icon, entry.path, entry.title]),
    ).toEqual([['cms', 'cms', '/admin', 'Blog']]);
    registry.account = { signOut: '/account/logout' };

    expect(await console.shellFields(ctxFor({ csrfToken: 'tok' }).ctx)).toEqual({
      switcher: { endpoint: '/api/cms/consoles', others: 0 },
      search: { endpoint: '/api/cms/consoles/search' },
      viewer: { label: 'Ann Lee', email: 'ann@x.test', role: 'admin' },
      signOut: { action: '/account/logout', csrfToken: 'tok' },
    });

    const search = ctxFor({ q: 'nothing-here' });
    await routes.get('GET /api/cms/consoles/search')?.(search.ctx);
    expect(search.captured).toMatchObject({
      status: 200,
      body: { version: 1, q: 'nothing-here', results: [] },
      headers: { 'cache-control': 'private, no-store' },
    });
    const list = ctxFor();
    await routes.get('GET /api/cms/consoles')?.(list.ctx);
    expect(list.captured.body).toEqual({ version: 1, current: 'cms', consoles: [] });
  });

  it('refuses the console endpoints to a request the gate refuses', async () => {
    const { console } = await mount({ inProduction: true });
    const routes = new Map<string, Handler>();
    await console.register(fakeContainer(), {
      get: (path: string, handler: Handler) => routes.set(path, handler),
      post: () => undefined,
      patch: () => undefined,
      delete: () => undefined,
    });
    const denied = ctxFor({ q: 'x' });
    await routes.get('/api/cms/consoles/search')?.(denied.ctx);
    expect(denied.captured.status).toBe(401);
  });

  it("signs out through the CMS's own logout with auth.builtin", async () => {
    const builtin = defineConfig({
      ...config,
      integrations: { auth: { builtin: {}, resolveUser: async () => null } as never },
    });
    const { console } = await mount({ cmsConfig: builtin as typeof config });
    expect((await console.shellFields(ctxFor({ csrfToken: 'tok' }).ctx)).signOut).toEqual({
      action: '/api/cms/auth/logout',
      csrfToken: 'tok',
    });
  });
});
