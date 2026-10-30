import { describe, expect, test } from 'vitest';
import { AdminClient, CmsApiError } from '../src/client.js';

function recorder(body: unknown = { docs: [], totalDocs: 0 }, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('AdminClient', () => {
  test('serializes where conditions into the filter wire format', async () => {
    const { calls, fetchImpl } = recorder();
    const client = new AdminClient({ fetch: fetchImpl });

    await client.list('posts', {
      where: { status: { equals: 'published' }, title: 'x' },
      sort: '-createdAt',
      limit: 10,
    });

    const url = calls[0]?.url ?? '';
    expect(url).toContain('/collections/posts?');
    expect(decodeURIComponent(url)).toContain('where[status][equals]=published');
    expect(decodeURIComponent(url)).toContain('where[title][equals]=x');
    expect(decodeURIComponent(url)).toContain('sort=-createdAt');
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
