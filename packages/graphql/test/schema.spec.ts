import {
  collection,
  createCms,
  createTestCms,
  defineConfig,
  fields,
  global,
  type TestCms,
} from '@adonis-agora/cms';
import { graphql } from 'graphql';
import { afterEach, describe, expect, test } from 'vitest';
import { buildCmsGraphQLSchema } from '../src/index.js';

const config = defineConfig({
  localization: { locales: ['pt-BR', 'en'], defaultLocale: 'pt-BR' },
  collections: [
    collection('authors', { fields: [fields.text('name', { required: true })] }),
    collection('posts', {
      softDelete: true,
      fields: [
        fields.text('title', { required: true }),
        fields.text('subtitle', { localized: true }),
        fields.select('status', {
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
        fields.relation('author', { relationTo: 'authors' }),
        fields.array('tags', { fields: [fields.text('label')] }),
      ],
    }),
    collection('secrets', {
      access: { read: () => false },
      fields: [fields.text('title')],
    }),
  ],
  globals: [global('settings', { fields: [fields.text('siteName')] })],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

async function setup() {
  kit = await createTestCms({ config: config as never });
  const cms = createCms({ config: config as never, client: kit.client, user: { id: 'u1' } });

  const author = await cms.collection('authors').create({ name: 'Davi' });
  const post = await cms.collection('posts').create({
    title: 'Hello world',
    subtitle: { 'pt-BR': 'Oi', en: 'Hi' },
    status: 'published',
    author: author.id,
    tags: [{ label: 'adonis' }],
  });
  await cms.collection('secrets').create({ title: 'hidden' });
  await cms.global('settings').update({ siteName: 'Acme' });

  return { cms, post, author, schema: buildCmsGraphQLSchema(cms) };
}

describe('cms graphql schema', () => {
  test('lists documents with filters and pagination metadata', async () => {
    const { schema } = await setup();

    const result = await graphql({
      schema,
      source:
        '{ posts(where: { status: { equals: "published" } }, limit: 5) { docs { id title status } totalDocs totalPages } }',
    });

    expect(result.errors).toBeUndefined();
    const data = result.data as {
      posts: { docs: { title: string; status: string }[]; totalDocs: number };
    };
    expect(data.posts.totalDocs).toBe(1);
    expect(data.posts.docs[0]).toMatchObject({ title: 'Hello world', status: 'published' });
  });

  test('returns relation ids, json structures and localized maps', async () => {
    const { schema, post, author } = await setup();

    const result = await graphql({
      schema,
      source: `{ postsById(id: "${post.id}") { title author tags subtitle } }`,
    });

    expect(result.errors).toBeUndefined();
    const doc = (result.data as { postsById: Record<string, unknown> }).postsById;
    expect(doc.title).toBe('Hello world');
    expect(doc.author).toBe(author.id);
    expect(doc.tags).toEqual([{ id: expect.any(String), label: 'adonis' }]);
    expect(doc.subtitle).toEqual({ 'pt-BR': 'Oi', en: 'Hi' });
  });

  test('serves globals', async () => {
    const { schema } = await setup();

    const result = await graphql({ schema, source: '{ settings { siteName status } }' });

    expect(result.errors).toBeUndefined();
    expect((result.data as { settings: { siteName: string } }).settings.siteName).toBe('Acme');
  });

  test('access control still applies: denied collection returns no documents', async () => {
    const { schema } = await setup();

    const result = await graphql({ schema, source: '{ secrets { docs { title } totalDocs } }' });

    expect(result.errors).toBeUndefined();
    expect((result.data as { secrets: { totalDocs: number } }).secrets.totalDocs).toBe(0);
  });

  test('soft-deleted documents are hidden by default and visible with deleted: true', async () => {
    const { schema, cms, post } = await setup();
    await cms.collection('posts').delete(post.id);

    const hidden = await graphql({ schema, source: '{ posts { totalDocs } }' });
    expect((hidden.data as { posts: { totalDocs: number } }).posts.totalDocs).toBe(0);

    const trashed = await graphql({ schema, source: '{ posts(deleted: true) { totalDocs } }' });
    expect((trashed.data as { posts: { totalDocs: number } }).posts.totalDocs).toBe(1);
  });
});
