import { describe, expect, test } from 'vitest';
import { defineConfig } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { previewUrl, signPreviewToken, verifyPreviewToken } from '../../src/preview/token.js';
import { handlePreviewToken } from '../../src/rest/handlers.js';
import { createTestCms } from '../../src/testing/create_test_cms.js';
import { repositoryConfig } from '../fixtures/repo_config.js';

const claims = { collection: 'posts', documentId: 'p1', userId: 'u1', exp: Date.now() + 60_000 };

describe('preview token', () => {
  test('signs and verifies a token', () => {
    const token = signPreviewToken(claims, 'secret');
    expect(verifyPreviewToken(token, 'secret')).toEqual(claims);
  });

  test('rejects a tampered payload', () => {
    const token = signPreviewToken(claims, 'secret');
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, documentId: 'other' })).toString(
      'base64url',
    );
    expect(verifyPreviewToken(`${forged}.${signature}`, 'secret')).toBeNull();
    expect(payload).toBeTruthy();
  });

  test('rejects an expired token', () => {
    const token = signPreviewToken({ ...claims, exp: Date.now() - 1 }, 'secret');
    expect(verifyPreviewToken(token, 'secret')).toBeNull();
  });

  test('rejects a token signed with another secret', () => {
    const token = signPreviewToken(claims, 'secret');
    expect(verifyPreviewToken(token, 'other')).toBeNull();
  });

  test('builds the iframe URL', () => {
    expect(previewUrl('/preview', 'a.b')).toBe('/preview?token=a.b');
    expect(previewUrl('/preview?lang=pt', 'a.b')).toBe('/preview?lang=pt&token=a.b');
  });
});

describe('GET preview token handler', () => {
  const withPreview = defineConfig({
    ...repositoryConfig,
    admin: { path: '/admin', livePreview: { url: '/preview', secret: 's3cret', ttlSeconds: 60 } },
  });

  test('issues a token the site can verify', async () => {
    const kit = await createTestCms({ config: withPreview });
    try {
      const cms = createCms({ config: withPreview, client: kit.client, user: { id: 'u1' } });
      const response = await handlePreviewToken(cms, {
        params: { slug: 'posts', id: 'p1' },
        query: {},
        body: undefined,
      });

      expect(response.status).toBe(200);
      const body = response.body as { token: string; url: string; expiresIn: number };
      expect(body.expiresIn).toBe(60);
      expect(verifyPreviewToken(body.token, 's3cret')).toMatchObject({
        collection: 'posts',
        documentId: 'p1',
        userId: 'u1',
      });
      expect(body.url.startsWith('/preview?token=')).toBe(true);
    } finally {
      await kit.destroy();
    }
  });

  test('returns 501 when live preview is not configured', async () => {
    const kit = await createTestCms({ config: repositoryConfig });
    try {
      const cms = createCms({ config: repositoryConfig, client: kit.client });
      const response = await handlePreviewToken(cms, {
        params: { slug: 'posts', id: 'p1' },
        query: {},
        body: undefined,
      });
      expect(response.status).toBe(501);
    } finally {
      await kit.destroy();
    }
  });
});
