import { describe, expect, test } from 'vitest';
import { ContentClientError, createContentClient, toSearch } from '../src/index.js';

function recorder(body: unknown = { docs: [], totalDocs: 0 }, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('cms-client', () => {
  test('sends the bearer token and the filter wire format', async () => {
    const { calls, fetchImpl } = recorder();
    const cms = createContentClient({
      baseUrl: 'https://cms.test/api/cms',
      token: 'cms_x',
      fetch: fetchImpl,
    });

    await cms.collection('posts').find({
      where: { status: { equals: 'published' } },
      sort: '-publishedAt',
      limit: 10,
      locale: 'pt-BR',
    });

    const call = calls[0];
    expect(call?.headers.authorization).toBe('Bearer cms_x');
    const url = decodeURIComponent(call?.url ?? '');
    expect(url).toContain('where[status][equals]=published');
    expect(url).toContain('sort=-publishedAt');
    expect(url).toContain('locale=pt-BR');
  });

  test('has no tenant parameter — the tenant comes from the token', () => {
    const cms = createContentClient({ baseUrl: 'https://cms.test', token: 'cms_x' });
    expect(Object.keys(cms)).toEqual(['collection', 'global']);
  });

  test('maps API errors to ContentClientError', async () => {
    const { fetchImpl } = recorder({ error: { code: 'CMS_FORBIDDEN', message: 'read-only' } }, 403);
    const cms = createContentClient({ baseUrl: 'https://cms.test', fetch: fetchImpl });

    await expect(cms.collection('posts').find()).rejects.toMatchObject({
      status: 403,
      code: 'CMS_FORBIDDEN',
    });
  });

  test('toSearch ignores undefined and stringifies scalars', () => {
    expect(toSearch({ limit: 5, page: undefined, depth: 1 })).toBe('?limit=5&depth=1');
  });

  test('error class is exported', () => {
    expect(new ContentClientError(500, {})).toBeInstanceOf(Error);
  });
});
