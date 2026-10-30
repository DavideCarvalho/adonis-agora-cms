import { BaseCommand, flags } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { renderPlan } from '../db/plan_render.js';
import { syncCmsSchema } from '../db/sync.js';
import { resolveCliContext } from './shared.js';

export default class CmsSync extends BaseCommand {
  static override commandName = 'cms:sync';
  static override description = 'Apply the CMS schema to the database';
  static override options: CommandOptions = { startApp: true };

  @flags.boolean({ description: 'Show the plan without applying it', alias: 'd' })
  declare dryRun: boolean;

  @flags.boolean({ description: 'Allow dropping tables/columns' })
  declare allowDestructive: boolean;

  @flags.boolean({ description: 'Shorthand for --allow-destructive', alias: 'f' })
  declare force: boolean;

  @flags.string({ description: 'Database connection to use', alias: 'c' })
  declare connection: string;

  override async run(): Promise<void> {
    const { spec, client, engine, config } = await resolveCliContext(this.app, this.connection);

    const plan = await syncCmsSchema(client, spec, {
      engine,
      dryRun: this.dryRun,
      allowDestructive: this.allowDestructive || this.force,
      prune: config.db?.prune ?? false,
    });

    if (this.dryRun) {
      this.logger.log(renderPlan(plan));
      this.logger.info('dry run: nothing was applied');
      return;
    }

    if (plan.creates.length === 0 && plan.alters.length === 0 && plan.drops.length === 0) {
      this.logger.success('Schema is up to date');
      return;
    }

    this.logger.success(
      `Applied schema: ${plan.creates.length} created, ${plan.alters.length} altered, ${plan.drops.length} dropped`,
    );
  }
}
