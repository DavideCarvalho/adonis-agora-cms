import { BaseCommand, flags } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { diffSchema } from '../db/diff.js';
import { introspect } from '../db/introspect/index.js';
import { planExitCode, renderPlan } from '../db/plan_render.js';
import { resolveCliContext } from './shared.js';

/**
 * Prints the schema plan.
 *
 * Exit codes: `0` no drift, `1` drift, `2` destructive drift. That makes it a CI gate.
 */
export default class CmsDiff extends BaseCommand {
  static override commandName = 'cms:diff';
  static override description = 'Show the schema changes the CMS config would apply';
  static override options: CommandOptions = { startApp: true };

  @flags.boolean({ description: 'Print the plan as JSON', alias: 'j' })
  declare json: boolean;

  @flags.string({ description: 'Database connection to inspect', alias: 'c' })
  declare connection: string;

  override async run(): Promise<void> {
    const { spec, client, engine } = await resolveCliContext(this.app, this.connection);
    const introspection = await introspect(client, engine);
    const plan = diffSchema(spec, introspection, { renames: spec.renames });

    if (this.json) {
      this.logger.log(JSON.stringify(plan, null, 2));
    } else {
      this.logger.log(renderPlan(plan));
    }

    this.exitCode = planExitCode(plan);
  }
}
