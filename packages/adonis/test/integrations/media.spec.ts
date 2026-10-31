import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createMediaAdapter, mediaLibraryAdapter } from '../../src/integrations/media.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  integrations: { media: true },
  collections: [
    collection('posts', {
      fields: [fields.text('title'), fields.upload('cover', { relationTo: 'media' })],
    }),
  ],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

const adapter = createMediaAdapter(async (ids) =>
  ids.map((id) => ({
    id,
    url: `/media/${id}`,
    mime: 'image/png',
    width: 10,
    height: 20,
  })),
);

describe('media adapter', () => {
  test('resolves upload ids into assets on read', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, media: adapter });

    const post = await cms.collection('posts').create({ title: 'T', cover: 'm1' });
    expect(post.cover).toEqual({
      id: 'm1',
      url: '/media/m1',
      mime: 'image/png',
      width: 10,
      height: 20,
    });
  });

  test('depth 0 keeps the raw id', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, media: adapter });

    const post = await cms.collection('posts').create({ title: 'T', cover: 'm1' });
    const shallow = await cms.collection('posts').findByID(post.id, { depth: 0 });
    expect(shallow?.cover).toBe('m1');
  });

  test('without an adapter the id is returned untouched', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client });

    const post = await cms.collection('posts').create({ title: 'T', cover: 'm1' });
    expect(post.cover).toBe('m1');
  });

  test('mediaLibraryAdapter resolves through find() and drops what is missing', async () => {
    const library = mediaLibraryAdapter(() => ({
      async find(id) {
        return id === 'a' ? { id, url: '/a' } : null;
      },
    }));

    const resolved = await library.resolveMany(['a', 'b']);
    expect(resolved.get('a')).toEqual({ id: 'a', url: '/a' });
    expect(resolved.has('b')).toBe(false);
  });
});
