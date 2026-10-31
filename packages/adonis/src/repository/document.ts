import { randomUUID } from 'node:crypto';
import type { CmsConfig, FieldConfig } from '../config/types.js';
import { resolveLocalization } from '../config/types.js';
import type { CmsKnex } from '../db/types.js';
import type { CmsEventBus } from '../integrations/durable.js';
import type { MediaAdapter } from '../integrations/media.js';
import type { CmsObservation } from '../integrations/telescope.js';
import type { ColumnSpec, Engine, SchemaSpec, TableSpec } from '../schema/types.js';
import { ident, placeholders, selectRows, sqlTimestamp } from './sql.js';

export type RepoContext = {
  spec: SchemaSpec;
  config: CmsConfig;
  client: CmsKnex;
  engine: Engine;
  tenant: string | null;
  user: unknown;
  req: unknown;
  locale: string;
  media?: MediaAdapter | undefined;
  observer?: ((observation: CmsObservation) => void) | undefined;
  events?: CmsEventBus | undefined;
};

export type Row = Record<string, unknown>;

export type WriteRows = {
  rootTable: string;
  root: Row;
  /** Ordered parents-before-children. */
  children: { table: string; rows: Row[] }[];
};

export type DocumentOptions = {
  depth?: number;
  locale?: string | undefined;
  select?: readonly string[] | undefined;
  /** Include soft-deleted rows (restore and admin tooling). */
  includeDeleted?: boolean | undefined;
};

export function documentTable(spec: SchemaSpec, slug: string): TableSpec {
  const table = spec.tables.find(
    (item) => (item.kind === 'collection' || item.kind === 'global') && item.slug === slug,
  );
  if (!table) throw new Error(`unknown collection "${slug}"`);
  return table;
}

export function documentFields(config: CmsConfig, slug: string): readonly FieldConfig[] {
  const collection = (config.collections ?? []).find((item) => item.slug === slug);
  if (collection) return collection.fields;
  const global = (config.globals ?? []).find((item) => item.slug === slug);
  return global?.fields ?? [];
}

/* ------------------------------------------------------------------ writing */

export function buildWriteRows(
  ctx: RepoContext,
  slug: string,
  data: Record<string, unknown>,
  options: { id?: string; status: 'draft' | 'published'; isNew: boolean },
): WriteRows {
  const table = documentTable(ctx.spec, slug);
  const id = options.id ?? (ctx.spec.idKind === 'uuid' ? randomUUID() : undefined);
  const now = sqlTimestamp(new Date(), ctx.engine);

  const root: Row = {
    ...(id !== undefined ? { id } : {}),
    ...(options.isNew ? { created_at: now } : {}),
    updated_at: now,
    _status: options.status,
  };

  if (ctx.spec.tenancy.column) {
    root[ctx.spec.tenancy.column] = ctx.tenant;
  }

  const children: { table: string; rows: Row[] }[] = [];
  const rowId = id ?? '';

  writeColumns(ctx, table, data, root, '');
  writeChildren(ctx, table, data, rowId, children, []);

  return { rootTable: table.name, root, children };
}

function writeColumns(
  ctx: RepoContext,
  table: TableSpec,
  data: Record<string, unknown>,
  row: Row,
  pathPrefix: string,
): void {
  for (const column of table.columns) {
    if (!column.path) continue;

    const relative = relativePath(column.path, pathPrefix);
    if (relative === undefined) continue;

    if (relative === '_status' || relative === '_tenant_id' || relative === 'type') continue;
    if (column.name === 'id' || column.name.startsWith('_')) continue;

    const value = getByPath(data, relative);
    if (value === undefined) continue;

    if (column.locale) {
      const localized = isLocaleMap(value, ctx.spec.locales);
      const raw = localized ? value[column.locale] : value;
      row[column.name] = toColumnValue(raw, column, ctx.engine);
      continue;
    }

    row[column.name] = toColumnValue(value, column, ctx.engine);
  }
}

function writeChildren(
  ctx: RepoContext,
  parent: TableSpec,
  data: Record<string, unknown>,
  parentId: string,
  out: { table: string; rows: Row[] }[],
  pathPrefix: readonly string[],
): void {
  const childTables = ctx.spec.tables.filter(
    (table) => table.kind === 'child' && table.owner === parent.name,
  );

  for (const child of childTables) {
    const fieldName = child.path?.split('.').at(-1) ?? '';
    const value = data[fieldName];

    if (value === undefined) continue;
    const rows = buildChildRows(ctx, child, value, parentId);
    if (rows.length === 0) continue;

    out.push({ table: child.name, rows });

    for (const row of rows) {
      const rowId = String(row.id);
      const nested = row.__nested as Record<string, unknown> | undefined;
      if (nested) {
        writeChildren(ctx, child, nested, rowId, out, [...pathPrefix, fieldName]);
        delete row.__nested;
      }
    }
  }
}

function buildChildRows(
  ctx: RepoContext,
  table: TableSpec,
  value: unknown,
  parentId: string,
): Row[] {
  const localizedTable = table.columns.some((column) => column.name === '_locale');
  const rows: Row[] = [];

  const pushRows = (items: unknown[], locale?: string): void => {
    items.forEach((item, index) => {
      const row: Row = {
        id: randomUUID(),
        _parent_id: parentId,
        _order: index,
        ...(localizedTable ? { _locale: locale ?? ctx.locale } : {}),
        ...(ctx.spec.tenancy.column ? { [ctx.spec.tenancy.column]: ctx.tenant } : {}),
      };

      if (table.columns.some((column) => column.name === 'value')) {
        row.value = String(item);
      } else if (table.columns.some((column) => column.name === 'related_id')) {
        normalizeRelationRow(row, item);
      } else {
        const object = item as Record<string, unknown>;
        row.type = object.type !== undefined ? String(object.type) : undefined;

        writeColumns(ctx, table, object, row, table.path ?? '');
        row.__nested = object;
      }

      if (row.type === undefined) delete row.type;
      rows.push(row);
    });
  };

  if (Array.isArray(value)) {
    pushRows(value);
  } else if (isLocaleMap(value, ctx.spec.locales)) {
    for (const locale of ctx.spec.locales) {
      const items = value[locale];
      if (Array.isArray(items)) pushRows(items, locale);
    }
  }

  return rows;
}

function normalizeRelationRow(row: Row, item: unknown): void {
  if (typeof item === 'string') {
    row.related_id = item;
    return;
  }

  const object = item as { id?: unknown; collection?: unknown };
  row.related_id = String(object.id ?? '');
  if (object.collection !== undefined) row.related_collection = String(object.collection);
}

/* ------------------------------------------------------------------ reading */

export function rowToDocument(
  ctx: RepoContext,
  table: TableSpec,
  row: Row,
  children: Map<string, Map<string, Row[]>>,
  options: DocumentOptions,
): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  const localized = new Map<string, Record<string, unknown>>();

  for (const column of table.columns) {
    if (!column.path) {
      if (column.name === 'id') doc.id = decodeValue(row[column.name], column);
      continue;
    }
    if (column.name.startsWith('_') && column.name !== '_status') continue;
    if (column.name === 'id') continue;

    const value = decodeValue(row[column.name], column);
    if (value === undefined) continue;

    if (column.locale) {
      const bucket = localized.get(column.path) ?? {};
      bucket[column.locale] = value;
      localized.set(column.path, bucket);
      continue;
    }

    setByPath(doc, column.path, value);
  }

  const localization = resolveLocalization(ctx.config);

  for (const [path, bucket] of localized) {
    if (options.locale) {
      setByPath(
        doc,
        path,
        pickLocale(bucket, options.locale, ctx.spec.defaultLocale, localization.fallback),
      );
    } else {
      setByPath(doc, path, completeLocaleMap(bucket, ctx.spec.locales));
    }
  }

  doc.id = row.id;
  doc.createdAt = toDate(row.created_at);
  doc.updatedAt = toDate(row.updated_at);
  doc._status = row._status ?? 'draft';

  for (const [childTable, byParent] of children) {
    const child = ctx.spec.tables.find((item) => item.name === childTable);
    if (!child) continue;

    const fieldName = child.path?.split('.').at(-1) ?? '';
    const rows = byParent.get(String(row.id)) ?? [];
    setByPath(doc, fieldName, childValue(ctx, child, rows, children, options));
  }

  return doc;
}

/** Localized child rows: one array per requested locale, or a `{ locale: rows }` map. */
function childValue(
  ctx: RepoContext,
  table: TableSpec,
  rows: Row[],
  children: Map<string, Map<string, Row[]>>,
  options: DocumentOptions,
): unknown {
  const localizedTable = table.columns.some((column) => column.name === '_locale');

  if (!localizedTable) {
    return rows.map((row) => rowToChildValue(ctx, table, row, children, options));
  }

  const localization = resolveLocalization(ctx.config);

  if (options.locale) {
    return pickLocaleRows(rows, options.locale, ctx.spec.defaultLocale, localization.fallback).map(
      (row) => rowToChildValue(ctx, table, row, children, options),
    );
  }

  const grouped: Record<string, unknown[]> = {};
  for (const locale of ctx.spec.locales) {
    grouped[locale] = rows
      .filter((row) => row._locale === locale)
      .map((row) => rowToChildValue(ctx, table, row, children, options));
  }
  return grouped;
}

function rowToChildValue(
  ctx: RepoContext,
  table: TableSpec,
  row: Row,
  children: Map<string, Map<string, Row[]>>,
  options: DocumentOptions = {},
): unknown {
  if (table.columns.some((column) => column.name === 'value')) return row.value;
  if (table.columns.some((column) => column.name === 'related_id')) {
    return row.related_collection
      ? { collection: String(row.related_collection), id: String(row.related_id) }
      : String(row.related_id);
  }

  const value: Record<string, unknown> = { id: row.id };
  if (row.type !== undefined) value.type = row.type;
  if (table.columns.some((column) => column.name === '_locale') && !options.locale) {
    value._locale = row._locale;
  }

  for (const column of table.columns) {
    if (!column.path || column.name.startsWith('_') || column.name === 'id') continue;
    const relative = relativePath(column.path, table.path ?? '');
    if (relative === undefined || relative === 'type') continue;
    const decoded = decodeValue(row[column.name], column);
    if (decoded === undefined) continue;
    if (column.locale) {
      const localized = (value[relative] as Record<string, unknown> | undefined) ?? {};
      localized[column.locale] = decoded;
      value[relative] = localized;
      continue;
    }
    setByPath(value, relative, decoded);
  }

  for (const child of ctx.spec.tables) {
    if (child.owner !== table.name) continue;
    const fieldName = child.path?.split('.').at(-1) ?? '';
    const rows = children.get(child.name)?.get(String(row.id)) ?? [];
    value[fieldName] = childValue(ctx, child, rows, children, options);
  }

  return value;
}

/** Loads every child table for the given root rows, batched per level. */
export async function loadChildTree(
  ctx: RepoContext,
  rootTable: TableSpec,
  rootIds: readonly string[],
): Promise<Map<string, Map<string, Row[]>>> {
  const result = new Map<string, Map<string, Row[]>>();
  if (rootIds.length === 0) return result;

  const queue: { table: TableSpec; ids: readonly string[] }[] = [
    { table: rootTable, ids: rootIds },
  ];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const children = ctx.spec.tables.filter(
      (table) => table.kind === 'child' && table.owner === item.table.name,
    );

    for (const child of children) {
      if (seen.has(child.name)) continue;
      seen.add(child.name);

      const conditions = [
        `${ident('_parent_id', ctx.engine)} in (${placeholders(item.ids.length)})`,
      ];
      const bindings: unknown[] = [...item.ids];

      if (ctx.spec.tenancy.column) {
        if (ctx.tenant === null) {
          conditions.push(`${ident(ctx.spec.tenancy.column, ctx.engine)} is null`);
        } else {
          conditions.push(`${ident(ctx.spec.tenancy.column, ctx.engine)} = ?`);
          bindings.push(ctx.tenant);
        }
      }

      const rows = await selectRows(
        ctx.client,
        `select * from ${ident(child.name, ctx.engine)} where ${conditions.join(' and ')} order by ${ident('_order', ctx.engine)} asc`,
        bindings,
      );

      const byParent = new Map<string, Row[]>();
      for (const row of rows) {
        const key = String(row._parent_id);
        const list = byParent.get(key) ?? [];
        list.push(row);
        byParent.set(key, list);
      }

      result.set(child.name, byParent);

      const childIds = rows.map((row) => String(row.id));
      if (childIds.length > 0) queue.push({ table: child, ids: childIds });
    }
  }

  return result;
}

/* ----------------------------------------------------------------- helpers */

export function relativePath(columnPath: string, tablePath: string): string | undefined {
  if (!tablePath) return columnPath;
  if (columnPath === tablePath) return '';
  if (columnPath.startsWith(`${tablePath}.`)) return columnPath.slice(tablePath.length + 1);
  return undefined;
}

export function getByPath(data: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, data);
}

export function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] ?? '';
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments.at(-1) ?? ''] = value;
}

export function toColumnValue(value: unknown, column: ColumnSpec, engine: Engine): unknown {
  if (value === undefined || value === null) return null;

  switch (column.type) {
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value);
    case 'boolean':
      if (engine === 'pg') return value;
      return value ? 1 : 0;
    case 'timestamp':
      if (value instanceof Date) return sqlTimestamp(value, engine);
      // A date picked in the panel arrives as a string; MySQL still refuses a zone in it.
      return engine === 'mysql' && /T.*Z$/.test(String(value))
        ? sqlTimestamp(new Date(String(value)), engine)
        : String(value);
    default:
      return value;
  }
}

export function decodeValue(value: unknown, column: ColumnSpec): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;

  switch (column.type) {
    case 'json': {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      return value === 1 || value === '1' || value === 't' || value === true;
    case 'timestamp':
      return toDate(value);
    case 'integer':
    case 'bigint':
    case 'float':
    case 'decimal':
      return typeof value === 'number' ? value : Number(value);
    default:
      return value;
  }
}

function pickLocale(
  bucket: Record<string, unknown>,
  locale: string,
  defaultLocale: string,
  fallback: boolean,
): unknown {
  const value = bucket[locale];
  if (!isEmptyValue(value)) return value;
  if (fallback) return bucket[defaultLocale] ?? null;
  return value ?? null;
}

function completeLocaleMap(
  bucket: Record<string, unknown>,
  locales: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const locale of locales) out[locale] = bucket[locale] ?? null;
  return out;
}

function pickLocaleRows(
  rows: Row[],
  locale: string,
  defaultLocale: string,
  fallback: boolean,
): Row[] {
  const scoped = rows.filter((row) => row._locale === locale);
  if (scoped.length > 0 || !fallback) return scoped;
  return rows.filter((row) => row._locale === defaultLocale);
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function toDate(value: unknown): Date | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isLocaleMap(value: unknown, locales: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => locales.includes(key));
}
