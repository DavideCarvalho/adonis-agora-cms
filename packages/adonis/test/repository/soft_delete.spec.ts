import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  collections: [
    collection('posts', {
      softDelete: true,
      fields: [
        fields.text('title', { required: true }),
        fields.array('tags', { fields: [fields.text('label')] }),
      ],
    }),
  ],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

describe('soft delete', () => {
  test('delete hides the document, restore brings it back', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'u1' } });
    const posts = cms.collection('posts');

    const post = await posts.create({ title: 'Bye', tags: [{ label: 'a' }] });
    await posts.delete(post.id);

    expect(await posts.findByID(post.id)).toBeNull();
    expect((await posts.find()).docs).toEqual([]);

    const row = await kit.db('cms_posts').where({ id: post.id }).first();
    expect(row?._deleted_at).toBeTruthy();
    // Children survive a soft delete.
    expect(await kit.db('cms_posts__tags').where({ _parent_id: post.id })).toHaveLength(1);

    const restored = await posts.restore(post.id);
    expect(restored.title).toBe('Bye');
    expect((await posts.find()).docs.map((doc) => doc.title)).toEqual(['Bye']);
  });

  test('force delete removes the row and its children', async () => {
    kit = await createTestCms({ config });
    const cms = createCms({ config, client: kit.client, user: { id: 'u1' } });
    const posts = cms.collection('posts');

    const post = await posts.create({ title: 'Gone', tags: [{ label: 'a' }] });
    await posts.delete(post.id, { force: true });

    expect(await kit.db('cms_posts').where({ id: post.id })).toEqual([]);
    expect(await kit.db('cms_posts__tags').where({ _parent_id: post.id })).toEqual([]);
  });
});
