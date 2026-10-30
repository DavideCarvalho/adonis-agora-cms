import { describe, expect, test } from 'vitest';
import { createContentClient } from '../src/index.js';

const url = process.env.CMS_E2E_URL;

/**
 * Gated integration: point `CMS_E2E_URL` at a running `examples/blog` instance.
 * Example: `CMS_E2E_URL=http://127.0.0.1:5611/api/cms pnpm test`.
 */
describe.skipIf(!url)('cms-client against a running server', () => {
  test('lists published documents over HTTP', async () => {
    const cms = createContentClient({ baseUrl: url as string });

    const list = await cms.collection('posts').find({ where: { status: { equals: 'published' } } });

    expect(list.totalDocs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(list.docs)).toBe(true);
    expect(list.docs.every((doc) => typeof doc.id === 'string')).toBe(true);
  });

  test('findByID returns the same document as the list', async () => {
    const cms = createContentClient({ baseUrl: url as string });
    const list = await cms.collection('posts').find({ limit: 1 });
    const first = list.docs[0];
    if (!first) return;

    const one = await cms.collection('posts').findByID(first.id);
    expect(one.id).toBe(first.id);
  });
});
