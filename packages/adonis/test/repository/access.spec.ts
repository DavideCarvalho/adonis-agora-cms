import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const kits: TestCms[] = [];

afterEach(async () => {
  await Promise.all(kits.map((kit) => kit.destroy()));
  kits.length = 0;
});

async function setup(
  config: ReturnType<typeof defineConfig>,
  options: { user?: unknown; tenant?: string | null } = {},
) {
  const kit = await createTestCms({ config });
  kits.push(kit);
  const cms = createCms({
    config,
    client: kit.client,
    user: options.user ?? null,
    tenant: options.tenant ?? null,
  });
  return { kit, cms };
}

describe('access control', () => {
  const config = defineConfig({
    collections: [
      collection('posts', {
        access: {
          read: ({ user }) =>
            user
              ? { field: 'owner', operator: 'equals', value: (user as { id: string }).id }
              : false,
          create: ({ user }) => Boolean(user),
          update: ({ user }) => Boolean(user),
          delete: ({ user }) => (user as { role?: string } | null)?.role === 'admin',
        },
        fields: [
          fields.text('title', { required: true }),
          fields.text('owner'),
          fields.text('secret', { access: { read: () => false } }),
        ],
      }),
    ],
  });

  test('create and update require a user; delete requires an admin', async () => {
    const anonymous = await setup(config);

    await expect(anonymous.cms.collection('posts').create({ title: 'x' })).rejects.toMatchObject({
      code: 'CMS_FORBIDDEN',
    });
  });

  test('a read constraint scopes the list and hides documents from findByID', async () => {
    const { cms } = await setup(config, { user: { id: 'u1', role: 'editor' } });
    const posts = cms.collection('posts');

    await posts.create({ title: 'mine', owner: 'u1' });
    await posts.create({ title: 'theirs', owner: 'u2' });

    const list = await posts.find();
    expect(list.docs.map((post) => post.title)).toEqual(['mine']);

    const theirs = await posts.find({ where: { owner: 'u2' } });
    expect(theirs.docs).toEqual([]);
  });

  test('read false returns no documents at all', async () => {
    const { cms } = await setup(config, { user: null });
    const result = await cms.collection('posts').find();
    expect(result.docs).toEqual([]);
    expect(result.totalDocs).toBe(0);
  });

  test('field-level read access removes the property', async () => {
    const { cms } = await setup(config, { user: { id: 'u1', role: 'editor' } });

    const post = await cms.collection('posts').create({
      title: 'doc',
      owner: 'u1',
      secret: 'hidden',
    });

    expect(post).not.toHaveProperty('secret');
  });

  test('delete is denied for non-admins and allowed for admins', async () => {
    const editor = await setup(config, { user: { id: 'u1', role: 'editor' } });
    const post = await editor.cms.collection('posts').create({ title: 'x', owner: 'u1' });
    await expect(editor.cms.collection('posts').delete(post.id)).rejects.toMatchObject({
      code: 'CMS_FORBIDDEN',
    });

    const admin = await setup(config, { user: { id: 'a1', role: 'admin' } });
    const other = await admin.cms.collection('posts').create({ title: 'y', owner: 'a1' });
    await admin.cms.collection('posts').delete(other.id);
    expect(await admin.cms.collection('posts').findByID(other.id)).toBeNull();
  });
});

describe('hooks', () => {
  const config = defineConfig({
    collections: [
      collection('posts', {
        hooks: {
          beforeChange: [
            ({ data }) => ({ ...data, title: String(data.title ?? '').toUpperCase() }),
          ],
          afterChange: [
            ({ data }) => {
              if (data.title === 'FORBIDDEN') throw new Error('nope');
            },
          ],
        },
        fields: [fields.text('title', { required: true }), fields.text('note')],
      }),
    ],
  });

  test('beforeChange transforms the payload', async () => {
    const { cms } = await setup(config);
    const post = await cms.collection('posts').create({ title: 'hello' });
    expect(post.title).toBe('HELLO');
  });

  test('a throwing afterChange rolls the transaction back', async () => {
    const { cms } = await setup(config);
    const posts = cms.collection('posts');

    await expect(posts.create({ title: 'forbidden' })).rejects.toThrow(/nope/);
    const result = await posts.find();
    expect(result.totalDocs).toBe(0);
  });
});

describe('row tenancy', () => {
  const config = defineConfig({
    db: { id: 'uuid' },
    tenancy: { strategy: 'row', required: true },
    collections: [
      collection('posts', {
        fields: [
          fields.text('title', { required: true }),
          fields.slug('slug', { from: 'title', unique: true }),
        ],
      }),
    ],
  });

  test('scopes every query by tenant', async () => {
    const { cms } = await setup(config);

    const acme = cms.forTenant('acme');
    const globex = cms.forTenant('globex');

    await acme.collection('posts').create({ title: 'Acme Post' });
    await globex.collection('posts').create({ title: 'Globex Post' });

    const acmeDocs = await acme.collection('posts').find();
    expect(acmeDocs.docs.map((post) => post.title)).toEqual(['Acme Post']);

    const globexDocs = await globex.collection('posts').find();
    expect(globexDocs.docs.map((post) => post.title)).toEqual(['Globex Post']);
  });

  test('unique constraints are per tenant', async () => {
    const { cms } = await setup(config);

    await cms.forTenant('acme').collection('posts').create({ title: 'Same' });
    await expect(
      cms.forTenant('acme').collection('posts').create({ title: 'Same' }),
    ).rejects.toMatchObject({ code: 'CMS_CONFLICT' });

    const globex = await cms.forTenant('globex').collection('posts').create({ title: 'Same' });
    expect(globex.slug).toBe('same');
  });

  test('creating without a tenant is refused when required', async () => {
    const { cms } = await setup(config);
    await expect(cms.collection('posts').create({ title: 'x' })).rejects.toMatchObject({
      code: 'CMS_FORBIDDEN',
    });
  });

  test('findByID of another tenant returns null, not forbidden', async () => {
    const { cms } = await setup(config);
    const post = await cms.forTenant('acme').collection('posts').create({ title: 'Secret' });

    expect(await cms.forTenant('globex').collection('posts').findByID(post.id)).toBeNull();
  });
});
