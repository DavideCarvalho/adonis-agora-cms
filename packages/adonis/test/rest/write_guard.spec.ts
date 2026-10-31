import { afterEach, describe, expect, test, vi } from 'vitest';
import { resolveApiToken } from '../../src/auth/api_tokens.js';
import { collection, createApiToken, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { type RouteContext, registerCmsRoutes } from '../../src/rest/routes.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  db: { id: 'uuid' },
  collections: [
    collection('open', { fields: [fields.text('title')] }),
    collection('read_only_rule', { access: { read: () => true }, fields: [fields.text('title')] }),
    collection('ruled', {
      access: { create: () => true },
      fields: [fields.text('title')],
    }),
  ],
});

let kit: TestCms;
afterEach(() => kit?.destroy());

type Handler = (context: unknown) => Promise<unknown>;

async function mount(options: { requireUserForWrites: boolean; user?: unknown }) {
  kit = await createTestCms({ config });
  const cms = createCms({ config, client: kit.client });
  const routes = new Map<string, Handler>();
  const add = (method: string) => (path: string, handler: Handler) => {
    routes.set(`${method} ${path}`, handler);
  };
  registerCmsRoutes(
    { get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') } as never,
    cms,
    {
      requireUserForWrites: options.requireUserForWrites,
      resolveToken: (token) => resolveApiToken(cms.repoContext(), token),
      resolveContext: async () => ({ user: options.user ?? null, tenant: null }),
    },
  );
  /** The shape of a real Adonis context: the method is on the request, never on the context. */
  const post = async (slug: string, token?: string) => {
    const json = vi.fn();
    const context: RouteContext = {
      params: { slug },
      request: {
        method: () => 'POST',
        qs: () => ({}),
        body: () => ({ title: 'x' }),
        headers: () => (token ? { authorization: `Bearer ${token}` } : {}),
      },
      response: { status: (code: number) => ({ json: (body: unknown) => json(code, body) }) },
    } as never;
    await routes.get('POST /api/cms/collections/:slug')?.(context);
    return json.mock.calls[0]?.[0] as number;
  };
  return { cms, post };
}

describe('anonymous writes', () => {
  test('refused with no rule when required, whatever the context looks like', async () => {
    const { post } = await mount({ requireUserForWrites: true });
    expect(await post('open')).toBe(401);
  });

  test('an access rule decides for itself', async () => {
    const { post } = await mount({ requireUserForWrites: true });
    expect(await post('ruled')).toBe(201);
  });

  test('a rule for reading does not open writing', async () => {
    const { post } = await mount({ requireUserForWrites: true });
    expect(await post('read_only_rule')).toBe(401);
  });

  test('a signed-in user passes', async () => {
    const { post } = await mount({ requireUserForWrites: true, user: { id: '1' } });
    expect(await post('open')).toBe(201);
  });

  test('allowed when not required', async () => {
    const { post } = await mount({ requireUserForWrites: false });
    expect(await post('open')).toBe(201);
  });
});

describe('API tokens', () => {
  test('a read-only token cannot write on a real context', async () => {
    const { cms, post } = await mount({ requireUserForWrites: true });
    const token = await createApiToken(cms.repoContext(), { name: 'ro', abilities: ['read'] });
    expect(await post('open', token as string)).toBe(403);
  });

  test('a write token can', async () => {
    const { cms, post } = await mount({ requireUserForWrites: true });
    const token = await createApiToken(cms.repoContext(), {
      name: 'rw',
      abilities: ['read', 'write'],
    });
    expect(await post('open', token as string)).toBe(201);
  });
});
