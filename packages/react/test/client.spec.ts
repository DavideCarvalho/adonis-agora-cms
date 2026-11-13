import { describe, expect, test } from 'vitest';
import { AdminClient, CmsApiError } from '../src/client.js';

function recorder(
  body: unknown = {
    data: [],
    meta: { total: 0, perPage: 20, currentPage: 1, lastPage: 1, firstPage: 1 },
  },
  status = 200,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('AdminClient', () => {
  test('serializes the list query into the filter wire format', async () => {
    const { calls, fetchImpl } = recorder();
    const client = new AdminClient({ fetch: fetchImpl });

    await client.list('posts', {
      filter: { status: { equals: 'published' }, title: 'x', kind: ['a', 'b'] },
      sort: '-createdAt',
      page: 2,
      size: 10,
    });

    const url = calls[0]?.url ?? '';
    expect(url).toContain('/collections/posts?');
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('filter[status][equals]=published');
    expect(decoded).toContain('filter[title]=x');
    expect(decoded).toContain('filter[kind][]=a&filter[kind][]=b');
    expect(decoded).toContain('sort=-createdAt');
    expect(decoded).toContain('page=2&size=10');
  });

  test('pages the version history', async () => {
    const { calls, fetchImpl } = recorder();
    const client = new AdminClient({ fetch: fetchImpl });

    const page = await client.versions('posts', '1', { page: 3, size: 5 });

    expect(calls[0]?.url).toBe('/api/cms/collections/posts/1/versions?page=3&size=5');
    expect(page.meta.total).toBe(0);
  });

  test('maps API errors to CmsApiError with fields', async () => {
    const { fetchImpl } = recorder(
      {
        error: {
          code: 'CMS_VALIDATION',
          message: 'Validation failed',
          fields: { title: 'required' },
        },
      },
      422,
    );
    const client = new AdminClient({ fetch: fetchImpl });

    await expect(client.create('posts', {})).rejects.toMatchObject({
      status: 422,
      code: 'CMS_VALIDATION',
      fields: { title: 'required' },
    });
  });

  test('204 resolves without parsing a body', async () => {
    const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const client = new AdminClient({ fetch: fetchImpl });
    await expect(client.delete('posts', '1')).resolves.toBeUndefined();
  });

  test('error class is exported for instanceof checks', () => {
    expect(new CmsApiError(500, { error: { code: 'X' } })).toBeInstanceOf(Error);
  });
});
