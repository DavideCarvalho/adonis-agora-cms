import { getCms } from '../../services/main.js';
import { type DeliverWebhookInput, deliverWebhook } from './webhooks.js';

/**
 * The body of a queue job: one attempt, throwing so the queue retries it. The hook is looked up here
 * because the payload only holds its position: secrets stay out of the job store.
 */
export async function runWebhookDelivery(input: DeliverWebhookInput): Promise<void> {
  const hook = getCms().config.webhooks?.[input.hook];
  // The hook left the config since this job was queued: nothing to deliver to.
  if (hook) await deliverWebhook(hook, input.event);
}
