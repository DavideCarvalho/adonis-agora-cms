import { BaseCommand, flags } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { ensureVersionPartitions } from '../versions/partitions.js';
import { resolveCliContext } from './shared.js';

/**
 * Materialises the monthly `cms_versions` partitions and drops the ones outside retention.
 *
 * Scheduled monthly in production; a no-op on SQLite/MySQL.
 */
export default class CmsPartitions extends BaseCommand {
  static override commandName = 'cms:partitions';
  static override description = 'Create and prune monthly cms_versions partitions (Postgres)';
  static override options: CommandOptions = { startApp: true };

  @flags.number({ description: 'How many months ahead to create', alias: 'm' })
  declare monthsAhead?: number;

  @flags.number({ description: 'Drop partitions older than N months' })
  declare retentionMonths?: number;

  @flags.string({ description: 'Database connection to use', alias: 'c' })
  declare connection?: string;

  override async run(): Promise<void> {
    const { spec, client } = await resolveCliContext(this.app, this.connection);

    const result = await ensureVersionPartitions(client, spec, {
      ...(this.monthsAhead !== undefined ? { monthsAhead: this.monthsAhead } : {}),
      ...(this.retentionMonths !== undefined ? { retentionMonths: this.retentionMonths } : {}),
    });

    if (result.skipped) {
      this.logger.warning('partitioning is only available on Postgres; nothing to do');
      return;
    }

    this.logger.success(`Applied ${result.applied} partition statement(s)`);
  }
}
