import { describe, expect, it } from 'vitest';
import {
  detectAttemptStore,
  type LoginAttemptStore,
  limiterAttemptStore,
  MemoryAttemptStore,
  redisAttemptStore,
} from '../../src/auth/attempt_store.js';
import { type BuiltinAuth, cmsAuth, registerAuthRoutes } from '../../src/auth/builtin.js';

type Handler = (context: unknown) => Promise<unknown>;

function loginRoute(
  loginAttempts?: BuiltinAuth['builtin']['loginAttempts'],
  attemptStore?: LoginAttemptStore,
) {
  const routes = new Map<string, Handler>();
  const add = (method: string) => (path: string, handler: Handler) => {
    routes.set(`${method} ${path}`, handler);
  };
  // No user ever matches: every attempt fails, which is all throttling looks at.
  const cms = {
    repoContext: () => ({}),
    collection: () => ({ find: async () => ({ docs: [] }) }),
  };
  registerAuthRoutes(
    { get: add('GET'), post: add('POST'), patch: add('PATCH'), delete: add('DELETE') },
    cms as never,
    {
      builtin: {
        secret: 'x'.repeat(32),
        collection: 'users',
        ttlSeconds: 60,
        mail: undefined,
        ...(loginAttempts ? { loginAttempts } : {}),
      },
    } as BuiltinAuth,
    { prefix: '/api/cms', adminPath: '/admin', ...(attemptStore ? { attemptStore } : {}) },
  );
  const handler = routes.get('POST /api/cms/auth/login') as Handler;
  return async (ip: string, email: string) => {
    let status = 0;
    await handler({
      params: {},
      request: { body: () => ({ email, password: 'wrong-password' }), ip: () => ip },
      response: {
        header: () => undefined,
        status: (code: number) => ({
          json: () => {
            status = code;
          },
        }),
      },
    });
    return status;
  };
}

describe('login throttling', () => {
  it('blocks one address spraying many e-mails', async () => {
    const login = loginRoute({ perAccount: 10, perIp: 3 });
    for (let index = 0; index < 3; index++) {
      expect(await login('1.1.1.1', `user${index}@example.com`)).toBe(401);
    }
    expect(await login('1.1.1.1', 'fresh@example.com')).toBe(429);
    // Another address is not affected.
    expect(await login('2.2.2.2', 'fresh@example.com')).toBe(401);
  });

  it('still blocks one e-mail after its own limit', async () => {
    const login = loginRoute({ perAccount: 2, perIp: 50 });
    expect(await login('1.1.1.1', 'a@example.com')).toBe(401);
    expect(await login('1.1.1.1', 'a@example.com')).toBe(401);
    expect(await login('1.1.1.1', 'a@example.com')).toBe(429);
    expect(await login('1.1.1.1', 'b@example.com')).toBe(401);
  });
});

describe('MemoryAttemptStore', () => {
  it('drops expired keys so the map shrinks', async () => {
    let now = 0;
    const store = new MemoryAttemptStore(100, () => now);
    for (let index = 0; index < 50; index++) await store.increment(`k${index}`, 1000);
    expect(store.size).toBe(50);
    now = 5000;
    await store.increment('late', 1000);
    expect(store.size).toBe(1);
  });

  it('never holds more than its capacity, evicting the oldest', async () => {
    const store = new MemoryAttemptStore(10, () => 0);
    for (let index = 0; index < 1000; index++) await store.increment(`k${index}`, 60_000);
    expect(store.size).toBe(10);
    expect(await store.count('k999', 60_000)).toBe(1);
    expect(await store.count('k0', 60_000)).toBe(0);
  });

  it('forgets a failure once the window passes', async () => {
    let now = 0;
    const store = new MemoryAttemptStore(100, () => now);
    await store.increment('k', 1000);
    expect(await store.increment('k', 1000)).toBe(2);
    now = 1001;
    expect(await store.count('k', 1000)).toBe(0);
    expect(await store.increment('k', 1000)).toBe(1);
  });
});

/** A Redis stand-in shared by two "processes". */
function fakeRedis() {
  const data = new Map<string, number>();
  return {
    data,
    async get(key: string) {
      return data.has(key) ? String(data.get(key)) : null;
    },
    async incr(key: string) {
      data.set(key, (data.get(key) ?? 0) + 1);
      return data.get(key) as number;
    },
    async pexpire() {
      return 1;
    },
    async del(key: string) {
      data.delete(key);
      return 1;
    },
  };
}

describe('shared login attempt stores', () => {
  it('a shared store makes the limit hold across processes', async () => {
    const redis = fakeRedis();
    const first = loginRoute({ perAccount: 10, perIp: 2 }, redisAttemptStore(redis));
    const second = loginRoute({ perAccount: 10, perIp: 2 }, redisAttemptStore(redis));
    expect(await first('1.1.1.1', 'a@example.com')).toBe(401);
    expect(await second('1.1.1.1', 'b@example.com')).toBe(401);
    expect(await first('1.1.1.1', 'c@example.com')).toBe(429);
    expect(await second('1.1.1.1', 'c@example.com')).toBe(429);
    expect([...redis.data.keys()].every((key) => key.startsWith('cms:login-attempts:'))).toBe(true);
  });

  it('an explicit loginAttempts.store wins over the detected one', async () => {
    const own = fakeRedis();
    const detected = fakeRedis();
    const login = loginRoute(
      { perIp: 5, store: redisAttemptStore(own) },
      redisAttemptStore(detected),
    );
    await login('1.1.1.1', 'a@example.com');
    expect(own.data.size).toBe(2);
    expect(detected.data.size).toBe(0);
  });

  it('a failing store falls back to memory instead of failing the login', async () => {
    const broken: LoginAttemptStore = {
      count: () => Promise.reject(new Error('down')),
      increment: () => Promise.reject(new Error('down')),
      clear: () => Promise.reject(new Error('down')),
    };
    const original = console.error;
    console.error = () => undefined;
    try {
      const login = loginRoute({ perAccount: 10, perIp: 1 }, broken);
      expect(await login('1.1.1.1', 'a@example.com')).toBe(401);
      expect(await login('1.1.1.1', 'b@example.com')).toBe(429);
    } finally {
      console.error = original;
    }
  });

  it('counts through @adonisjs/limiter without letting it block on its own', async () => {
    const consumed = new Map<string, number>();
    const uses: unknown[] = [];
    const manager = {
      use(options: { requests: number; duration: number }) {
        uses.push(options);
        return {
          async get(key: string) {
            return consumed.has(key) ? { consumed: consumed.get(key) as number } : null;
          },
          async increment(key: string) {
            consumed.set(key, (consumed.get(key) ?? 0) + 1);
            return { consumed: consumed.get(key) as number };
          },
          async delete(key: string) {
            consumed.delete(key);
          },
        };
      },
    };
    const store = limiterAttemptStore(manager);
    expect(await store.increment('k', 900_000)).toBe(1);
    expect(await store.increment('k', 900_000)).toBe(2);
    expect(await store.count('k', 900_000)).toBe(2);
    await store.clear('k', 900_000);
    expect(await store.count('k', 900_000)).toBe(0);
    expect(uses[0]).toEqual({ requests: Number.MAX_SAFE_INTEGER, duration: 900 });
  });

  it('detects @adonisjs/limiter first, then @adonisjs/redis, else nothing', async () => {
    const container = (bindings: Record<string, unknown>) => ({
      hasBinding: (name: string) => name in bindings,
      make: async (name: string) => bindings[name],
    });
    const limiter = { use: () => ({}) };
    expect(
      (await detectAttemptStore(container({ 'limiter.manager': limiter, redis: fakeRedis() })))
        ?.source,
    ).toBe('@adonisjs/limiter');
    expect((await detectAttemptStore(container({ redis: fakeRedis() })))?.source).toBe(
      '@adonisjs/redis',
    );
    expect(await detectAttemptStore(container({ redis: {} }))).toBeNull();
    expect(await detectAttemptStore(container({}))).toBeNull();
  });
});

describe('cmsAuth loginAttempts', () => {
  it('refuses a store without the store methods', () => {
    expect(() =>
      cmsAuth({ secret: 'x'.repeat(32), loginAttempts: { store: {} as never } }),
    ).toThrow(/loginAttempts\.store must have count/);
  });

  it('refuses a limit that would turn throttling off', () => {
    expect(() => cmsAuth({ secret: 'x'.repeat(32), loginAttempts: { perIp: 0 } })).toThrow(
      /loginAttempts\.perIp must be a positive integer/,
    );
    expect(cmsAuth({ secret: 'x'.repeat(32), loginAttempts: { perIp: 5 } }).builtin).toMatchObject({
      loginAttempts: { perIp: 5 },
    });
  });
});
