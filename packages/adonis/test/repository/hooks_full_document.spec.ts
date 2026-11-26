import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const isAdmin = ({ user }: { user: unknown }) =>
  (user as { role?: string } | null)?.role === 'admin';

const seen: { hook: string; value: unknown }[] = [];

const config = defineConfig({
  versions: { drafts: true },
  collections: [
    collection('posts', {
      hooks: {
        beforeChange: [
          ({ data, previousData }) => {
            if (previousData) seen.push({ hook: 'beforeChange', value: previousData.secret });
            return data;
          },
        ],
        afterChange: [({ doc }) => void seen.push({ hook: 'afterChange', value: doc.secret })],
        beforeDelete: [
          ({ id, doc }) => void seen.push({ hook: 'beforeDelete', value: [id, doc.secret] }),
        ],
      },
      fields: [
        fields.text('title'),
        fields.text('secret', { required: true, access: { read: isAdmin } }),
      ],
    }),
  ],
});

let kit: TestCms;
afterEach(async () => {
  seen.length = 0;
  await kit?.destroy();
});

async function setup() {
  kit = await createTestCms({ config });
  const admin = createCms({ config, client: kit.client, user: { id: 'a', role: 'admin' } });
  const editor = createCms({ config, client: kit.client, user: { id: 'e', role: 'editor' } });
  const post = await admin.collection('posts').create({ title: 't', secret: 's' } as never);
  seen.length = 0;
  return { admin, editor, id: post.id };
}

describe('hooks and versions see the whole document', () => {
  test('hooks get the fields the writing user cannot read', async () => {
    const { editor, id } = await setup();
    const updated = await editor.collection('posts').update(id, { title: 't2' } as never);
    // Trimmed on the way out only.
    expect(updated).not.toHaveProperty('secret');
    await editor.collection('posts').delete(id);
    expect(seen).toEqual([
      { hook: 'beforeChange', value: 's' },
      { hook: 'afterChange', value: 's' },
      { hook: 'beforeDelete', value: [id, 's'] },
    ]);
  });

  test('an editor can update a document with a required field hidden from them', async () => {
    const { editor, admin, id } = await setup();
    await expect(
      editor.collection('posts').update(id, { title: 'ok' } as never),
    ).resolves.toMatchObject({ title: 'ok' });
    expect((await admin.collection('posts').findByID(id))?.secret).toBe('s');
  });

  test('the version an editor writes keeps the fields they cannot read, for whoever may', async () => {
    const { editor, admin, id } = await setup();
    await editor.collection('posts').update(id, { title: 'edited' } as never);
    await editor.collection('posts').update(id, { title: 'pending' } as never, { asDraft: true });
    const history = await admin.collection('posts').versions(id);
    for (const { version } of history.docs) {
      const record = await admin.collection('posts').version(id, version);
      expect((record?.snapshot as { doc: Record<string, unknown> } | undefined)?.doc.secret).toBe(
        's',
      );
    }
    const forEditor = await editor.collection('posts').version(id, history.docs[0]?.version ?? 0);
    expect(
      (forEditor?.snapshot as { doc: Record<string, unknown> } | undefined)?.doc,
    ).not.toHaveProperty('secret');
  });

  test('an asDraft update answers the trimmed document', async () => {
    const { editor, id } = await setup();
    const pending = await editor
      .collection('posts')
      .update(id, { title: 'p' } as never, { asDraft: true });
    expect(pending).not.toHaveProperty('secret');
  });
});
