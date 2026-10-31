import { registerWorkflowClass } from '@adonis-agora/durable';
import { assertRunStatus, createTestEngine } from '@adonis-agora/durable/testing';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { getCms, setCms } from '../../services/main.js';
import { createCmsEvents, listenQueuedWebhooks } from '../../src/index.js';
import { CmsDeliverWebhook, CmsRunDueSchedules } from '../../src/integrations/durable_workflows.js';

const event = {
  collection: 'notes',
  operation: 'create',
  documentId: '1',
  tenant: null,
  userId: null,
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('durable workflows', () => {
  test('a delivery retries inside the run until the endpoint answers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setCms({ config: { webhooks: [{ url: 'https://x.test', secret: 's' }] } } as never);

    const t = createTestEngine();
    await registerWorkflowClass(t.engine, CmsDeliverWebhook);
    await t.run('cms.deliver-webhook', { hook: 0, event }, 'run1');
    for (let tries = 0; tries < 5 && fetchMock.mock.calls.length < 2; tries += 1) {
      await t.tick(60_000);
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    await assertRunStatus(t.store, 'run1', 'completed');
  });

  test('a run never stores the hook secret', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    setCms({ config: { webhooks: [{ url: 'https://x.test', secret: 'hunter2' }] } } as never);

    const t = createTestEngine();
    await registerWorkflowClass(t.engine, CmsDeliverWebhook);
    await t.run('cms.deliver-webhook', { hook: 0, event }, 'run2');
    const run = await t.store.getRun('run2');
    expect(JSON.stringify(run)).not.toContain('hunter2');
  });

  test('the schedule workflow runs what is due', async () => {
    const runDueSchedules = vi.fn().mockResolvedValue(2);
    setCms({ runDueSchedules } as never);
    expect(getCms()).toBeDefined();

    const t = createTestEngine();
    await registerWorkflowClass(t.engine, CmsRunDueSchedules);
    await t.run('cms.run-due-schedules', undefined, 'run3');
    expect(runDueSchedules).toHaveBeenCalledOnce();
    await assertRunStatus(t.store, 'run3', 'completed');
  });
});

describe('queued webhooks', () => {
  test('starts a run per matching hook', async () => {
    const bus = createCmsEvents();
    const start = vi.fn().mockResolvedValue(undefined);
    listenQueuedWebhooks(bus, [{ url: 'a', collections: ['other'] }, { url: 'b' }], {
      deliverWebhook: start,
    });
    bus.emit(event);
    expect(start).toHaveBeenCalledExactlyOnceWith({ hook: 1, event });
  });

  test('falls back to delivering in process when the run cannot start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bus = createCmsEvents();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    listenQueuedWebhooks(
      bus,
      [{ url: 'https://x.test' }],
      { deliverWebhook: () => Promise.reject(new Error('workflow is not registered')) },
      fetchMock as never,
    );
    bus.emit(event);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  });
});
