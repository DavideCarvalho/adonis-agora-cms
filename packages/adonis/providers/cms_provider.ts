import type { ApplicationService } from '@adonisjs/core/types';
import type { CmsConfig } from '../src/config/types.js';
import { resolveDbConfig } from '../src/config/types.js';
import { validateConfig } from '../src/config/validate.js';
import { detectEngine, readSchemaState, syncCmsSchema } from '../src/db/sync.js';
import type { CmsKnex } from '../src/db/types.js';
import { CmsConfigError } from '../src/errors.js';
import { compileSchema } from '../src/schema/compile.js';

/**
 * Wires the CMS into the app.
 *
 * In `managed` mode it applies the schema on boot in development/test and only reports drift
 * in production — DDL never runs silently against a production database.
 */
export default class CmsProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    const container = this.app.container as unknown as {
      singleton(name: string, factory: () => unknown): void;
    };
    container.singleton('cms.config', () => this.app.config.get('cms'));
  }

  async boot(): Promise<void> {
    const config = this.app.config.get('cms') as CmsConfig | undefined;
    if (!config) return;

    const errors = validateConfig(config);
    if (errors.length > 0) {
      throw new CmsConfigError(
        'config',
        `invalid CMS configuration:\n${errors.map((error) => `  - ${error.message}`).join('\n')}`,
      );
    }

    if (resolveDbConfig(config).schema !== 'managed') return;

    const database = (await this.app.container.make('lucid.db')) as {
      connection(name?: string): { getWriteClient(): unknown };
    };
    const client = database.connection().getWriteClient() as CmsKnex;
    const engine = detectEngine(client);
    const spec = compileSchema(config, { engine });

    if (this.app.inProduction) {
      const state = await readSchemaState(client, spec.tablePrefix);
      if (state?.hash !== spec.hash) {
        const logger = await this.app.container.make('logger');
        (logger as { error(message: string): void }).error(
          'cms: schema drift detected. Run `node ace cms:sync` before serving traffic.',
        );
      }
      return;
    }

    await syncCmsSchema(client, spec, { engine });
  }
}
