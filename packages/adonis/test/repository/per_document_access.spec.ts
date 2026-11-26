import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

type User = { id: string; role: string } | null;
const userOf = (user: unknown) => user as User;
const isAdmin = ({ user }: { user: unknown }) => userOf(user)?.role === 'admin';
/** The owner field is hidden from everyone but admins, and every rule decides on it. */
const ownsIt = ({ user, doc }: { user: unknown; doc?: Record<string, unknown> }) =>
  isAdmin({ user }) || (Boolean(doc) && doc?.owner === userOf(user)?.id);

const config = defineConfig({
  versions: { drafts: true },
  collections: [
    collection('notes', {
      softDelete: true,
      access: { read: ownsIt, update: ownsIt, delete: ownsIt },
      fields: [fields.text('title'), fields.text('owner', { access: { read: isAdmin } })],
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
  const note = await admin.collection('notes').create({ title: 'mine', owner: 'u1' } as never);
  return {
    as,
    admin,
    id: note.id,
    owner: as({ id: 'u1', role: 'editor' }),
    other: as({ id: 'u2', role: 'editor' }),
  };
}

describe('per-document rules decide on the whole document', () => {
  test('read: the owner can read a document whose owner field is hidden from them', async () => {
    const { id, owner, other } = await setup();
    const doc = await owner.collection('notes').findByID(id);
    expect(doc?.title).toBe('mine');
    // Decided on the whole document, then trimmed for the caller.
    expect(doc).not.toHaveProperty('owner');
    expect(await other.collection('notes').findByID(id)).toBeNull();
  });

  test('version history and snapshots follow the same decision', async () => {
    const { id, owner, other } = await setup();
    const version = await owner.collection('notes').version(id, 1);
    const snapshot = (version?.snapshot as { doc?: Record<string, unknown> } | undefined)?.doc;
    expect(snapshot?.title).toBe('mine');
    expect(snapshot).not.toHaveProperty('owner');
    await expect(other.collection('notes').versions(id)).rejects.toThrow(/not found/);
  });

  test('update and delete rules see the hidden field too', async () => {
    const { id, owner, other } = await setup();
    await expect(other.collection('notes').update(id, { title: 'x' } as never)).rejects.toThrow(
      /not allowed/,
    );
    const updated = await owner.collection('notes').update(id, { title: 'edited' } as never);
    expect(updated.title).toBe('edited');
    await expect(other.collection('notes').delete(id)).rejects.toThrow(/not allowed/);
    await owner.collection('notes').delete(id);
  });

  test('restoring a soft-deleted document decides on it', async () => {
    const { id, owner, other, admin } = await setup();
    await admin.collection('notes').delete(id);
    await expect(other.collection('notes').restore(id)).rejects.toThrow(/not allowed/);
    await expect(owner.collection('notes').restore(id)).resolves.toMatchObject({ title: 'mine' });
  });

  test('scheduling decides on the document, and its schedule is not readable by others', async () => {
    const { id, owner, other } = await setup();
    const at = new Date(Date.now() + 3_600_000);
    await expect(
      other.collection('notes').schedule(id, { action: 'unpublish', at }),
    ).rejects.toThrow(/not allowed/);
    await expect(
      owner.collection('notes').schedule(id, { action: 'unpublish', at }),
    ).resolves.toMatchObject({ action: 'unpublish' });
    expect(await owner.collection('notes').scheduled(id)).toMatchObject({ action: 'unpublish' });
    await expect(other.collection('notes').scheduled(id)).rejects.toThrow(/not found/);
    await expect(other.collection('notes').unschedule(id)).rejects.toThrow(/not allowed/);
    await owner.collection('notes').unschedule(id);
  });
});
