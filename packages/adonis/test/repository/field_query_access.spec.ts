import { InvalidColumnFilterError } from '@adonis-agora/filter';
import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { handleCollectionFind } from '../../src/rest/handlers.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const isAdmin = ({ user }: { user: unknown }) =>
  (user as { role?: string } | null)?.role === 'admin';

const config = defineConfig({
  collections: [
    collection('authors', { fields: [fields.text('name')] }),
    collection('posts', {
      fields: [
        fields.text('title'),
        fields.number('rank'),
        fields.text('salary', { access: { read: isAdmin } }),
        fields.group('audit', { access: { read: isAdmin }, fields: [fields.text('note')] }),
        fields.array('tags', { fields: [fields.text('label')] }),
      ],
    }),
  ],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

async function setup() {
  kit = await createTestCms({ config });
  const admin = createCms({ config, client: kit.client, user: { id: 'a', role: 'admin' } });
  const editor = createCms({ config, client: kit.client, user: { id: 'e', role: 'editor' } });
  await admin
    .collection('posts')
    .create({ title: 'a', rank: 2, salary: '100', audit: { note: 'x' } } as never);
  await admin
    .collection('posts')
    .create({ title: 'b', rank: 1, salary: '900', audit: { note: 'y' } } as never);
  return { admin, editor };
}

describe('field.access.read on queries', () => {
  test('a hidden field cannot be filtered on', async () => {
    const { editor } = await setup();
    const posts = editor.collection('posts');
    await expect(posts.find({ where: { salary: { equals: '900' } } })).rejects.toBeInstanceOf(
      InvalidColumnFilterError,
    );
    await expect(posts.find({ where: { salary: { like: '9%' } } })).rejects.toThrow(/access\.read/);
    // Nested paths and and/or groups are covered too.
    await expect(posts.find({ where: { 'audit.note': { equals: 'x' } } })).rejects.toThrow(
      /audit\.note/,
    );
    await expect(
      posts.find({ where: { or: [{ title: { equals: 'a' } }, { salary: { equals: '1' } }] } }),
    ).rejects.toBeInstanceOf(InvalidColumnFilterError);
  });

  test('a hidden field cannot be sorted by', async () => {
    const { editor } = await setup();
    await expect(editor.collection('posts').find({ sort: '-salary' })).rejects.toThrow(
      /Cannot sort by "salary"/,
    );
  });

  test('the REST list answers 400 for a hidden filter field', async () => {
    const { editor } = await setup();
    const response = await handleCollectionFind(editor, {
      params: { slug: 'posts' },
      query: { filter: { salary: '900' } },
      body: undefined,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'CMS_INVALID_QUERY' } });
  });

  test('callers who may read the field, and overrideAccess, still query it', async () => {
    const { admin, editor } = await setup();
    const found = await admin.collection('posts').find({ where: { salary: { equals: '900' } } });
    expect(found.docs.map((doc) => doc.title)).toEqual(['b']);
    const sorted = await admin.collection('posts').find({ sort: 'salary' });
    expect(sorted.docs.map((doc) => doc.title)).toEqual(['a', 'b']);
    const server = await editor
      .collection('posts')
      .find({ where: { salary: { equals: '900' } } }, { overrideAccess: true });
    expect(server.totalDocs).toBe(1);
  });

  test('unknown sort fields are refused instead of reaching SQL as a raw column', async () => {
    const { admin } = await setup();
    const posts = admin.collection('posts');
    await expect(posts.find({ sort: 'nope' })).rejects.toBeInstanceOf(InvalidColumnFilterError);
    await expect(posts.find({ sort: 'nope' })).rejects.toThrow(/no such field/);
    await expect(posts.find({ sort: 'tags.label' })).rejects.toThrow(/array or blocks/);
    // Fields, aliases and the system columns still sort.
    expect((await posts.find({ sort: 'rank' })).docs.map((doc) => doc.title)).toEqual(['b', 'a']);
    await expect(posts.find({ sort: '-updatedAt,id' })).resolves.toMatchObject({ totalDocs: 2 });
    await expect(posts.find({ sort: 'created_at' })).resolves.toMatchObject({ totalDocs: 2 });
  });
});
