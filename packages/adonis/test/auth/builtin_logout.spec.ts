import { describe, expect, it } from 'vitest';
import { type BuiltinAuth, registerAuthRoutes } from '../../src/auth/builtin.js';

type Handler = (context: unknown) => Promise<unknown>;

function logoutRoute() {
  const routes = new Map<string, Handler>();
  const add = (method: string) => (path: string, handler: Handler) => {
    routes.set(`${method} ${path}`, handler);
  };
  registerAuthRoutes(
    { get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') },
    {} as never,
    {
      builtin: { secret: 'x'.repeat(32), collection: 'users', ttlSeconds: 60, mail: undefined },
    } as BuiltinAuth,
    { prefix: '/api/cms', adminPath: '/admin' },
  );
  return routes.get('POST /api/cms/auth/logout') as Handler;
}

function call(contentType: string) {
  const headers: Record<string, string> = {};
  const answer: { status?: number; body?: unknown } = {};
  return logoutRoute()({
    params: {},
    request: {
      body: () => ({}),
      header: (name: string) => (name === 'content-type' ? contentType : undefined),
    },
    response: {
      header: (name: string, value: string) => void (headers[name] = value),
      status: (code: number) => ({
        json: (body: unknown) => void Object.assign(answer, { status: code, body }),
      }),
    },
  }).then(() => ({ headers, answer }));
}

describe('builtin logout', () => {
  it('answers the panel fetch with JSON and clears the session', async () => {
    const { headers, answer } = await call('application/json');
    expect(answer.status).toBe(200);
    expect(headers['Set-Cookie']).toContain('cms_session=;');
    expect(headers.Location).toBeUndefined();
  });

  it("sends the console sidebar's form POST back to the panel", async () => {
    const { headers, answer } = await call('application/x-www-form-urlencoded; charset=UTF-8');
    expect(answer.status).toBe(303);
    expect(headers.Location).toBe('/admin');
    expect(headers['Set-Cookie']).toContain('Max-Age=0');
  });
});
