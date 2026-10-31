import 'reflect-metadata';
import { AuthzService, MemoryPermissionStore } from '@adonis-agora/authz';
import { MediaLibrary, StorageManager } from '@adonis-agora/media';
import { InMemoryMediaStore, inMemoryDiskResolver } from '@adonis-agora/media/testing';
import { InMemoryTelescopeStore } from '@adonis-agora/telescope';
import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { authkitAuth } from '../../src/integrations/authkit.js';
import { authzCollectionAccess } from '../../src/integrations/authz.js';
import { mediaLibraryAdapter, mediaLibraryUploads } from '../../src/integrations/media.js';
import { telescopeWatcher } from '../../src/integrations/telescope.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

/* These run against the real Agora libraries, so a change in their API fails here, not in an app. */

const kits: TestCms[] = [];

afterEach(async () => {
  await Promise.all(kits.map((kit) => kit.destroy()));
  kits.length = 0;
});

describe('@adonis-agora/authz', () => {
  async function setup() {
    const store = new MemoryPermissionStore();
    await store.createPermission('posts.read');
    await store.createPermission('posts.create');
    const authz = new AuthzService({ store });
    const editor = { id: 'editor' };
    const reader = { id: 'reader' };
    const subject = (id: string) => authz.refOf({ id }) as { type: string; id: string };
    await store.giveSubjectPermission(subject(editor.id), 'posts.read');
    await store.giveSubjectPermission(subject(editor.id), 'posts.create');
    await store.giveSubjectPermission(subject(reader.id), 'posts.read');

    const config = defineConfig({
      db: { id: 'uuid' },
      collections: [
        collection('posts', {
          access: authzCollectionAccess('posts', (user, ability) => authz.can(user, ability)),
          fields: [fields.text('title')],
        }),
      ],
    });
    const kit = await createTestCms({ config });
    kits.push(kit);
    return {
      as: (user: unknown) => createCms({ config, client: kit.client, user }).collection('posts'),
      editor,
      reader,
    };
  }

  test('a denied permission really denies, even though `can` is async', async () => {
    const { as, editor, reader } = await setup();

    await expect(as(editor).create({ title: 'Allowed' })).resolves.toMatchObject({
      title: 'Allowed',
    });
    await expect(as(reader).create({ title: 'Denied' })).rejects.toThrow();
    await expect(as(null).create({ title: 'Anonymous' })).rejects.toThrow();
  });
});

describe('@adonis-agora/media', () => {
  function library() {
    const { resolve } = inMemoryDiskResolver(['fs']);
    return new MediaLibrary({
      storage: new StorageManager({ default: 'fs', resolve }),
      store: new InMemoryMediaStore(),
    });
  }

  test('an upload goes into the library and resolves back with its URL', async () => {
    const media = library();
    const asset = await mediaLibraryUploads(() => media as never)(
      {
        filename: 'banner.txt',
        mimeType: 'text/plain',
        size: 3,
        contents: Buffer.from('abc'),
      },
      { field: 'banner', collection: 'posts' },
    );

    expect(asset.id).toBeTruthy();
    expect(asset.id.length).toBeLessThanOrEqual(64);
    expect(asset.url).toBeTruthy();

    const resolved = await mediaLibraryAdapter(() => media as never).resolveMany([
      asset.id,
      'missing',
    ]);
    expect(resolved.get(asset.id)).toMatchObject({ id: asset.id, mime: 'text/plain' });
    expect(resolved.get(asset.id)?.url).toBe(asset.url);
    expect(resolved.has('missing')).toBe(false);
  });
});

describe('@adonis-agora/telescope', () => {
  test('a write is recorded in the store', async () => {
    const store = new InMemoryTelescopeStore();
    const observer = telescopeWatcher((entry) => void store.record(entry));

    observer({ collection: 'posts', operation: 'create', durationMs: 3, ok: true });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const entries = (await store.list({ type: 'cms' })) as unknown as { tags: string[] }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.tags).toEqual(expect.arrayContaining(['cms', 'posts', 'create']));
  });
});

describe('@adonis-agora/authkit', () => {
  test('checks the session; a failing check is anonymous', async () => {
    const user = { id: 'u1' };
    const auth = {
      user: undefined as unknown,
      async check() {
        this.user = user;
      },
    };
    await expect(authkitAuth().resolveUser({ auth })).resolves.toBe(user);

    const broken = {
      async check() {
        throw new Error('session store down');
      },
    };
    await expect(authkitAuth().resolveUser({ auth: broken })).resolves.toBeNull();
    await expect(authkitAuth().resolveUser({})).resolves.toBeNull();
  });
});
