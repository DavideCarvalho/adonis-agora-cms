import { CmsSchemaError } from '../errors.js';
import type { ColumnSpec, Engine, SchemaSpec, TableSpec } from '../schema/types.js';
import { diffSchema } from './diff.js';
import { firstRow, introspect, rowsOf } from './introspect/index.js';
import type {
  CmsKnex,
  ColumnBuilderLike,
  SchemaPlan,
  SchemaState,
  SyncOptions,
  TableAlter,
  TableBuilderLike,
} from './types.js';

/**
 * Applies the compiled schema to the database.
 *
 * Idempotent: running it twice produces no statements the second time. Postgres/SQLite run the
 * whole plan in one transaction; MySQL does not have transactional DDL, so a partial failure
 * leaves the `cms_schema_state` untouched and the next run converges.
 */
export async function syncCmsSchema(
  client: CmsKnex,
  spec: SchemaSpec,
  options: SyncOptions = {},
): Promise<SchemaPlan> {
  const engine = options.engine ?? spec.engine;
  const introspection = await introspect(client, engine);
  const plan = diffSchema(spec, introspection, options);

  if (options.dryRun) return plan;

  if (plan.destructive && !options.allowDestructive) {
    throw new CmsSchemaError(
      'refusing to apply a destructive schema plan without allowDestructive',
      { plan },
    );
  }

  await applyPlan(client, plan, { engine });

  if (!options.skipState) {
    await writeSchemaState(client, spec, plan);
  }

  return plan;
}

/** Creates everything from scratch. Equivalent to a sync against an empty database. */
export async function createCmsTables(
  client: CmsKnex,
  spec?: SchemaSpec,
  options: SyncOptions = {},
): Promise<SchemaPlan> {
  if (!spec) {
    throw new CmsSchemaError('createCmsTables requires a compiled SchemaSpec');
  }
  return syncCmsSchema(client, spec, options);
}

/** Drops every CMS table (children first). */
export async function dropCmsTables(client: CmsKnex, prefix = 'cms_'): Promise<void> {
  const engine = detectEngine(client);
  const introspection = await introspect(client, engine);
  const names = introspection.tables
    .map((table) => table.name)
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => nameDepth(b) - nameDepth(a));

  for (const name of names) {
    await client.schema.dropTable(name);
  }
}

export async function applyPlan(
  client: CmsKnex,
  plan: SchemaPlan,
  options: { engine: Engine },
): Promise<void> {
  await withTransaction(client, options.engine, async (trx) => {
    for (const table of plan.creates) {
      await createTable(trx, table, options.engine);
    }

    for (const alter of plan.alters) {
      await applyTableAlter(trx, alter, options.engine);
    }

    for (const name of plan.drops) {
      await trx.schema.dropTable(name);
    }
  });
}

async function createTable(client: CmsKnex, table: TableSpec, engine: Engine): Promise<void> {
  const callback = (raw: unknown) => {
    const builder = raw as TableBuilderLike;
    for (const column of table.columns) {
      defineColumn(client, builder, column, engine);
    }
    for (const index of table.indexes) {
      addIndex(builder, index);
    }
  };

  const createTable = client.schema.createTable as unknown as (
    this: unknown,
    name: string,
    cb: (t: unknown) => unknown,
  ) => Promise<unknown>;

  await createTable.call(client.schema, table.name, callback);
}

async function applyTableAlter(client: CmsKnex, alter: TableAlter, engine: Engine): Promise<void> {
  const alterTable = client.schema.alterTable as unknown as (
    this: unknown,
    name: string,
    cb: (t: unknown) => unknown,
  ) => Promise<unknown>;

  // SQLite cannot change a column in place. A type/nullability change is applied as
  // drop + add, which is exactly why the diff marks it destructive.
  if (engine === 'sqlite') {
    await alterTable.call(client.schema, alter.table, (raw) => {
      const builder = raw as TableBuilderLike;
      for (const column of alter.dropColumns) builder.dropColumn(column);
      for (const column of alter.alterColumns) builder.dropColumn(column.column);
      for (const name of alter.dropIndexes) builder.dropIndex(name);
    });

    await alterTable.call(client.schema, alter.table, (raw) => {
      const builder = raw as TableBuilderLike;
      for (const column of alter.alterColumns) defineColumn(client, builder, column.to, engine);
      for (const column of alter.addColumns) defineColumn(client, builder, column, engine);
      for (const index of alter.addIndexes) addIndex(builder, index);
    });

    for (const rename of alter.renames) {
      await renameColumn(client, alter.table, rename.from, rename.to);
    }
    return;
  }

  await alterTable.call(client.schema, alter.table, (raw) => {
    const builder = raw as TableBuilderLike;
    for (const column of alter.dropColumns) builder.dropColumn(column);
    for (const name of alter.dropIndexes) builder.dropIndex(name);

    for (const column of alter.alterColumns) {
      const built = defineColumn(client, builder, column.to, engine);
      built.alter?.();
    }

    for (const column of alter.addColumns) defineColumn(client, builder, column, engine);
    for (const index of alter.addIndexes) addIndex(builder, index);
  });

  for (const rename of alter.renames) {
    await renameColumn(client, alter.table, rename.from, rename.to);
  }
}

async function renameColumn(
  client: CmsKnex,
  table: string,
  from: string,
  to: string,
): Promise<void> {
  const alterTable = client.schema.alterTable as unknown as (
    this: unknown,
    name: string,
    cb: (t: unknown) => unknown,
  ) => Promise<unknown>;

  await alterTable.call(client.schema, table, (raw) => {
    const builder = raw as TableBuilderLike;
    builder.renameColumn?.(from, to);
  });
}

function defineColumn(
  client: CmsKnex,
  table: TableBuilderLike,
  column: ColumnSpec,
  engine: Engine,
): ColumnBuilderLike {
  let builder: ColumnBuilderLike;

  switch (column.type) {
    case 'increment':
      builder = table.increments(column.name);
      break;
    case 'uuid':
      builder = table.uuid(column.name);
      if (column.name === 'id') builder.primary();
      break;
    case 'string':
      builder = table.string(column.name, column.length);
      break;
    case 'text':
      builder = table.text(column.name);
      break;
    case 'integer':
      builder = table.integer(column.name);
      break;
    case 'bigint':
      builder = table.bigInteger(column.name);
      break;
    case 'decimal':
      builder = table.decimal(column.name, column.precision, column.scale);
      break;
    case 'float':
      builder = table.float(column.name);
      break;
    case 'boolean':
      builder = table.boolean(column.name);
      break;
    case 'timestamp':
      builder = table.timestamp(column.name, { useTz: true });
      break;
    case 'json':
      builder = engine === 'pg' ? table.jsonb(column.name) : table.json(column.name);
      break;
    case 'binary':
      builder = table.binary(column.name);
      break;
    default:
      throw new CmsSchemaError(`unsupported column type "${String(column.type)}"`);
  }

  if (!column.nullable) builder.notNullable();

  if (column.default) {
    if (column.default.kind === 'now') {
      builder.defaultTo(nowValue(client));
    } else {
      builder.defaultTo(column.default.value);
    }
  }

  if (column.references) {
    builder
      .references(`${column.references.table}.${column.references.column}`)
      .onDelete(column.references.onDelete);
  }

  return builder;
}

/** Portable "now" default: the client's `fn.now()` when available, else a raw expression. */
function nowValue(client: CmsKnex): unknown {
  const now = client.fn?.now;
  if (typeof now === 'function') return now.call(client.fn);
  return client.raw('CURRENT_TIMESTAMP');
}

function addIndex(
  table: TableBuilderLike,
  index: SchemaSpec['tables'][number]['indexes'][number],
): void {
  if (index.unique) {
    table.unique([...index.columns], { indexName: index.name });
    return;
  }
  table.index([...index.columns], index.name);
}

async function withTransaction<T>(
  client: CmsKnex,
  engine: Engine,
  callback: (trx: CmsKnex) => Promise<T>,
): Promise<T> {
  if (engine === 'mysql') return callback(client);

  const transaction = client.transaction as
    | ((cb: (trx: CmsKnex) => Promise<T>) => Promise<T>)
    | undefined;

  if (typeof transaction !== 'function') return callback(client);

  return (transaction as unknown as (cb: (trx: CmsKnex) => Promise<T>) => Promise<T>).call(
    client,
    callback,
  );
}

function nameDepth(name: string): number {
  return name.split('__').length - 1;
}

export function detectEngine(client: CmsKnex): Engine {
  const name = (client as unknown as { client?: { config?: { client?: string } } }).client?.config
    ?.client;
  if (name === 'pg' || name === 'postgres' || name === 'postgresql') return 'pg';
  if (name === 'mysql' || name === 'mysql2') return 'mysql';
  return 'sqlite';
}

/* ---------------------------------------------------------------- schema state */

export function stateTableName(prefix: string): string {
  return `${prefix}schema_state`;
}

export async function writeSchemaState(
  client: CmsKnex,
  spec: SchemaSpec,
  plan: SchemaPlan,
): Promise<void> {
  const table = stateTableName(spec.tablePrefix);
  await ensureStateTable(client, table);

  await client.raw(
    `insert into ${table} (spec_hash, engine, plan, applied_at) values (?, ?, ?, ?)`,
    [spec.hash, spec.engine, JSON.stringify(plan), new Date().toISOString()],
  );
}

export async function readSchemaState(
  client: CmsKnex,
  prefix = 'cms_',
): Promise<SchemaState | null> {
  const table = stateTableName(prefix);

  try {
    const row = firstRow(
      await client.raw(
        `select spec_hash, engine, applied_at from ${table} order by applied_at desc limit 1`,
      ),
    );
    if (!row) return null;

    return {
      hash: String(row.spec_hash),
      engine: row.engine as Engine,
      appliedAt: row.applied_at ? new Date(String(row.applied_at)) : null,
    };
  } catch {
    return null;
  }
}

async function ensureStateTable(client: CmsKnex, table: string): Promise<void> {
  if (await client.schema.hasTable(table)) return;

  const createTable = client.schema.createTable as unknown as (
    this: unknown,
    name: string,
    cb: (t: unknown) => unknown,
  ) => Promise<unknown>;

  await createTable.call(client.schema, table, (raw) => {
    const builder = raw as TableBuilderLike;
    builder.increments('id');
    builder.string('spec_hash', 64).notNullable();
    builder.string('engine', 16).notNullable();
    builder.text('plan');
    builder.timestamp('applied_at', { useTz: true }).notNullable();
  });
}

export { rowsOf };
