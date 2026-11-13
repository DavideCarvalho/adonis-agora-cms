import { afterEach, describe, expect, test } from 'vitest';
import { resolveApiToken } from '../../src/auth/api_tokens.js';
import type { DevTool, DevToolCall } from '../../src/dev_tools/contract.js';
import { cmsDevTools, registerCmsDevTools } from '../../src/dev_tools/tools.js';
import { collection, createApiToken, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  db: { id: 'uuid' },
  versions: { drafts: true },
  localization: { locales: ['en', 'pt-BR'], defaultLocale: 'en' },
  collections: [
    collection('posts', {
      fields: [
        fields.text('title', { required: true, localized: true }),
        fields.text('secret', { access: { read: () => false } }),
      ],
    }),
    collection('locked', {
      access: { create: () => false, read: () => true },
      fields: [fields.text('title')],
    }),
  ],
  globals: [{ slug: 'site', fields: [fields.text('name')] }],
});

let kit: TestCms | undefined;
afterEach(async () => {
  await kit?.destroy();
  kit = undefined;
});

type Ctx = {
  request: { headers(): Record<string, string>; hostname(): string };
  i18n?: { locale: string };
};

function ctxOf(options: { token?: string; locale?: string } = {}): Ctx {
  return {
    request: {
      headers: () => (options.token ? { authorization: `Bearer ${options.token}` } : {}),
      hostname: () => 'localhost',
    },
    ...(options.locale ? { i18n: { locale: options.locale } } : {}),
  };
}

async function setup(options: { user?: unknown; requireUserForWrites?: boolean } = {}) {
  kit = await createTestCms({ config });
  const cms = createCms({ config, client: kit.client });
  const tools = cmsDevTools({
    cms,
    request: {
      requireUserForWrites: options.requireUserForWrites ?? false,
      resolveToken: (token) => resolveApiToken(cms.repoContext(), token),
      resolveLocale: (context) => (context as Ctx).i18n?.locale,
      resolveContext: async () => ({ user: options.user ?? null, tenant: null }),
    },
  });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const run = (name: string, input: Record<string, unknown> = {}, ctx: Ctx = ctxOf()) => {
    const tool = byName.get(name) as DevTool;
    const call: DevToolCall = {
      ctx,
      caller: { id: 'dev-open', via: 'open' },
      limits: { maxRows: 100, maxBytes: 48 * 1024 },
    };
    return tool.run(input, call) as Promise<Record<string, unknown>>;
  };
  return { cms, tools, run };
}

describe('cms dev tools', () => {
  test('names, kinds and the hub contract', async () => {
    const { tools } = await setup();
    expect(tools.map((tool) => [tool.name, tool.kind, tool.destructive === true])).toEqual([
      ['cms_list_collections', 'read', false],
      ['cms_get_collection', 'read', false],
      ['cms_list_documents', 'read', false],
      ['cms_get_document', 'read', false],
      ['cms_list_versions', 'read', false],
      ['cms_get_version', 'read', false],
      ['cms_get_global', 'read', false],
      ['cms_create_document', 'action', false],
      ['cms_update_document', 'action', false],
      ['cms_publish_document', 'action', false],
      ['cms_unpublish_document', 'action', false],
      ['cms_delete_document', 'action', true],
      ['cms_restore_version', 'action', false],
      ['cms_update_global', 'action', false],
    ]);
    const scalar = new Set(['string', 'number', 'integer', 'boolean', 'array']);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^cms_[a-z]+(_[a-z0-9]+)+$/);
      expect(tool.input.type).toBe('object');
      for (const property of Object.values(tool.input.properties)) {
        expect(scalar.has(property.type)).toBe(true);
        if (property.type === 'array') expect(property.items).toEqual({ type: 'string' });
      }
      for (const key of tool.input.required ?? [])
        expect(tool.input.properties).toHaveProperty(key);
    }
  });

  test('lists the content model', async () => {
    const { run } = await setup();
    const model = await run('cms_list_collections');
    expect(model.next).toBeNull();
    expect(model.locales).toEqual(['en', 'pt-BR']);
    expect(model.items).toEqual([
      expect.objectContaining({ slug: 'posts', kind: 'collection', drafts: true }),
      expect.objectContaining({ slug: 'locked', kind: 'collection' }),
      expect.objectContaining({ slug: 'site', kind: 'global' }),
    ]);
    const posts = await run('cms_get_collection', { slug: 'posts' });
    expect(posts.fields).toEqual([
      { name: 'title', type: 'text', required: true, localized: true },
      { name: 'secret', type: 'text' },
    ]);
    expect(posts.filterable).toContain('title');
  });

  test('drafts need a signed-in user, as on the REST API', async () => {
    const { run } = await setup();
    await expect(run('cms_list_documents', { collection: 'posts', draft: true })).rejects.toThrow(
      /CMS_FORBIDDEN/,
    );
  });

  test('writes, drafts, publish and versions through the Local API', async () => {
    const { run } = await setup({ user: { id: '1' } });
    const created = await run('cms_create_document', {
      collection: 'posts',
      data: JSON.stringify({ title: 'Hello', secret: 'shh' }),
      draft: true,
    });
    const id = String(created.id);

    // A draft is not published: the default list hides it, `draft: true` shows it.
    const published = await run('cms_list_documents', { collection: 'posts' });
    expect(published.items).toEqual([]);
    const drafts = await run('cms_list_documents', { collection: 'posts', draft: true });
    expect(drafts).toMatchObject({ next: null, total: 1 });

    await run('cms_publish_document', { collection: 'posts', id });
    const listed = await run('cms_list_documents', {
      collection: 'posts',
      filter: JSON.stringify({ title: { contains: 'Hell' } }),
    });
    expect(listed.items).toHaveLength(1);
    // Field-level access applies: the hidden field never comes back.
    expect((listed.items as Record<string, unknown>[])[0]).not.toHaveProperty('secret');

    await run('cms_update_document', {
      collection: 'posts',
      id,
      data: JSON.stringify({ title: { 'pt-BR': 'Olá' } }),
    });
    const pt = await run(
      'cms_get_document',
      { collection: 'posts', id },
      ctxOf({ locale: 'pt-BR' }),
    );
    expect(pt.title).toBe('Olá');
    const en = await run('cms_get_document', { collection: 'posts', id, locale: 'en' });
    expect(en.title).toBe('Hello');

    const versions = await run('cms_list_versions', { collection: 'posts', id, limit: 1 });
    expect(versions.items).toHaveLength(1);
    expect(versions.total).toBeGreaterThan(1);
    expect(versions.next).toBe(2);

    const version = await run('cms_get_version', {
      collection: 'posts',
      id,
      version: 1,
      snapshot: true,
    });
    expect(version.version).toBe(1);

    await run('cms_delete_document', { collection: 'posts', id });
    await expect(run('cms_get_document', { collection: 'posts', id })).rejects.toThrow(/not found/);
  });

  test('access rules and validation answer as tool errors', async () => {
    const { run } = await setup();
    await expect(
      run('cms_create_document', { collection: 'locked', data: '{"title":"x"}' }),
    ).rejects.toThrow(/CMS_(FORBIDDEN|UNAUTHORIZED)/);
    await expect(
      run('cms_create_document', { collection: 'posts', data: '{"secret":"x"}' }),
    ).rejects.toThrow(/title/);
    await expect(run('cms_create_document', { collection: 'posts', data: '[1]' })).rejects.toThrow(
      /JSON object/,
    );
    await expect(
      run('cms_list_documents', { collection: 'posts', filter: '{"nope":"x"}' }),
    ).rejects.toThrow(/Unknown filter field/);
  });

  test('writes need a signed-in user when the REST routes do', async () => {
    const anonymous = await setup({ requireUserForWrites: true });
    await expect(
      anonymous.run('cms_create_document', { collection: 'posts', data: '{"title":"x"}' }),
    ).rejects.toThrow(/CMS_UNAUTHORIZED/);
    await kit?.destroy();

    const signedIn = await setup({ requireUserForWrites: true, user: { id: '1' } });
    const doc = await signedIn.run('cms_create_document', {
      collection: 'posts',
      data: '{"title":"x"}',
    });
    expect(doc.id).toBeDefined();
  });

  test('a read-only CMS API token cannot write', async () => {
    const { cms, run } = await setup();
    const token = await createApiToken(cms.repoContext(), { name: 'ro', abilities: ['read'] });
    await expect(
      run('cms_create_document', { collection: 'posts', data: '{"title":"x"}' }, ctxOf({ token })),
    ).rejects.toThrow(/read-only/);
    const list = await run('cms_list_documents', { collection: 'posts' }, ctxOf({ token }));
    expect(list.items).toEqual([]);
  });

  test('globals', async () => {
    const { run } = await setup();
    await run('cms_update_global', { slug: 'site', data: '{"name":"Acme"}' });
    expect((await run('cms_get_global', { slug: 'site' })).name).toBe('Acme');
  });
});

describe('registerCmsDevTools', () => {
  const options = () => ({
    cms: {} as never,
    request: {},
  });

  test('skips without a hub', async () => {
    const container = { hasBinding: () => false, make: async () => undefined };
    expect(await registerCmsDevTools(container, options())).toBe('no-hub');
  });

  test('needs a hub that gates libs without a console', async () => {
    const registered: unknown[] = [];
    const old = { version: 1, register: (lib: unknown) => registered.push(lib) };
    const container = { hasBinding: () => true, make: async () => old };
    expect(await registerCmsDevTools(container, options())).toBe('unsupported');
    expect(registered).toEqual([]);
  });

  test('registers as `cms` without its own authorize', async () => {
    const registered: { lib: string; authorize?: unknown; tools: DevTool[] }[] = [];
    const hub = {
      version: 1,
      supports: (feature: string) => feature === 'endpoint-authorize',
      register: (lib: (typeof registered)[number]) => registered.push(lib),
    };
    const container = {
      hasBinding: (name: string) => name === 'agora.devTools',
      make: async () => hub,
    };
    expect(await registerCmsDevTools(container, options())).toBe('registered');
    expect(registered[0]?.lib).toBe('cms');
    expect(registered[0]?.authorize).toBeUndefined();
    expect(registered[0]?.tools.length).toBe(14);
  });
});
