import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';
import { diffSnapshots } from '../../src/versions/store.js';

const kits: TestCms[] = [];
afterEach(async () => {
  await Promise.all(kits.map((kit) => kit.destroy()));
  kits.length = 0;
});

const config = defineConfig({
  db: { id: 'uuid' },
  versions: { drafts: true },
  collections: [
    collection('posts', {
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { from: 'title' }),
        fields.text('body'),
      ],
    }),
  ],
});

async function setup(overrides: { retention?: number } = {}) {
  const resolved = overrides.retention
    ? defineConfig({ ...config, versions: { drafts: true, retention: overrides.retention } })
    : config;

  const kit = await createTestCms({ config: resolved });
  kits.push(kit);
  const cms = createCms({ config: resolved, client: kit.client, user: { id: 'u1' } });
  return { kit, cms };
}

describe('drafts', () => {
  test('a draft is hidden from the default read and visible with draft: true', async () => {
    const { cms } = await setup();
    const posts = cms.collection('posts');

    const draft = await posts.create({ title: 'Draft' }, { draft: true });
    expect(draft._status).toBe('draft');

    expect((await posts.find()).docs).toEqual([]);
    expect(await posts.findByID(draft.id)).toBeNull();

    const withDrafts = await posts.find({ draft: true });
    expect(withDrafts.docs.map((post) => post.title)).toEqual(['Draft']);
    expect(await posts.findByID(draft.id, { draft: true })).toMatchObject({ title: 'Draft' });
  });

  test('drafts cannot be read anonymously', async () => {
    const { kit } = await setup();
    const anonymous = createCms({ config, client: kit.client });

    const draft = await anonymous.collection('posts').create({ title: 'X' }, { draft: true });

    await expect(anonymous.collection('posts').find({ draft: true })).rejects.toMatchObject({
      code: 'CMS_FORBIDDEN',
    });
    await expect(
      anonymous.collection('posts').findByID(draft.id, { draft: true }),
    ).rejects.toMatchObject({ code: 'CMS_FORBIDDEN' });
  });

  test('publish makes the document public, unpublish hides it again', async () => {
    const { cms } = await setup();
    const posts = cms.collection('posts');

    const draft = await posts.create({ title: 'Soon' }, { draft: true });
    const published = await posts.publish(draft.id);

    expect(published._status).toBe('published');
    expect((await posts.find()).docs.map((post) => post.title)).toEqual(['Soon']);

    const unpublished = await posts.unpublish(draft.id);
    expect(unpublished._status).toBe('draft');
    expect((await posts.find()).docs).toEqual([]);

    const versions = await posts.versions(draft.id);
    expect(versions.docs.map((version) => version.status)).toContain('published');
  });
});

describe('versions', () => {
  test('records every save and restores by writing a new version', async () => {
    const { cms } = await setup();
    const posts = cms.collection('posts');

    const created = await posts.create({ title: 'First' });
    await posts.update(created.id, { title: 'Second' });

    const before = await posts.versions(created.id);
    expect(before.docs.map((version) => version.version)).toEqual([2, 1]);

    const restored = await posts.restoreVersion(created.id, 1);
    expect(restored.title).toBe('First');

    const after = await posts.versions(created.id);
    expect(after.docs.map((version) => version.version)).toEqual([3, 2, 1]);
  });

  test('retention keeps the newest versions and the last publish', async () => {
    const { cms } = await setup({ retention: 2 });
    const posts = cms.collection('posts');

    const post = await posts.create({ title: 'v1' });
    await posts.update(post.id, { title: 'v2' });
    await posts.update(post.id, { title: 'v3' });
    await posts.update(post.id, { title: 'v4' });

    const versions = await posts.versions(post.id);
    expect(versions.docs.length).toBeLessThanOrEqual(3);
    expect(versions.docs.some((version) => version.status === 'published')).toBe(true);
    expect(versions.docs[0]?.version).toBe(4);
  });

  test('autosave versions are recorded without firing afterChange', async () => {
    let afterChangeCalls = 0;

    const hookConfig = defineConfig({
      versions: { drafts: true },
      collections: [
        collection('posts', {
          hooks: {
            afterChange: [
              () => {
                afterChangeCalls += 1;
              },
            ],
          },
          fields: [fields.text('title', { required: true })],
        }),
      ],
    });

    const kit = await createTestCms({ config: hookConfig });
    kits.push(kit);
    const cms = createCms({ config: hookConfig, client: kit.client, user: { id: 'u1' } });

    const post = await cms.collection('posts').create({ title: 'a' });
    const callsAfterCreate = afterChangeCalls;

    await cms.collection('posts').update(post.id, { title: 'b' }, { autosave: true, draft: true });

    const versions = await cms.collection('posts').versions(post.id);
    expect(versions.docs.some((version) => version.autosave)).toBe(true);
    expect(afterChangeCalls).toBe(callsAfterCreate);
  });
});

describe('locks', () => {
  test('blocks another user until released', async () => {
    const { cms, kit } = await setup();
    const post = await cms.collection('posts').create({ title: 'Locked' });

    const first = await cms.collection('posts').lock(post.id, 300);
    expect(first.userId).toBe('u1');

    const other = createCms({ config, client: kit.client, user: { id: 'u2' } });
    await expect(other.collection('posts').lock(post.id, 300)).rejects.toMatchObject({
      code: 'CMS_CONFLICT',
    });

    await expect(other.collection('posts').unlock(post.id)).rejects.toMatchObject({
      code: 'CMS_FORBIDDEN',
    });

    await cms.collection('posts').unlock(post.id);
    const reclaimed = await other.collection('posts').lock(post.id, 300);
    expect(reclaimed.userId).toBe('u2');
  });
});

describe('diffSnapshots', () => {
  test('reports changed paths, including inside arrays', () => {
    const before = { title: 'a', tags: [{ label: 'x' }] };
    const after = { title: 'b', tags: [{ label: 'y' }] };

    expect(diffSnapshots(before, after)).toEqual({
      title: { before: 'a', after: 'b' },
      'tags[0].label': { before: 'x', after: 'y' },
    });
  });
});
