import { createHmac } from 'node:crypto';
import type { CmsEvent, CmsEventBus } from './durable.js';

export type WebhookConfig = {
  url: string;
  /** Signs the body: `x-cms-signature: sha256=<hmac>`. */
  secret?: string;
  /** Only these collections. Default: all. */
  collections?: readonly string[];
  /** Only these operations. Default: all. */
  operations?: readonly CmsEvent['operation'][];
};

export type DeliverWebhookInput = { hook: number; event: CmsEvent };

/** The port for background work. Without one, webhooks are delivered in process. */
export type CmsJobs = {
  deliverWebhook(input: DeliverWebhookInput): Promise<unknown>;
};

const RETRY_DELAYS_MS = [1_000, 4_000];

function matches(hook: WebhookConfig, event: CmsEvent): boolean {
  if (hook.collections && !hook.collections.includes(event.collection)) return false;
  if (hook.operations && !hook.operations.includes(event.operation)) return false;
  return true;
}

/** One attempt. Throws on a network failure or a non-2xx answer, so a queue can retry it. */
export async function deliverWebhook(
  hook: WebhookConfig,
  event: CmsEvent,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const body = JSON.stringify({ event: `${event.collection}.${event.operation}`, ...event });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (hook.secret) {
    const digest = createHmac('sha256', hook.secret).update(body).digest('hex');
    headers['x-cms-signature'] = `sha256=${digest}`;
  }

  const response = await fetchImpl(hook.url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`webhook answered ${response.status}`);
}

/**
 * Sends every committed write to the configured URLs. A slow or dead endpoint never holds the write
 * back: the delivery runs after the commit, with a timeout and two retries, then it logs and gives
 * up. For deliveries that must survive a restart, see `listenDurableWebhooks`.
 */
export function listenWebhooks(
  bus: CmsEventBus,
  hooks: readonly WebhookConfig[],
  fetchImpl: typeof fetch = globalThis.fetch,
): () => void {
  return bus.on((event) => {
    for (const hook of hooks) {
      if (matches(hook, event)) void deliverWithRetries(hook, event, fetchImpl);
    }
  });
}

/**
 * The same, through a queue. If the job cannot be enqueued (the store is down, the worker class is not
 * registered), the in-process delivery takes over: a misconfigured queue must not lose the event.
 */
export function listenQueuedWebhooks(
  bus: CmsEventBus,
  hooks: readonly WebhookConfig[],
  jobs: CmsJobs,
  fetchImpl: typeof fetch = globalThis.fetch,
): () => void {
  return bus.on((event) => {
    hooks.forEach((hook, index) => {
      if (!matches(hook, event)) return;
      jobs.deliverWebhook({ hook: index, event }).catch((error: unknown) => {
        console.error('[cms] webhook job failed to enqueue, delivering in process', error);
        void deliverWithRetries(hook, event, fetchImpl);
      });
    });
  });
}

async function deliverWithRetries(
  hook: WebhookConfig,
  event: CmsEvent,
  fetchImpl: typeof fetch,
  attempt = 0,
): Promise<void> {
  try {
    await deliverWebhook(hook, event, fetchImpl);
  } catch (failure) {
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      console.error('[cms] webhook gave up', hook.url, failure);
      return;
    }
    setTimeout(() => void deliverWithRetries(hook, event, fetchImpl, attempt + 1), delay).unref?.();
  }
}
