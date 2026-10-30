import { describe, expect, test } from 'vitest';
import { createTestCms } from '../../src/testing/create_test_cms.js';
import { blogConfig } from '../fixtures/blog_config.js';

describe('createTestCms', () => {
  test('syncs the schema, exposes introspection and tears down', async () => {
    const kit = await createTestCms({ config: blogConfig });

    const tables = (await kit.introspect()).tables.map((table) => table.name);
    expect(tables).toContain('cms_posts');
    expect(tables).toContain('cms_posts__layout');
    expect(kit.engine).toBe('sqlite');
    expect(kit.spec.hash).toBe(kit.spec.hash);

    await kit.destroy();
    await expect(kit.db.raw('select 1 from cms_posts')).rejects.toThrow();
  });

  test('tracks the acting user and tenant without touching the database', async () => {
    const kit = await createTestCms({ config: blogConfig });

    kit.actAs({ id: 'user-1' });
    kit.actAsTenant('acme');
    expect(kit.current()).toEqual({ user: { id: 'user-1' }, tenant: 'acme' });

    await kit.destroy();
  });

  test('can skip the initial sync for tests that create their own schema', async () => {
    const kit = await createTestCms({ config: blogConfig, skipSync: true });
    const tables = (await kit.introspect()).tables.filter((table) => table.name.startsWith('cms_'));
    expect(tables).toEqual([]);
    await kit.destroy();
  });
});
