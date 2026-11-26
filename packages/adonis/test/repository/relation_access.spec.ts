import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const role = (user: unknown) => (user as { role?: string } | null)?.role;
const isAdmin = ({ user }: { user: unknown }) => role(user) === 'admin';

const config = defineConfig({
  collections: [
    collection('authors', {
      access: { read: ({ user }) => Boolean(user) },
      fields: [fields.text('name'), fields.text('phone', { access: { read: isAdmin } })],
    }),
    collection('teams', {
      // A `where` rule: only the caller's own team.
      access: {
        read: ({ user }) =>
          user ? { field: 'name', operator: 'equals', value: role(user) ?? '' } : false,
      },
      fields: [fields.text('name')],
    }),
    collection('pages', {
      versions: { drafts: true },
      fields: [fields.text('title')],
    }),
    collection('posts', {
      versions: { drafts: true },
      access: { read: () => true },
      fields: [
        fields.text('title'),
        fields.relation('author', { relationTo: 'authors' }),
        fields.relation('team', { relationTo: 'teams' }),
        fields.relation('page', { relationTo: 'pages' }),
        fields.array('credits', {
          fields: [fields.text('label'), fields.relation('who', { relationTo: 'authors' })],
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
  const as = (user: unknown) => createCms({ config, client: kit.client, user: user as never });
  const admin = as({ id: 'a', role: 'admin' });
  const author = await admin.collection('authors').create({ name: 'Ana', phone: '555' } as never);
  const team = await admin.collection('teams').create({ name: 'editor' } as never);
  const page = await admin.collection('pages').create({ title: 'Draft page' } as never, {
    draft: true,
  });
  const post = await admin.collection('posts').create({
    title: 'Hello',
    author: author.id,
    team: team.id,
    page: page.id,
    credits: [{ label: 'photo', who: author.id }],
  } as never);
  return {
    ids: { author: author.id, team: team.id, page: page.id, post: post.id },
    admin,
    editor: as({ id: 'e', role: 'editor' }),
    writer: as({ id: 'w', role: 'writer' }),
    anonymous: as(null),
  };
}

describe('related documents follow their own collection rules', () => {
  test('a related document the reader cannot read stays a bare id', async () => {
    const { ids, anonymous } = await setup();
    const post = (await anonymous.collection('posts').findByID(ids.post)) as Record<
      string,
      unknown
    >;
    expect(post.author).toBe(ids.author);
    expect(post.team).toBe(ids.team);
    expect((post.credits as { who: unknown }[])[0]?.who).toBe(ids.author);

    const listed = await anonymous.collection('posts').find();
    expect(listed.docs[0]?.author).toBe(ids.author);
  });

  test('field-level read rules apply to the related document', async () => {
    const { ids, editor, admin } = await setup();
    const post = (await editor.collection('posts').findByID(ids.post)) as Record<string, unknown>;
    expect(post.author).toMatchObject({ id: ids.author, name: 'Ana' });
    expect(post.author).not.toHaveProperty('phone');
    const credit = (post.credits as { who: Record<string, unknown> }[])[0]?.who;
    expect(credit).toMatchObject({ name: 'Ana' });
    expect(credit).not.toHaveProperty('phone');

    const full = (await admin.collection('posts').findByID(ids.post)) as Record<string, unknown>;
    expect(full.author).toMatchObject({ phone: '555' });
  });

  test('a `where` read rule is applied to the related collection', async () => {
    const { ids, editor, writer } = await setup();
    const mine = (await editor.collection('posts').findByID(ids.post)) as Record<string, unknown>;
    expect(mine.team).toMatchObject({ name: 'editor' });
    const other = (await writer.collection('posts').findByID(ids.post)) as Record<string, unknown>;
    expect(other.team).toBe(ids.team);
  });

  test('an unpublished related document only shows to a draft read', async () => {
    const { ids, editor } = await setup();
    const live = (await editor.collection('posts').findByID(ids.post)) as Record<string, unknown>;
    expect(live.page).toBe(ids.page);
    const draft = (await editor.collection('posts').findByID(ids.post, { draft: true })) as Record<
      string,
      unknown
    >;
    expect(draft.page).toMatchObject({ title: 'Draft page' });
  });

  test('overrideAccess still populates everything', async () => {
    const { ids, anonymous } = await setup();
    const post = (await anonymous
      .collection('posts')
      .findByID(ids.post, { overrideAccess: true })) as Record<string, unknown>;
    expect(post.author).toMatchObject({ name: 'Ana' });
    expect(post.team).toMatchObject({ name: 'editor' });
    expect(post.page).toMatchObject({ title: 'Draft page' });
  });

  test('a create response does not populate what the creator cannot read', async () => {
    const { ids, writer } = await setup();
    const created = (await writer.collection('posts').create({
      title: 'Mine',
      team: ids.team,
    } as never)) as Record<string, unknown>;
    expect(created.team).toBe(ids.team);
  });
});

describe('related documents inside version snapshots', () => {
  test("are re-checked against the reader's rules", async () => {
    const { ids, admin, editor, writer } = await setup();
    const stored = await admin.collection('posts').version(ids.post, 1);
    const storedDoc = (stored?.snapshot as { doc: Record<string, unknown> } | undefined)?.doc;
    expect(storedDoc?.author).toMatchObject({ phone: '555' });

    const version = await editor.collection('posts').version(ids.post, 1);
    const doc = (version?.snapshot as { doc: Record<string, unknown> } | undefined)?.doc ?? {};
    // Written by the admin, with the phone populated; the editor does not see it.
    expect(doc.author).toMatchObject({ id: ids.author, name: 'Ana' });
    expect(doc.author).not.toHaveProperty('phone');
    expect((doc.credits as { who: Record<string, unknown> }[])[0]?.who).not.toHaveProperty('phone');

    const other = await writer.collection('posts').version(ids.post, 1);
    const otherDoc = (other?.snapshot as { doc: Record<string, unknown> } | undefined)?.doc ?? {};
    expect(otherDoc.team).toBe(ids.team);
  });
});
