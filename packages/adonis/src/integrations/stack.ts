/*
 * What the CMS runs on, for telescope's Architecture page. Telescope walks `config/cms.ts` after boot
 * and reads a list of uses under this global symbol on any object or function it meets. The CMS does
 * not depend on telescope: the symbol is the whole contract.
 */

/** The symbol a config object or factory carries its uses under. */
export const STACK_DESCRIPTOR = Symbol.for('@adonis-agora/stack');

/** What a config object or factory uses. Never a secret or a URL with credentials. */
export type StackUse = {
  /** `postgres`, `mysql`, `sqlite`, `drive`, `s3`… lowercase, at most 32 characters. */
  tech: string;
  /** The Lucid connection it goes through. */
  connection?: string;
  /** What it is for, in a few words. */
  purpose?: string;
  /** A disk or bucket name, when there is no connection. */
  label?: string;
};

/** Attaches `use` to `target`, non-enumerable, replacing what was there. Returns `target`. */
export function describeStackUse<T extends object>(target: T, use: StackUse | StackUse[]): T {
  try {
    Object.defineProperty(target, STACK_DESCRIPTOR, {
      value: Array.isArray(use) ? use : [use],
      enumerable: false,
      configurable: true,
    });
  } catch {
    // A frozen object: nothing to describe.
  }
  return target;
}

const SQL_TECH: Record<string, string> = {
  pg: 'postgres',
  postgres: 'postgres',
  postgresql: 'postgres',
  'pg-native': 'postgres',
  mysql: 'mysql',
  mysql2: 'mysql',
  'better-sqlite3': 'sqlite',
  sqlite3: 'sqlite',
  sqlite: 'sqlite',
  libsql: 'sqlite',
  mssql: 'mssql',
  oracledb: 'oracle',
};

type DatabaseConfig = {
  connection?: unknown;
  connections?: Record<string, { client?: unknown } | undefined>;
};

/**
 * Tags the CMS config with the Lucid connection its documents live in: the app's default connection,
 * the one the provider writes through. Called at boot, when the `database` config is known.
 */
export function describeCmsDatabase(config: object, database: DatabaseConfig | undefined): void {
  const connection = typeof database?.connection === 'string' ? database.connection : undefined;
  if (!connection) return;
  const client = String(database?.connections?.[connection]?.client ?? '');
  describeStackUse(config, {
    tech: SQL_TECH[client] ?? 'sql',
    connection,
    purpose: 'content',
  });
}
