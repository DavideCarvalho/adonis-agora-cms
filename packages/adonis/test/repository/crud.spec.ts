import { afterEach, describe, expect, test } from 'vitest';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';
import { doc, repositoryConfig } from '../fixtures/repo_config.js';

let kit: TestCms;

async function setup() {
  kit = await createTestCms({ config: repositoryConfig });
  return { kit, cms: createCms({ config: repositoryConfig, client: kit.client }) };
}

afterEach(async () => {
  await kit?.destroy();
});

describe('local API — create', () => {
  test('persists scalars, slug, children, blocks, localized and relations', async () => {
    const { cms } = await setup();

    const author = await cms.collection('users').create({ name: 'Davi' });

    const post = await cms.collection('posts').create({
      title: 'Hello World',
      body: doc,
      author: author.id,
      channels: ['web', 'rss'],
      tags: [{ label: 'adonis' }, { label: 'cms' }],
      layout: [{ type: 'hero', heading: 'Hi', gallery: [{ caption: 'one' }] }],
    });

    expect(post.slug).toBe('hello-world');
    expect(post.status).toBe('draft');
    expect(post.body).toEqual({ 'pt-BR': doc, en: doc });
    expect(post.channels).toEqual(['web', 'rss']);
    expect(post.tags).toEqual([
      { id: expect.any(String), label: 'adonis' },
      { id: expect.any(String), label: 'cms' },
    ]);
    expect(post.layout).toHaveLength(1);
    expect(post.layout[0]).toMatchObject({ type: 'hero', heading: 'Hi' });
    expect(post.layout[0]?.gallery).toEqual([
      { id: expect.any(String), caption: 'one', link: null },
    ]);
    expect(post.author).toMatchObject({ id: author.id, name: 'Davi' });
    expect(post.createdAt).toBeInstanceOf(Date);
  });

  test('resolves relations declared inside blocks', async () => {
    const { cms } = await setup();

    const page = await cms.collection('pages').create({ title: 'Linked page' });

    const post = await cms.collection('posts').create({
      title: 'Hero with link',
      layout: [
        {
          type: 'hero',
          heading: 'Hi',
          gallery: [{ caption: 'one', link: page.id }],
        },
      ],
    });

    const read = await cms.collection('posts').findByID(post.id);
    const gallery = (read?.layout as { gallery: { link: unknown }[] }[])[0]?.gallery ?? [];

    // The block stores the id; reading it back with depth resolves the document.
    expect(gallery[0]?.link).toMatchObject({ id: page.id, title: 'Linked page' });
  });

  test('rejects invalid documents with field errors', async () => {
    const { cms } = await setup();

    await expect(cms.collection('posts').create({ title: '' })).rejects.toMatchObject({
      code: 'CMS_VALIDATION',
      fields: { title: 'required' },
    });
  });

  test('enforces unique constraints', async () => {
    const { cms } = await setup();
    const posts = cms.collection('posts');

    await posts.create({ title: 'Same Title' });
    await expect(posts.create({ title: 'Same Title' })).rejects.toMatchObject({
      code: 'CMS_CONFLICT',
    });
  });
});

describe('local API — read', () => {
  test('finds, sorts, paginates and counts', async () => {
    const { cms } = await setup();
    const posts = cms.collection('posts');

    for (const title of ['Alpha', 'Bravo', 'Charlie']) {
      await posts.create({ title, status: 'published' });
    }

    const result = await posts.find({
      where: { status: 'published' },
      sort: '-title',
      limit: 2,
      page: 1,
    });

    expect(result.totalDocs).toBe(3);
    expect(result.totalPages).toBe(2);
    expect(result.hasNextPage).toBe(true);
    expect(result.docs.map((post) => post.title)).toEqual(['Charlie', 'Bravo']);
    expect(await posts.count({ where: { status: 'published' } })).toBe(3);
  });

  test('filters inside arrays and blocks with exists subqueries', async () => {
    const { cms } = await setup();
    const posts = cms.collection('posts');

    await posts.create({ title: 'With hero', layout: [{ type: 'hero', heading: 'H' }] });
    await posts.create({ title: 'Plain' });

    const result = await posts.find({ where: { 'layout.type': 'hero' } });
    expect(result.docs.map((post) => post.title)).toEqual(['With hero']);

    const tagResult = await posts.find({ where: { 'tags.label': 'nope' } });
    expect(tagResult.docs).toEqual([]);
  });

  test('depth 0 returns ids instead of populated relations', async () => {
    const { cms } = await setup();
    const author = await cms.collection('users').create({ name: 'Davi' });
    const post = await cms.collection('posts').create({ title: 'Post', author: author.id });

    const shallow = await cms.collection('posts').findByID(post.id, { depth: 0 });
    expect(shallow?.author).toBe(author.id);

    const deep = await cms.collection('posts').findByID(post.id, { depth: 1 });
    expect(deep?.author).toMatchObject({ id: author.id, name: 'Davi' });
  });

  test('findByID returns null for unknown ids', async () => {
    const { cms } = await setup();
    expect(
      await cms.collection('posts').findByID('00000000-0000-0000-0000-000000000000'),
    ).toBeNull();
  });
});

describe('local API — update and delete', () => {
  test('updates scalars and replaces children', async () => {
    const { cms } = await setup();
    const posts = cms.collection('posts');

    const created = await posts.create({
      title: 'First',
      tags: [{ label: 'a' }, { label: 'b' }],
    });

    const updated = await posts.update(created.id, {
      title: 'Second',
      tags: [{ label: 'c' }],
    });

    expect(updated.title).toBe('Second');
    expect(updated.slug).toBe('first');
    expect(updated.tags).toEqual([{ id: expect.any(String), label: 'c' }]);

    const stored = await posts.findByID(created.id);
    expect(stored?.tags).toHaveLength(1);
  });

  test('deletes documents and their descendants', async () => {
    const { cms, kit } = await setup();
    const posts = cms.collection('posts');

    const post = await posts.create({
      title: 'Bye',
      layout: [{ type: 'hero', heading: 'H', gallery: [{ caption: 'c' }] }],
    });

    await posts.delete(post.id);

    expect(await posts.findByID(post.id)).toBeNull();
    const layout = await kit.db('cms_posts__layout').where({ _parent_id: post.id });
    const gallery = await kit.db('cms_posts__layout__gallery');
    expect(layout).toEqual([]);
    expect(gallery).toEqual([]);
  });
});

describe('local API — globals', () => {
  test('updates create the singleton on first write', async () => {
    const { cms } = await setup();

    const created = await cms.global('settings').update({ siteName: 'Acme' });
    expect(created.siteName).toBe('Acme');

    const updated = await cms.global('settings').update({ description: 'hello' });
    expect(updated.id).toBe(created.id);
    expect(updated.siteName).toBe('Acme');
    expect(updated.description).toBe('hello');
  });
});
