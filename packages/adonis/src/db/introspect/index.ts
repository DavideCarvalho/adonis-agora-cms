import type { CmsKnex, Engine, IntrospectedTable, Introspection } from '../types.js';
import { introspectMysql } from './mysql.js';
import { introspectPostgres } from './pg.js';
import { introspectSqlite } from './sqlite.js';

/**
 * Normalizes driver output. Knex returns rows directly for sqlite, `{ rows }` for pg and
 * `[rows, fields]` for mysql.
 */
export function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    const first = result[0];
    if (Array.isArray(first)) return first as Record<string, unknown>[];
    return result as Record<string, unknown>[];
  }

  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }

  return [];
}

export function firstRow(result: unknown): Record<string, unknown> | undefined {
  return rowsOf(result)[0];
}

export async function introspect(client: CmsKnex, engine: Engine): Promise<Introspection> {
  switch (engine) {
    case 'pg':
      return introspectPostgres(client);
    case 'mysql':
      return introspectMysql(client);
    case 'sqlite':
      return introspectSqlite(client);
    default:
      throw new Error(`unsupported engine: ${String(engine)}`);
  }
}

/** Tables whose name starts with the CMS prefix (system tables included). */
export function cmsTables(introspection: Introspection, prefix: string): IntrospectedTable[] {
  return introspection.tables.filter((table) => table.name.startsWith(prefix));
}

/** `cms_posts__layout__gallery` → 2. Parents sort before children. */
export function nameDepth(name: string): number {
  return name.split('__').length - 1;
}

export type { IntrospectedTable };
