import { describe, expect, test } from 'vitest';
import { toAdminSchema } from '../../src/admin/schema.js';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms } from '../../src/testing/create_test_cms.js';
import { repositoryConfig } from '../fixtures/repo_config.js';

describe('toAdminSchema', () => {
  test('serializes collections, globals and field metadata', async () => {
    const schema = await toAdminSchema(repositoryConfig, { user: { id: 'u1' } });

    expect(schema.version).toBe(1);
    expect(schema.locales).toEqual(['pt-BR', 'en']);
    expect(schema.defaultLocale).toBe('pt-BR');
    expect(schema.tenancy).toEqual({ strategy: 'single', required: false });

    const posts = schema.collections.find((item) => item.slug === 'posts');
    expect(posts?.fields.map((field) => field.name)).toEqual([
      'title',
      'slug',
      'status',
      'body',
      'author',
      'channels',
      'tags',
      'layout',
    ]);

    const status = posts?.fields.find((field) => field.name === 'status');
    expect(status?.options?.map((option) => option.value)).toEqual(['draft', 'published']);

    const layout = posts?.fields.find((field) => field.name === 'layout');
    expect(layout?.blocks?.[0]?.slug).toBe('hero');
    expect(layout?.blocks?.[0]?.fields.map((field) => field.name)).toEqual([
      'heading',
      'subheading',
      'gallery',
    ]);

    expect(schema.globals.map((item) => item.slug)).toEqual(['settings']);
  });

  test('the result is JSON-safe: no functions survive', async () => {
    const schema = await toAdminSchema(repositoryConfig, { user: { id: 'u1' } });
    const roundTripped = JSON.parse(JSON.stringify(schema)) as typeof schema;
    expect(roundTripped).toEqual(schema);
  });

  test('evaluates permissions instead of shipping access functions', async () => {
    const config = defineConfig({
      collections: [
        collection('posts', {
          access: {
            read: ({ user }) => Boolean(user),
            create: ({ user }) => Boolean(user),
            update: () => false,
            delete: ({ user }) => (user as { role?: string } | null)?.role === 'admin',
          },
          fields: [fields.text('title'), fields.text('secret', { access: { read: () => false } })],
        }),
      ],
    });

    const anonymous = await toAdminSchema(config, { user: null });
    expect(anonymous.permissions.posts).toEqual({
      read: false,
      create: false,
      update: false,
      delete: false,
    });
    expect(anonymous.collections[0]?.fields[1]?.restricted).toBe(true);

    const admin = await toAdminSchema(config, { user: { id: 'u1', role: 'admin' } });
    expect(admin.permissions.posts).toEqual({
      read: true,
      create: true,
      update: false,
      delete: true,
    });
    expect(admin.collections[0]?.fields[1]?.restricted).toBe(true);
  });

  test('the schema route serves it for the request principal', async () => {
    const kit = await createTestCms({ config: repositoryConfig });
    try {
      const cms = createCms({ config: repositoryConfig, client: kit.client, user: { id: 'u1' } });
      const { handleAdminSchema } = await import('../../src/rest/handlers.js');
      const response = await handleAdminSchema(cms);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ user: { id: 'u1' }, version: 1 });
    } finally {
      await kit.destroy();
    }
  });
});
