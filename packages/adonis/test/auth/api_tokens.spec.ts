import { afterEach, describe, expect, test } from 'vitest';
import {
  createApiToken,
  hashApiToken,
  listApiTokens,
  resolveApiToken,
  tokenCan,
} from '../../src/auth/api_tokens.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';
import { repositoryConfig } from '../fixtures/repo_config.js';

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

async function setup() {
  kit = await createTestCms({ config: repositoryConfig });
  return createCms({ config: repositoryConfig, client: kit.client });
}

describe('api tokens', () => {
  test('creates, resolves and never stores the plain token', async () => {
    const cms = await setup();
    const token = await createApiToken(cms.repoContext(), {
      name: 'acme-site',
      tenant: 'acme',
      abilities: ['read'],
    });

    expect(token.startsWith('cms_')).toBe(true);

    const principal = await resolveApiToken(cms.repoContext(), token);
    expect(principal).toMatchObject({ name: 'acme-site', tenant: 'acme', abilities: ['read'] });

    const stored = await kit.db('cms_api_tokens').select('token_hash').first();
    expect(stored?.token_hash).toBe(hashApiToken(token));
    expect(stored?.token_hash).not.toBe(token);
  });

  test('unknown and expired tokens resolve to null', async () => {
    const cms = await setup();
    expect(await resolveApiToken(cms.repoContext(), 'cms_nope')).toBeNull();

    const expired = await createApiToken(cms.repoContext(), {
      name: 'old',
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await resolveApiToken(cms.repoContext(), expired)).toBeNull();
  });

  test('read is implied and write must be granted', async () => {
    const cms = await setup();
    const token = await createApiToken(cms.repoContext(), { name: 'reader' });
    const principal = await resolveApiToken(cms.repoContext(), token);

    expect(principal && tokenCan(principal, 'read')).toBe(true);
    expect(principal && tokenCan(principal, 'write')).toBe(false);

    const writer = await resolveApiToken(
      cms.repoContext(),
      await createApiToken(cms.repoContext(), { name: 'writer', abilities: ['read', 'write'] }),
    );
    expect(writer && tokenCan(writer, 'write')).toBe(true);
  });

  test('lists tokens without exposing hashes', async () => {
    const cms = await setup();
    await createApiToken(cms.repoContext(), { name: 'a', tenant: 'acme' });
    await createApiToken(cms.repoContext(), { name: 'b' });

    const tokens = await listApiTokens(cms.repoContext());
    expect(tokens.map((entry) => entry.name)).toEqual(['b', 'a']);
    expect(JSON.stringify(tokens)).not.toContain('token_hash');
  });
});
