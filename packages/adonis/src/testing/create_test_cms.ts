import type { Knex } from 'knex';
import type { CmsConfig } from '../config/types.js';
import { introspect } from '../db/introspect/index.js';
import { detectEngine, syncCmsSchema } from '../db/sync.js';
import type { CmsKnex, Introspection } from '../db/types.js';
import { compileSchema } from '../schema/compile.js';
import type { Engine, SchemaSpec } from '../schema/types.js';

export type CreateTestCmsOptions = {
  config: CmsConfig;
  /** Skip the initial schema sync when the test creates it manually. */
  skipSync?: boolean;
  /** Record the applied hash in `cms_schema_state` (default `true`). */
  recordState?: boolean;
};

export type TestCms = {
  /** The compiled spec used by the kit. */
  spec: SchemaSpec;
  engine: Engine;
  /** Raw knex instance, for assertions that need SQL. */
  db: Knex;
  /** The same instance typed for the core. */
  client: CmsKnex;
  introspect(): Promise<Introspection>;
  /** Stub for the request user, used by access/hooks in later milestones. */
  actAs(user: unknown): void;
  /** Stub for the tenant scope, used by row tenancy in later milestones. */
  actAsTenant(tenant: string | null): void;
  current(): { user: unknown; tenant: string | null };
  destroy(): Promise<void>;
};

/**
 * In-memory SQLite harness.
 *
 * Everything integration-level goes through this: no test opens its own connection, and the
 * deterministic clock/tenant scope lives here.
 */
export async function createTestCms(options: CreateTestCmsOptions): Promise<TestCms> {
  const knexModule = (await import('knex')) as unknown as { default: typeof import('knex') };
  const factory = (knexModule.default ??
    (knexModule as unknown as typeof import('knex'))) as unknown as (config: unknown) => Knex;

  let db: Knex;
  try {
    db = factory({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
  } catch (error) {
    throw new Error(
      `createTestCms needs "knex" and "better-sqlite3" installed: ${(error as Error).message}`,
    );
  }

  const engine = detectEngine(db as unknown as CmsKnex);
  const spec = compileSchema(options.config, { engine });

  if (!options.skipSync) {
    await syncCmsSchema(db as unknown as CmsKnex, spec, {
      engine,
      skipState: options.recordState === false,
    });
  }

  let user: unknown = null;
  let tenant: string | null = null;

  return {
    spec,
    engine,
    db,
    client: db as unknown as CmsKnex,
    introspect: () => introspect(db as unknown as CmsKnex, engine),
    actAs(nextUser) {
      user = nextUser;
    },
    actAsTenant(nextTenant) {
      tenant = nextTenant;
    },
    current() {
      return { user, tenant };
    },
    async destroy() {
      await db.destroy();
    },
  };
}
