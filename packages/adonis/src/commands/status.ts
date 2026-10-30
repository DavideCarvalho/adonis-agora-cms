import { BaseCommand, flags } from '@adonisjs/core/ace';
import type { CommandOptions } from '@adonisjs/core/types/ace';
import { firstRow } from '../db/introspect/index.js';
import { readSchemaState } from '../db/sync.js';
import { resolveCliContext } from './shared.js';

export default class CmsStatus extends BaseCommand {
  static override commandName = 'cms:status';
  static override description = 'Show the CMS schema state and document counts';
  static override options: CommandOptions = { startApp: true };

  @flags.boolean({ description: 'Print status as JSON', alias: 'j' })
  declare json: boolean;

  @flags.string({ description: 'Database connection to inspect', alias: 'c' })
  declare connection: string;

  override async run(): Promise<void> {
    const { spec, client } = await resolveCliContext(this.app, this.connection);
    const state = await readSchemaState(client, spec.tablePrefix);
    const inSync = state?.hash === spec.hash;

    const counts: Record<string, number> = {};
    for (const table of spec.tables) {
      if (table.kind !== 'collection' && table.kind !== 'global') continue;
      try {
        const row = firstRow(await client.raw(`select count(*) as total from ${table.name}`));
        counts[table.slug] = Number(row?.total ?? 0);
      } catch {
        counts[table.slug] = 0;
      }
    }

    if (this.json) {
      this.logger.log(JSON.stringify({ inSync, state, hash: spec.hash, counts }, null, 2));
      return;
    }

    this.logger.log(`schema: ${inSync ? 'up to date' : 'drift detected'}`);
    if (state) {
      this.logger.log(`applied: ${state.appliedAt?.toISOString() ?? 'unknown'} (${state.hash})`);
    } else {
      this.logger.log('applied: never (run `node ace cms:sync` or a migration)');
    }
    this.logger.log(`current: ${spec.hash}`);
    this.logger.log(`tables: ${spec.tables.length}`);
    this.logger.log('');
    for (const [slug, total] of Object.entries(counts)) {
      this.logger.log(`  ${slug}: ${total}`);
    }

    this.exitCode = inSync ? 0 : 1;
  }
}
