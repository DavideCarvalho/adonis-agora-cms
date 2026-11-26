import { describe, expect, it } from 'vitest';
import CmsProvider from '../../providers/cms_provider.js';
import { cmsAuth } from '../../src/auth/builtin.js';

function provider(bindings: Record<string, unknown>, inProduction: boolean) {
  const warnings: string[] = [];
  const all = {
    ...bindings,
    logger: { warn: (message: string) => warnings.push(message) },
  } as Record<string, unknown>;
  const app = {
    inProduction,
    container: {
      hasBinding: (name: string) => name in bindings,
      make: async (name: string) => all[name],
    },
  };
  const instance = new CmsProvider(app as never) as unknown as {
    loginAttemptStore(auth: unknown): Promise<unknown>;
  };
  return { instance, warnings };
}

const auth = cmsAuth({ secret: 'x'.repeat(32) });

describe('builtin login attempt store at boot', () => {
  it('uses the redis the app already has, without configuration', async () => {
    const redis = { get: () => null, incr: () => 1, pexpire: () => 1, del: () => 1 };
    const { instance, warnings } = provider({ redis }, true);
    expect(await instance.loginAttemptStore(auth)).toBeTruthy();
    expect(warnings).toEqual([]);
  });

  it('warns once in production that the limits are per process', async () => {
    const { instance, warnings } = provider({}, true);
    expect(await instance.loginAttemptStore(auth)).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/per process.*@adonisjs\/limiter or @adonisjs\/redis/);
  });

  it('stays quiet outside production and when a store is passed', async () => {
    expect((await provider({}, false).instance.loginAttemptStore(auth)) ?? null).toBeNull();
    const own = cmsAuth({
      secret: 'x'.repeat(32),
      loginAttempts: {
        store: { count: async () => 0, increment: async () => 1, clear: async () => {} },
      },
    });
    const { instance, warnings } = provider({}, true);
    expect(await instance.loginAttemptStore(own)).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});
