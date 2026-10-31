import { BaseWorkflow, type WorkflowCtx } from '@adonis-agora/durable';
import { getCms } from '../../services/main.js';
import { runWebhookDelivery } from './run_webhook.js';
import type { DeliverWebhookInput } from './webhooks.js';

/**
 * One webhook delivery as a durable run: it survives a deploy and retries with backoff. The input
 * carries the hook's position in the config, not the hook, so the secret never lands in the run store.
 */
export class CmsDeliverWebhook extends BaseWorkflow {
  static override workflow = { name: 'cms.deliver-webhook', version: '1' };

  async run(ctx: WorkflowCtx, input: DeliverWebhookInput): Promise<void> {
    await ctx.localStep('deliver', () => runWebhookDelivery(input), { retries: 8, backoff: 'exp' });
  }
}

/**
 * Applies due scheduled changes from `durable:work`, so one process runs them however many web
 * instances there are. Pair it with `schedulerInterval: false`.
 */
export class CmsRunDueSchedules extends BaseWorkflow {
  static override workflow = { name: 'cms.run-due-schedules', version: '1' };
  static override schedule = { everyMs: 30_000, overlap: 'skip' as const };

  async run(ctx: WorkflowCtx): Promise<number> {
    return ctx.localStep('run-due', () => getCms().runDueSchedules());
  }
}
