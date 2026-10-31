import { snakeCase } from '../schema/column_specs.js';
import type { SchemaSpec, TableSpec } from '../schema/types.js';
import { tableDepth } from '../schema/types.js';
import type {
  ColumnAlter,
  DiffOptions,
  IntrospectedColumn,
  IntrospectedTable,
  Introspection,
  SchemaPlan,
  TableAlter,
} from './types.js';
import { emptyPlan } from './types.js';

/**
 * Compares the compiled spec with what the database actually has.
 *
 * Pure: takes introspection as data, returns a plan. Never touches the database, which is what
 * makes `cms:diff --dry-run` trustworthy and testable without a live server.
 */
export function diffSchema(
  spec: SchemaSpec,
  introspection: Introspection,
  options: DiffOptions = {},
): SchemaPlan {
  const plan = emptyPlan();
  const { renameMap, unresolved } = resolveRenames(spec, options.renames ?? spec.renames ?? {});

  for (const entry of unresolved) {
    plan.warnings.push(`rename source "${entry}" does not resolve to a known field; ignored`);
  }

  const existing = new Map<string, IntrospectedTable>();
  for (const table of introspection.tables) {
    if (!table.name.startsWith(spec.tablePrefix)) continue;
    existing.set(table.name, applyRenames(table, renameMap.get(table.name)));
  }

  const target = new Map<string, TableSpec>();
  for (const table of spec.tables) target.set(table.name, table);

  const creates = [...target.values()]
    .filter((table) => !existing.has(table.name))
    .sort((a, b) => tableDepth(a) - tableDepth(b) || compare(a.name, b.name));
  plan.creates.push(...creates);

  const orphans = [...existing.keys()].filter(
    (name) => !target.has(name) && !isInternalTable(name, spec.tablePrefix),
  );
  for (const name of orphans) {
    if (options.prune) {
      plan.drops.push(name);
      plan.destructive = true;
    } else {
      plan.warnings.push(
        `orphan table "${name}" is no longer in the config (set db.prune + --allow-destructive to drop it)`,
      );
    }
  }

  const alters: TableAlter[] = [];

  for (const [name, targetTable] of target) {
    const existingTable = existing.get(name);
    if (!existingTable) continue;

    const renames = renameMap.get(name) ?? [];

    const alter = diffTable(targetTable, existingTable, renames, spec.engine);
    if (
      alter.addColumns.length > 0 ||
      alter.dropColumns.length > 0 ||
      alter.alterColumns.length > 0 ||
      alter.addIndexes.length > 0 ||
      alter.dropIndexes.length > 0 ||
      alter.renames.length > 0
    ) {
      alters.push(alter);
    }

    if (alter.dropColumns.length > 0) plan.destructive = true;

    for (const column of alter.alterColumns) {
      if (isDestructiveAlter(column)) plan.destructive = true;
    }
  }

  alters.sort((a, b) => nameDepth(a.table) - nameDepth(b.table) || compare(a.table, b.table));

  plan.alters = alters;
  plan.drops.sort((a, b) => nameDepth(b) - nameDepth(a));

  if (plan.destructive && !options.allowDestructive) {
    plan.warnings.push(
      'the plan contains destructive changes; re-run with --allow-destructive (or db.prune) to apply',
    );
  }

  return plan;
}

function diffTable(
  targetTable: TableSpec,
  existingTable: IntrospectedTable,
  renames: { from: string; to: string }[],
  engine: SchemaSpec['engine'],
): TableAlter {
  const targetColumns = new Map<string, TableSpec['columns'][number]>();
  for (const column of targetTable.columns) {
    // Primary keys are implied by the column type, never compared as columns.
    targetColumns.set(column.name, column);
  }

  const existingColumns = new Map<string, IntrospectedColumn>();
  for (const column of existingTable.columns) existingColumns.set(column.name, column);

  const addColumns = [...targetColumns.values()].filter(
    (column) => !existingColumns.has(column.name),
  );

  const dropColumns = [...existingColumns.keys()].filter((name) => !targetColumns.has(name));

  const alterColumns: ColumnAlter[] = [];
  for (const [name, targetColumn] of targetColumns) {
    const existingColumn = existingColumns.get(name);
    if (!existingColumn) continue;
    if (!sameColumn(existingColumn, targetColumn, engine)) {
      alterColumns.push({ column: name, from: existingColumn, to: targetColumn });
    }
  }

  const existingIndexes = new Map<string, IntrospectedTable['indexes'][number]>();
  for (const index of existingTable.indexes) {
    if (isPrimaryIndex(index.name)) continue;
    existingIndexes.set(index.name, index);
  }

  const addIndexes = targetTable.indexes.filter((index) => {
    const current = existingIndexes.get(index.name);
    if (!current) return true;
    return !sameIndex(current, index);
  });

  const targetIndexNames = new Set(targetTable.indexes.map((index) => index.name));
  const dropIndexes = [...existingIndexes.keys()].filter((name) => !targetIndexNames.has(name));

  return {
    table: targetTable.name,
    addColumns,
    dropColumns,
    alterColumns,
    addIndexes,
    dropIndexes,
    renames,
  };
}

export function sameColumn(
  existing: IntrospectedColumn,
  target: TableSpec['columns'][number],
  engine: SchemaSpec['engine'] = 'pg',
): boolean {
  if (existing.nullable !== target.nullable) return false;

  if (existing.type === target.type) {
    return (
      (existing.length ?? undefined) === (target.length ?? undefined) &&
      (existing.precision ?? undefined) === (target.precision ?? undefined) &&
      (existing.scale ?? undefined) === (target.scale ?? undefined)
    );
  }

  // Engines without a native uuid/serial type report the storage type back.
  return typesCompatible(existing.type, target.type, engine);
}

function typesCompatible(
  existing: IntrospectedColumn['type'],
  target: TableSpec['columns'][number]['type'],
  engine: SchemaSpec['engine'],
): boolean {
  if (
    (existing === 'increment' && target === 'integer') ||
    (existing === 'integer' && target === 'increment')
  ) {
    return true;
  }

  if (engine !== 'pg') {
    if (
      (existing === 'uuid' && target === 'string') ||
      (existing === 'string' && target === 'uuid')
    ) {
      return true;
    }
  }

  return false;
}

function sameIndex(
  existing: IntrospectedTable['indexes'][number],
  target: SchemaSpec['tables'][number]['indexes'][number],
): boolean {
  if (existing.unique !== (target.unique ?? false)) return false;
  if (existing.columns.length !== target.columns.length) return false;
  return existing.columns.every((column, index) => column === target.columns[index]);
}

function isPrimaryIndex(name: string): boolean {
  return name.endsWith('_pkey') || name.toUpperCase() === 'PRIMARY';
}

function isDestructiveAlter(alter: ColumnAlter): boolean {
  if (alter.from.type !== alter.to.type) return true;
  if (alter.from.nullable && !alter.to.nullable) return true;
  if (
    alter.from.length !== undefined &&
    alter.to.length !== undefined &&
    alter.to.length < alter.from.length
  ) {
    return true;
  }
  return false;
}

/**
 * Resolves `db.renames` (`posts.oldField: 'newField'`) into physical table/column pairs using
 * the spec's query plan.
 */
export function resolveRenames(
  spec: SchemaSpec,
  renames: Record<string, string>,
): { renameMap: Map<string, { from: string; to: string }[]>; unresolved: string[] } {
  const renameMap = new Map<string, { from: string; to: string }[]>();
  const unresolved: string[] = [];

  for (const [from, to] of Object.entries(renames)) {
    const segments = from.split('.');
    const slug = segments[0] ?? '';
    const pathSegments = segments.slice(1);
    const oldField = pathSegments.at(-1) ?? '';

    // The rename maps the OLD path to the NEW field name. Resolve the new field through the
    // query plan so groups and child tables land on the right column.
    const newLogicalPath = [...pathSegments.slice(0, -1), to].join('.');
    const entry = spec.queryPlan[newLogicalPath];
    const expectedRoot = `${spec.tablePrefix}${slug}`;

    if (!entry || entry.rootTable !== expectedRoot) {
      unresolved.push(from);
      continue;
    }

    const oldBase = snakeCase(oldField);
    if (!oldBase) {
      unresolved.push(from);
      continue;
    }

    const pairs = entry.columns
      ? Object.entries(entry.columns).map(([locale, newColumn]) => ({
          from: `${oldBase}_${locale.replace(/-/g, '_').toLowerCase()}`,
          to: newColumn,
        }))
      : [{ from: oldBase, to: entry.column }];

    const list = renameMap.get(entry.table) ?? [];
    list.push(...pairs);
    renameMap.set(entry.table, list);
  }

  return { renameMap, unresolved };
}

function applyRenames(
  table: IntrospectedTable,
  renames: { from: string; to: string }[] | undefined,
): IntrospectedTable {
  if (!renames || renames.length === 0) return table;

  const columns = table.columns.map((column) => ({ ...column }));
  const indexes = table.indexes.map((index) => ({ ...index, columns: [...index.columns] }));
  const byName = new Map(columns.map((column) => [column.name, column]));

  for (const { from: oldName, to: newName } of renames) {
    if (byName.has(newName)) continue;
    const column = byName.get(oldName);
    if (!column) continue;
    column.name = newName;
    byName.delete(oldName);
    byName.set(newName, column);

    for (const index of indexes) {
      index.columns = index.columns.map((name) => (name === oldName ? newName : name));
    }
  }

  return { ...table, columns, indexes };
}

function nameDepth(name: string): number {
  return name.split('__').length - 1;
}

/** Tables the CMS owns outside the compiled spec. They are never treated as orphans. */
const INTERNAL_TABLE_SUFFIXES = [
  'schema_state',
  'versions',
  'preferences',
  'document_locks',
  'document_schedules',
];

export function isInternalTable(name: string, prefix: string): boolean {
  return INTERNAL_TABLE_SUFFIXES.some((suffix) => name === `${prefix}${suffix}`);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
