import { afterEach, describe, expect, test } from 'vitest';
import { validateConfig } from '../../src/config/validate.js';
import { collection, defineConfig, fields } from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  versions: { drafts: true },
  collections: [
    collection('members', {
      fields: [
        fields.text('name', { required: true }),
        fields.password('secret', { required: true }),
        fields.tabs('more', {
          tabs: [{ label: 'More', fields: [fields.password('pin')] }],
        }),
      ],
    }),
    collection('notes', {
      fields: [
        fields.text('title'),
        fields.relation('member', { relationTo: 'members' }),
        fields.select('kind', {
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
          validate: ({ value }) => (value === 'b' ? 'no b' : undefined),
        }),
        fields.text('code', {
          validate: async ({ value }) => (value === 'taken' ? 'already taken' : undefined),
        }),
        fields.blocks('layout', {
          maxRows: 1,
          blocks: [{ slug: 'hero', fields: [fields.text('heading')] }],
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
  return createCms({ config, client: kit.client, user: { id: 'u1' } });
}

async function stored(id: string): Promise<Record<string, unknown>> {
  const rows = await kit.client.raw('select secret, pin from cms_members where id = ?', [id]);
  return (Array.isArray(rows) ? rows[0] : rows.rows[0]) as Record<string, unknown>;
}

describe('fields.password', () => {
  test('is hashed on write and never comes back', async () => {
    const cms = await setup();
    const created = await cms.collection('members').create({ name: 'A', secret: 'hunter2' });

    expect(created).not.toHaveProperty('secret');
    expect(String((await stored(String(created.id))).secret)).toMatch(/^scrypt\$/);

    const read = await cms.collection('members').findByID(String(created.id));
    expect(read).not.toHaveProperty('secret');
    const list = await cms.collection('members').find();
    expect(list.docs[0]).not.toHaveProperty('secret');
  });

  test('stays out of versions and of a populated relation', async () => {
    const cms = await setup();
    const member = await cms.collection('members').create({ name: 'A', secret: 'hunter2' });
    const note = await cms.collection('notes').create({ title: 'N', member: String(member.id) });

    const read = await cms.collection('notes').findByID(String(note.id), { depth: 1 });
    expect(JSON.stringify(read)).not.toContain('scrypt$');

    await cms.collection('members').update(String(member.id), { name: 'B' });
    const versions = await cms.collection('members').versions(String(member.id));
    expect(JSON.stringify(versions)).not.toContain('scrypt$');
    expect(JSON.stringify(versions)).not.toContain('hunter2');
  });

  test('an update that does not send it, or sends it empty, keeps it', async () => {
    const cms = await setup();
    const { id } = await cms.collection('members').create({ name: 'A', secret: 'hunter2' });
    const before = (await stored(String(id))).secret;

    await cms.collection('members').update(String(id), { name: 'B' });
    expect((await stored(String(id))).secret).toBe(before);

    await cms.collection('members').update(String(id), { secret: '' } as never);
    expect((await stored(String(id))).secret).toBe(before);
  });

  test('changing it, and checking it', async () => {
    const cms = await setup();
    const { id } = await cms.collection('members').create({ name: 'A', secret: 'hunter2' });
    const members = cms.collection('members');

    expect(await members.checkPassword(String(id), 'secret', 'hunter2')).toBe(true);
    expect(await members.checkPassword(String(id), 'secret', 'wrong')).toBe(false);
    expect(await members.checkPassword(String(id), 'pin', 'anything')).toBe(false);
    expect(await members.checkPassword(String(id), 'name', 'A')).toBe(false);

    await members.update(String(id), { secret: 'changed' } as never);
    expect(await members.checkPassword(String(id), 'secret', 'hunter2')).toBe(false);
    expect(await members.checkPassword(String(id), 'secret', 'changed')).toBe(true);
  });

  test('cannot be filtered or sorted by, which would leak the hash a character at a time', async () => {
    const cms = await setup();
    await cms.collection('members').create({ name: 'A', secret: 'hunter2' });

    const found = await cms.collection('members').find({ where: { secret: { like: 'scrypt%' } } });
    expect(found.docs).toHaveLength(0);
    await expect(cms.collection('members').find({ sort: 'secret' })).rejects.toMatchObject({
      fields: { secret: expect.any(String) },
    });
  });
});

describe('field validation', () => {
  test('`validate` runs on every kind of value', async () => {
    const cms = await setup();
    await expect(cms.collection('notes').create({ kind: 'b' } as never)).rejects.toMatchObject({
      fields: { kind: 'no b' },
    });
  });

  test('an async `validate` is awaited', async () => {
    const cms = await setup();
    await expect(cms.collection('notes').create({ code: 'taken' } as never)).rejects.toMatchObject({
      fields: { code: 'already taken' },
    });
    await expect(cms.collection('notes').create({ code: 'free' } as never)).resolves.toBeDefined();
  });

  test('blocks respect `maxRows`', async () => {
    const cms = await setup();
    const row = { type: 'hero', heading: 'x' };
    await expect(
      cms.collection('notes').create({ layout: [row, row] } as never),
    ).rejects.toMatchObject({ fields: { layout: expect.stringContaining('at most 1') } });
  });
});

describe('options the CMS cannot honor', () => {
  const messages = (field: unknown) =>
    validateConfig(defineConfig({ collections: [collection('x', { fields: [field as never] })] }))
      .map((error) => error.message)
      .join('\n');

  test('field hooks point at the collection hooks', () => {
    expect(messages({ type: 'text', name: 'a', hooks: { beforeChange: [] } })).toMatch(
      /collection/,
    );
  });

  test.each([
    [{ type: 'date', name: 'a', withTime: true }, 'withTime'],
    [{ type: 'code', name: 'a', language: 'ts' }, 'language'],
    [{ type: 'password', name: 'a', hashWith: 'x' }, 'hashWith'],
    [{ type: 'text', name: 'a', admin: { position: 'sidebar' } }, 'position'],
  ])('%o is refused', (field, option) => {
    expect(messages(field)).toContain(option);
  });

  test('a password only lives at the top of a document', () => {
    const password = { type: 'password', name: 'p' };
    expect(messages({ type: 'array', name: 'a', fields: [password] })).toMatch(/top level/);
    expect(messages({ type: 'group', name: 'a', fields: [password] })).toMatch(/top level/);
    expect(messages({ ...password, localized: true })).toMatch(/localized/);
  });
});
