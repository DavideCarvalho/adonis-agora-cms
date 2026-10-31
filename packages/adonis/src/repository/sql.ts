import { firstRow, rowsOf } from '../db/introspect/index.js';
import type { CmsKnex } from '../db/types.js';
import type { Engine } from '../schema/types.js';

export type Binding = unknown;

/**
 * A timestamp as this engine accepts it. MySQL rejects the `T...Z` form outright, so it gets UTC
 * without the zone: set `timezone: 'Z'` on the connection so it reads back as UTC too.
 */
export function sqlTimestamp(date: Date, engine: Engine): string {
  const iso = date.toISOString();
  return engine === 'mysql' ? iso.replace('T', ' ').replace('Z', '') : iso;
}

/** Quotes an identifier. Names always come from the compiled spec, never from user input. */
export function ident(name: string, engine: Engine): string {
  if (engine === 'mysql') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export async function selectRows(
  client: CmsKnex,
  sql: string,
  bindings: readonly Binding[] = [],
): Promise<Record<string, unknown>[]> {
  return rowsOf(await client.raw(sql, bindings));
}

export async function selectOne(
  client: CmsKnex,
  sql: string,
  bindings: readonly Binding[] = [],
): Promise<Record<string, unknown> | undefined> {
  return firstRow(await client.raw(sql, bindings));
}

export async function exec(
  client: CmsKnex,
  sql: string,
  bindings: readonly Binding[] = [],
): Promise<unknown> {
  return client.raw(sql, bindings);
}

export async function countRows(
  client: CmsKnex,
  table: string,
  where: { sql: string; bindings: Binding[] },
  engine: Engine,
): Promise<number> {
  const row = await selectOne(
    client,
    `select count(*) as total from ${ident(table, engine)}${where.sql}`,
    where.bindings,
  );
  return Number(row?.total ?? 0);
}

/** Last inserted id for auto-increment ids (uuid ids never need it). */
export async function lastInsertId(client: CmsKnex, engine: Engine): Promise<number> {
  const row =
    engine === 'mysql'
      ? await selectOne(client, 'select LAST_INSERT_ID() as id')
      : await selectOne(client, 'select last_insert_rowid() as id');
  return Number(row?.id ?? 0);
}

export async function transaction<T>(
  client: CmsKnex,
  engine: Engine,
  callback: (trx: CmsKnex) => Promise<T>,
): Promise<T> {
  if (engine === 'mysql') return callback(client);

  const maybe = client.transaction as
    | ((cb: (trx: CmsKnex) => Promise<T>) => Promise<T>)
    | undefined;

  if (typeof maybe !== 'function') return callback(client);
  return maybe.call(client, callback);
}
