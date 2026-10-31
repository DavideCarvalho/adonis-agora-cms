import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  collection,
  createCmsEvents,
  defineConfig,
  fields,
  findRedirect,
  listenWebhooks,
  redirectsPlugin,
  seoPlugin,
  withPlugins,
} from '../../src/index.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const kits: TestCms[] = [];

afterEach(async () => {
  await Promise.all(kits.map((kit) => kit.destroy()));
  kits.length = 0;
});

const config = withPlugins(
  defineConfig({
    db: { id: 'uuid' },
    versions: { drafts: true },
    collections: [
      collection('notes', {
        fields: [
          fields.tabs('main', {
            tabs: [{ label: 'One', fields: [fields.text('title', { required: true })] }],
          }),
        ],
      }),
    ],
  }),
  [seoPlugin({ collections: ['notes'] }), redirectsPlugin()],
);

async function setup() {
  const kit = await createTestCms({ config });
  kits.push(kit);
  return createCms({ config, client: kit.client, user: { id: 'u1' } }) as never as {
    collection(slug: string): any;
    runDueSchedules(now?: Date): Promise<number>;
  };
}

describe('layout fields', () => {
  test('fields inside tabs are stored and required', async () => {
    const cms = await setup();
    const note = await cms.collection('notes').create({ title: 'Kept' });
    expect(note.title).toBe('Kept');
    await expect(cms.collection('notes').create({})).rejects.toMatchObject({
      fields: { title: 'required' },
    });
  });
});

describe('search', () => {
  test('ignores accents and case', async () => {
    const cms = await setup();
    await cms.collection('notes').create({ title: 'Início ÇA' });
    const found = await cms
      .collection('notes')
      .find({ where: { title: { icontains: 'inicio ca' } } });
    expect(found.totalDocs).toBe(1);
  });
});

describe('drafts on a published document', () => {
  test('stay out of what is live until publishing, and can be discarded', async () => {
    const cms = await setup();
    const notes = cms.collection('notes');
    const note = await notes.create({ title: 'Live' });

    const pending = await notes.update(note.id, { title: 'Edited' }, { asDraft: true });
    expect(pending).toMatchObject({ title: 'Edited', _hasDraft: true });
    expect((await notes.findByID(note.id)).title).toBe('Live');
    expect(await notes.findByID(note.id, { draft: true })).toMatchObject({
      title: 'Edited',
      _status: 'published',
      _hasDraft: true,
    });
    const listed = await notes.find({ draft: true });
    expect(listed.docs[0]).toMatchObject({ title: 'Edited', _hasDraft: true });

    await notes.discardDraft(note.id);
    expect(await notes.findByID(note.id, { draft: true })).toMatchObject({ title: 'Live' });
    expect((await notes.findByID(note.id, { draft: true }))._hasDraft).toBeUndefined();

    await notes.update(note.id, { title: 'Final' }, { asDraft: true });
    await notes.publish(note.id);
    expect((await notes.findByID(note.id)).title).toBe('Final');
    expect((await notes.findByID(note.id, { draft: true }))._hasDraft).toBeUndefined();
  });

  test('an autosave never changes what is live', async () => {
    const cms = await setup();
    const notes = cms.collection('notes');
    const note = await notes.create({ title: 'Live' });
    await notes.update(note.id, { title: 'Typing' }, { autosave: true });
    expect((await notes.findByID(note.id)).title).toBe('Live');
  });
});

describe('plugins', () => {
  test('seo adds a group; redirects works with a reserved word as a field name', async () => {
    const cms = await setup();
    const note = await cms
      .collection('notes')
      .create({ title: 'A', seo: { metaTitle: 'M', noIndex: true } });
    expect(note.seo.metaTitle).toBe('M');

    await cms.collection('redirects').create({ from: '/old', to: '/new', permanent: false });
    expect(await findRedirect(cms as never, '/old')).toEqual({ to: '/new', status: 302 });
    expect(await findRedirect(cms as never, '/other')).toBeNull();
  });
});

describe('scheduling', () => {
  test('runs what is due, once, and leaves the future alone', async () => {
    const cms = await setup();
    const notes = cms.collection('notes');
    const due = await notes.create({ title: 'Due' }, { draft: true });
    const later = await notes.create({ title: 'Later' }, { draft: true });

    await notes.schedule(due.id, { at: new Date('2020-01-01'), action: 'publish' });
    await notes.schedule(later.id, { at: new Date('2999-01-01'), action: 'publish' });

    expect(await cms.runDueSchedules()).toBe(1);
    expect(await cms.runDueSchedules()).toBe(0);
    expect((await notes.findByID(due.id, { draft: true }))._status).toBe('published');
    expect((await notes.findByID(later.id, { draft: true }))._status).toBe('draft');
    expect(await notes.scheduled(later.id)).toMatchObject({ action: 'publish' });
  });

  test('scheduling again replaces the pending change', async () => {
    const cms = await setup();
    const notes = cms.collection('notes');
    const note = await notes.create({ title: 'X' }, { draft: true });
    await notes.schedule(note.id, { at: new Date('2999-01-01'), action: 'publish' });
    await notes.schedule(note.id, { at: new Date('2999-06-01'), action: 'unpublish' });
    expect((await notes.scheduled(note.id)).action).toBe('unpublish');
    await notes.unschedule(note.id);
    expect(await notes.scheduled(note.id)).toBeNull();
  });
});

describe('webhooks', () => {
  test('filters, signs and retries', async () => {
    vi.useFakeTimers();
    const bus = createCmsEvents();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValue({ ok: true });

    listenWebhooks(
      bus,
      [{ url: 'https://x.test', secret: 's', collections: ['notes'] }],
      fetchMock as never,
    );
    const event = { operation: 'create', documentId: '1', tenant: null, userId: null } as const;
    bus.emit({ collection: 'other', ...event });
    bus.emit({ collection: 'notes', ...event });
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1].headers['x-cms-signature']).toMatch(/^sha256=/);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
