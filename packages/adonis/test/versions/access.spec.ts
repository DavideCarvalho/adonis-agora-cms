import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import {
  handleCollectionDiscardDraft,
  handleCollectionLock,
  handleCollectionUnlock,
  handleCollectionVersion,
  handleCollectionVersions,
} from '../../src/rest/handlers.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

type User = { id: string; role: string } | null;
const role = (user: unknown) => (user as { role?: string } | null)?.role;

const config = defineConfig({
  versions: { drafts: true, maxLockTtl: 600 },
  collections: [
    collection('posts', {
      access: {
        read: () => true,
        update: ({ user }) => role(user) === 'editor' || role(user) === 'admin',
      },
      fields: [
        fields.text('title'),
        fields.text('secret', { access: { read: ({ user }) => role(user) === 'admin' } }),
        fields.row('meta', {
          access: { read: ({ user }) => role(user) === 'admin' },
          fields: [fields.text('internal')],
        }),
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
  const as = (user: User) => createCms({ config, client: kit.client, user });
  const admin = as({ id: 'a', role: 'admin' });
  const post = await admin
    .collection('posts')
    .create({ title: 'Live', secret: 's1', internal: 'i1' } as never);
  await admin.collection('posts').update(post.id, { title: 'Pending', secret: 's2' } as never, {
    asDraft: true,
  });
  return {
    id: post.id,
    admin,
    editor: as({ id: 'e', role: 'editor' }),
    reader: as({ id: 'r', role: 'reader' }),
    anonymous: as(null),
  };
}

const request = (params: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  params,
  query: {},
  body: undefined,
  ...extra,
});

describe('discard draft', () => {
  test('a reader without update access cannot discard the pending edit', async () => {
    const { id, reader, admin } = await setup();
    const response = await handleCollectionDiscardDraft(reader, request({ slug: 'posts', id }));
    expect(response.status).toBe(403);
    const pending = await admin.collection('posts').findByID(id, { draft: true });
    expect(pending?.title).toBe('Pending');
  });

  test('an anonymous caller gets 401', async () => {
    const { id, anonymous } = await setup();
    const response = await handleCollectionDiscardDraft(anonymous, request({ slug: 'posts', id }));
    expect(response.status).toBe(401);
  });

  test('an editor can discard it', async () => {
    const { id, editor, admin } = await setup();
    const response = await handleCollectionDiscardDraft(editor, request({ slug: 'posts', id }));
    expect(response.status).toBe(200);
    const doc = await admin.collection('posts').findByID(id, { draft: true });
    expect(doc?.title).toBe('Live');
  });
});

describe('document locks', () => {
  test('locking and unlocking need update access', async () => {
    const { id, reader, editor } = await setup();
    expect((await handleCollectionLock(reader, request({ slug: 'posts', id }))).status).toBe(403);

    expect((await handleCollectionLock(editor, request({ slug: 'posts', id }))).status).toBe(200);
    // Even an anonymous lock (no owner) cannot be released by someone who may not edit.
    expect((await handleCollectionUnlock(reader, request({ slug: 'posts', id }))).status).toBe(403);
    expect((await handleCollectionUnlock(editor, request({ slug: 'posts', id }))).status).toBe(204);
  });

  test('a missing document cannot be locked', async () => {
    const { editor } = await setup();
    const response = await handleCollectionLock(
      editor,
      request({ slug: 'posts', id: '00000000-0000-0000-0000-000000000000' }),
    );
    expect(response.status).toBe(404);
  });

  test('ttlSeconds is capped by versions.maxLockTtl and validated', async () => {
    const { id, editor } = await setup();
    const tooLong = await handleCollectionLock(
      editor,
      request({ slug: 'posts', id }, { body: { ttlSeconds: 10 * 365 * 24 * 3600 } }),
    );
    expect(tooLong.status).toBe(422);
    expect(JSON.stringify(tooLong.body)).toContain('versions.maxLockTtl');

    for (const ttlSeconds of [-5, 0, 'forever', Number.POSITIVE_INFINITY]) {
      const bad = await handleCollectionLock(
        editor,
        request({ slug: 'posts', id }, { body: { ttlSeconds } }),
      );
      expect(bad.status).toBe(422);
    }

    const ok = await handleCollectionLock(
      editor,
      request({ slug: 'posts', id }, { body: { ttlSeconds: 600 } }),
    );
    expect(ok.status).toBe(200);
    const expiresAt = new Date((ok.body as { expiresAt: Date }).expiresAt).getTime();
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(600_000);
  });

  test('the default lockTtl always fits, even above the default cap', async () => {
    const long = defineConfig({ ...config, versions: { drafts: true, lockTtl: 7200 } });
    kit = await createTestCms({ config: long });
    const cms = createCms({ config: long, client: kit.client, user: { id: 'a', role: 'admin' } });
    const post = await cms.collection('posts').create({ title: 'x' } as never);
    await expect(cms.collection('posts').lock(post.id)).resolves.toMatchObject({ userId: 'a' });
  });
});

describe('version history', () => {
  test('snapshots leave out fields hidden from the reader', async () => {
    const { id, editor, admin } = await setup();
    const list = await editor.collection('posts').versions(id);
    const latest = list.docs[0]?.version as number;

    const response = await handleCollectionVersion(
      editor,
      request({ slug: 'posts', id, version: String(latest) }, { query: { snapshot: 'true' } }),
    );
    expect(response.status).toBe(200);
    const doc = (response.body as { snapshot: { doc: Record<string, unknown> } }).snapshot.doc;
    expect(doc.title).toBe('Pending');
    expect(doc).not.toHaveProperty('secret');

    const first = await editor.collection('posts').version(id, 1);
    const firstDoc = (first?.snapshot as { doc: Record<string, unknown> } | undefined)?.doc;
    expect(firstDoc).not.toHaveProperty('secret');
    expect(firstDoc).not.toHaveProperty('internal');

    const full = await admin.collection('posts').version(id, latest);
    expect((full?.snapshot as { doc: Record<string, unknown> } | undefined)?.doc.secret).toBe('s2');
  });

  test('without ?snapshot=true the summary carries no snapshot', async () => {
    const { id, editor } = await setup();
    const response = await handleCollectionVersion(
      editor,
      request({ slug: 'posts', id, version: '1' }),
    );
    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('snapshot');
  });

  test('reading history needs read access to the document', async () => {
    const hidden = defineConfig({
      ...config,
      collections: [
        collection('posts', {
          access: { read: ({ user }) => role(user) === 'admin' },
          fields: [fields.text('title')],
        }),
      ],
    });
    kit = await createTestCms({ config: hidden });
    const admin = createCms({
      config: hidden,
      client: kit.client,
      user: { id: 'a', role: 'admin' },
    });
    const other = createCms({ config: hidden, client: kit.client, user: { id: 'o', role: 'x' } });
    const anonymous = createCms({ config: hidden, client: kit.client, user: null });
    const post = await admin.collection('posts').create({ title: 'x' } as never);

    expect(
      (await handleCollectionVersions(other, request({ slug: 'posts', id: post.id }))).status,
    ).toBe(404);
    expect(
      (await handleCollectionVersion(other, request({ slug: 'posts', id: post.id, version: '1' })))
        .status,
    ).toBe(404);
    expect(
      (await handleCollectionVersions(anonymous, request({ slug: 'posts', id: post.id }))).status,
    ).toBe(404);
    await expect(
      other.collection('posts').versions(post.id, { overrideAccess: true }),
    ).resolves.toMatchObject({ totalDocs: 1 });
  });

  test('anyone who can read a published document sees its history, but snapshots stay private', async () => {
    const { id, anonymous } = await setup();
    const list = await handleCollectionVersions(anonymous, request({ slug: 'posts', id }));
    expect(list.status).toBe(200);
    const summary = await handleCollectionVersion(
      anonymous,
      request({ slug: 'posts', id, version: '1' }),
    );
    expect(summary.status).toBe(200);
    expect(summary.body).not.toHaveProperty('snapshot');
    // A snapshot can hold draft content: drafts are never public.
    const snapshot = await handleCollectionVersion(
      anonymous,
      request({ slug: 'posts', id, version: '1' }, { query: { snapshot: 'true' } }),
    );
    expect(snapshot.status).toBe(403);
  });

  test('a pending draft overlay does not bring hidden fields back', async () => {
    const { id, editor } = await setup();
    const byId = await editor.collection('posts').findByID(id, { draft: true });
    expect(byId?.title).toBe('Pending');
    expect(byId).not.toHaveProperty('secret');

    const listed = await editor.collection('posts').find({ draft: true });
    expect(listed.docs[0]).not.toHaveProperty('secret');
  });
});
