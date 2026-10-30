import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import {
  handleCollectionCreate,
  handleCollectionLock,
  handleCollectionPublish,
  handleCollectionRestoreVersion,
  handleCollectionVersion,
  handleCollectionVersions,
} from '../../src/rest/handlers.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  db: { id: 'uuid' },
  versions: { drafts: true },
  collections: [
    collection('posts', {
      fields: [fields.text('title', { required: true }), fields.slug('slug', { from: 'title' })],
    }),
  ],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

async function setup() {
  kit = await createTestCms({ config });
  return createCms({ config, client: kit.client, user: { id: 'u1' } });
}

const base = { params: {}, query: {}, body: undefined } as const;

describe('REST versions', () => {
  test('create draft, publish, list versions and restore', async () => {
    const cms = await setup();

    const created = await handleCollectionCreate(cms, {
      ...base,
      params: { slug: 'posts' },
      body: { title: 'First' },
    });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    const published = await handleCollectionPublish(cms, {
      ...base,
      params: { slug: 'posts', id },
    });
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ _status: 'published' });

    const list = await handleCollectionVersions(cms, {
      ...base,
      params: { slug: 'posts', id },
    });
    expect(list.status).toBe(200);
    const docs = (list.body as { docs: { version: number }[] }).docs;
    expect(docs.length).toBeGreaterThanOrEqual(2);

    const single = await handleCollectionVersion(cms, {
      ...base,
      params: { slug: 'posts', id, version: '1' },
    });
    expect(single.status).toBe(200);
    expect(single.body).toMatchObject({ version: 1 });

    const restored = await handleCollectionRestoreVersion(cms, {
      ...base,
      params: { slug: 'posts', id, version: '1' },
    });
    expect(restored.status).toBe(200);
  });

  test('version lookup returns 404 for an unknown number', async () => {
    const cms = await setup();
    const created = await handleCollectionCreate(cms, {
      ...base,
      params: { slug: 'posts' },
      body: { title: 'X' },
    });
    const id = (created.body as { id: string }).id;

    const response = await handleCollectionVersion(cms, {
      ...base,
      params: { slug: 'posts', id, version: '99' },
    });
    expect(response.status).toBe(404);
  });

  test('lock conflicts map to 409', async () => {
    const cms = await setup();
    const created = await handleCollectionCreate(cms, {
      ...base,
      params: { slug: 'posts' },
      body: { title: 'Y' },
    });
    const id = (created.body as { id: string }).id;

    const first = await handleCollectionLock(cms, { ...base, params: { slug: 'posts', id } });
    expect(first.status).toBe(200);

    const other = createCms({ config, client: kit.client, user: { id: 'u2' } });
    const conflict = await handleCollectionLock(other, {
      ...base,
      params: { slug: 'posts', id },
    });
    expect(conflict.status).toBe(409);
  });
});
