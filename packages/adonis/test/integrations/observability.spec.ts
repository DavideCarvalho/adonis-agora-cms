import { afterEach, describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { type CmsEvent, createCmsEvents, durableBridge } from '../../src/integrations/durable.js';
import { type CmsObservation, telescopeWatcher } from '../../src/integrations/telescope.js';
import { createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  collections: [collection('posts', { fields: [fields.text('title')] })],
});

let kit: TestCms;
afterEach(async () => {
  await kit?.destroy();
});

describe('telescope observer', () => {
  test('records one observation per write with collection, operation and duration', async () => {
    kit = await createTestCms({ config });
    const seen: CmsObservation[] = [];
    const cms = createCms({
      config,
      client: kit.client,
      user: { id: 'u1' },
      observer: (observation) => seen.push(observation),
    });

    const post = await cms.collection('posts').create({ title: 'a' });
    await cms.collection('posts').update(post.id, { title: 'b' });
    await cms.collection('posts').delete(post.id);

    expect(seen.map((entry) => entry.operation)).toEqual(['create', 'update', 'delete']);
    expect(seen[0]).toMatchObject({ collection: 'posts', ok: true, userId: 'u1' });
    expect(seen.every((entry) => entry.durationMs >= 0)).toBe(true);
  });

  test('telescopeWatcher maps to a tagged entry without document data', () => {
    const entries: unknown[] = [];
    const observer = telescopeWatcher((entry) => entries.push(entry), { tags: ['prod'] });

    observer({ collection: 'posts', operation: 'create', durationMs: 3, ok: true, tenant: 'acme' });

    expect(entries[0]).toMatchObject({
      type: 'cms',
      tags: ['prod', 'posts', 'create'],
      content: { collection: 'posts', durationMs: 3 },
    });
    expect(JSON.stringify(entries[0])).not.toContain('"doc"');
  });
});

describe('durable events', () => {
  test('emits only after the transaction commits', async () => {
    const failing = defineConfig({
      collections: [
        collection('posts', {
          hooks: {
            afterChange: [
              () => {
                throw new Error('boom');
              },
            ],
          },
          fields: [fields.text('title')],
        }),
      ],
    });

    kit = await createTestCms({ config: failing });
    const bus = createCmsEvents();
    const events: CmsEvent[] = [];
    bus.on((event) => events.push(event));

    const cms = createCms({ config: failing, client: kit.client, events: bus });

    await expect(cms.collection('posts').create({ title: 'x' })).rejects.toThrow(/boom/);
    expect(events).toEqual([]);
  });

  test('emits a committed event and bridges it to a job', async () => {
    kit = await createTestCms({ config });
    const bus = createCmsEvents();
    const events: CmsEvent[] = [];
    bus.on((event) => events.push(event));

    const jobs: { name: string; payload: Record<string, unknown> }[] = [];
    durableBridge({
      jobName: 'cms.changed',
      dispatch: (name, payload) => jobs.push({ name, payload }),
    }).listen(bus);

    const cms = createCms({ config, client: kit.client, events: bus, user: { id: 'u1' } });
    const post = await cms.collection('posts').create({ title: 'a' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      collection: 'posts',
      operation: 'create',
      documentId: post.id,
    });
    expect(jobs[0]?.name).toBe('cms.changed');

    const unsubscribe = bus.on(() => undefined);
    unsubscribe();
    expect(bus.listenerCount()).toBe(2);
  });
});
