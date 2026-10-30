import type { ApplicationService } from '@adonisjs/core/types';
import type { CmsConfig } from '../config/types.js';
import { assertValidConfig } from '../config/validate.js';
import { detectEngine } from '../db/sync.js';
import type { CmsKnex } from '../db/types.js';
import { CmsConfigError } from '../errors.js';
import { compileSchema } from '../schema/compile.js';
import type { Engine, SchemaSpec } from '../schema/types.js';

export type CliContext = {
  config: CmsConfig;
  spec: SchemaSpec;
  client: CmsKnex;
  engine: Engine;
};

type ConfigRepository = { get(key: string): unknown };
type LucidDatabase = { connection(name?: string): { getWriteClient(): unknown } };

/**
 * Resolves the config and the write connection from the running app.
 *
 * The config comes from the app's config repository (`config/cms.ts`), not from a relative
 * import, so the package works whatever the user's directory layout is.
 */
export async function resolveCliContext(
  app: ApplicationService,
  connectionName?: string,
): Promise<CliContext> {
  const configRepository = (await app.container.make('config')) as ConfigRepository;
  const config = configRepository.get('cms') as CmsConfig | undefined;

  if (!config) {
    throw new CmsConfigError(
      'config/cms.ts',
      'CMS config not found; run `node ace configure @adonis-agora/cms`',
    );
  }

  assertValidConfig(config);

  const database = (await app.container.make('lucid.db')) as LucidDatabase;
  const client = database.connection(connectionName).getWriteClient() as CmsKnex;
  const engine = detectEngine(client);
  const spec = compileSchema(config, { engine });

  return { config, spec, client, engine };
}
