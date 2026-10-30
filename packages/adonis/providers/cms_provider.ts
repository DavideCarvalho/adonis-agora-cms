import type { ApplicationService } from '@adonisjs/core/types';
import type { CmsConfig } from '../src/config/types.js';
import { resolveDbConfig, resolveTenancy } from '../src/config/types.js';
import { validateConfig } from '../src/config/validate.js';
import { detectEngine, readSchemaState, syncCmsSchema } from '../src/db/sync.js';
import type { CmsKnex } from '../src/db/types.js';
import { CmsConfigError } from '../src/errors.js';
import { createCms } from '../src/local_api/index.js';
import type { CmsRouter, RouteContext } from '../src/rest/routes.js';
import { registerCmsRoutes } from '../src/rest/routes.js';
import { compileSchema } from '../src/schema/compile.js';

type LucidDatabase = {
  connection(name?: string): { getWriteClient(): unknown };
};

/**
 * Wires the CMS into the app.
 *
 * - validates the config at boot;
 * - registers the REST routes when `rest.enabled !== false`;
 * - in `managed` mode applies the schema in development/test and only reports drift in
 *   production — DDL never runs silently against a production database.
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

    const database = (await this.app.container.make('lucid.db')) as LucidDatabase;
    const client = database.connection().getWriteClient() as CmsKnex;
    const engine = detectEngine(client);
    const spec = compileSchema(config, { engine });
    const cms = createCms({ config, client, engine });

    if (config.rest?.enabled !== false) {
      await this.registerRoutes(config, cms);
    }

    if (resolveDbConfig(config).schema !== 'managed') return;

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

  private async registerRoutes(
    config: CmsConfig,
    cms: ReturnType<typeof createCms>,
  ): Promise<void> {
    const router = (await this.app.container.make('router')) as CmsRouter;
    const tenancy = resolveTenancy(config);

    registerCmsRoutes(router, cms, {
      prefix: config.rest?.prefix ?? '/api/cms',
      resolveContext: async (context: RouteContext) => {
        const user = (context as { auth?: { user?: unknown } }).auth?.user ?? null;
        const hostname = context.request.hostname?.() ?? '';

        const tenant =
          tenancy.strategy === 'single'
            ? null
            : await tenancy.resolve({ hostname, path: '', request: context });

        return { user, tenant };
      },
    });
  }
}
