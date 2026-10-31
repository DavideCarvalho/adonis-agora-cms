import { type DeliverWebhookInput, runWebhookDelivery } from '@adonis-agora/cms';
import { Job } from '@adonisjs/queue';

export default class DeliverCmsWebhook extends Job<DeliverWebhookInput> {
  async execute() {
    await runWebhookDelivery(this.payload);
  }
}
