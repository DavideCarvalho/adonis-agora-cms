import { resolveLocalization, versionsFor } from '../config/types.js';
import {
  CmsConflictError,
  CmsError,
  CmsForbiddenError,
  CmsNotFoundError,
  CmsUnauthorizedError,
  CmsValidationError,
} from '../errors.js';
import type { TableSpec } from '../schema/types.js';
import { recordVersion } from '../versions/store.js';
import { constraintToSql, decideAccess, existsSql, resolveEntry } from './access.js';
import {
  buildWriteRows,
  type DocumentOptions,
  documentFields,
  documentTable,
  loadChildTree,
  type RepoContext,
  type Row,
  rowToDocument,
  setByPath,
  type WriteRows,
} from './document.js';
import {
  countRows,
  exec,
  ident,
  lastInsertId,
  placeholders,
  selectOne,
  selectRows,
  transaction,
} from './sql.js';
import { validateDocument } from './validate.js';

export type WhereInput = Record<string, unknown>;
export type FindQuery = {
  where?: WhereInput;
  sort?: string;
  limit?: number;
  page?: number;
  depth?: number;
  locale?: string;
  draft?: boolean;
  /** Include soft-deleted documents (admin/restore tooling). */
  deleted?: boolean;
  select?: string[];
};

export type OperationOptions = {
  depth?: number;
  locale?: string;
  select?: string[];
  overrideAccess?: boolean;
  status?: 'draft' | 'published';
  /** Create as a draft (versioned collections). */
  draft?: boolean;
  /** Autosave versions do not fire `afterChange`. */
  autosave?: boolean;
  /** Replace the document instead of merging (used by version restore). */
  replace?: boolean;
  /** Skip the soft-delete stamp and remove the row (and children) for real. */
  force?: boolean;
};

export type FindResult = {
  docs: Record<string, unknown>[];
  totalDocs: number;
  limit: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

/* ------------------------------------------------------------------- create */

export async function createDocument(
  ctx: RepoContext,
  slug: string,
  data: Record<string, unknown>,
  options: OperationOptions = {},
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const table = documentTable(ctx.spec, slug);
  const access = decideAccess(
    collectionAccess(ctx, slug)?.create,
    accessArgs(ctx),
    options.overrideAccess,
  );
  if (!access.allowed) throw denied(ctx, `create "${slug}" is not allowed`);

  let payload = { ...data };
  payload = await runHooks(ctx, slug, 'beforeValidate', payload, { operation: 'create' });
  payload = await runHooks(ctx, slug, 'beforeChange', payload, { operation: 'create' });

  const validated = validate(ctx, slug, payload);
  await assertUnique(ctx, table, validated, undefined);

  const status = options.status ?? (options.draft === true ? 'draft' : 'published');
  const rows = buildWriteRows(ctx, slug, validated, { status, isNew: true });

  if (ctx.spec.tenancy.column && ctx.spec.tenancy.required && !ctx.tenant) {
    throw new CmsForbiddenError('a tenant is required to create documents');
  }

  const id = await transaction(ctx.client, ctx.engine, async (trx) => {
    const trxContext: RepoContext = { ...ctx, client: trx };
    const insertedId = await insertRows(trxContext, rows);
    const doc = await loadDocument(trxContext, slug, insertedId, {
      depth: options.depth ?? 1,
      locale: options.locale,
    });
    await runHooks(ctx, slug, 'afterChange', payload, {
      operation: 'create',
      doc: doc ?? { id: insertedId },
    });

    await recordVersion(trxContext, slug, insertedId, {
      status,
      snapshot: doc ?? { id: insertedId },
      autosave: options.autosave === true,
      locale: options.locale ?? null,
    });

    return insertedId;
  });

  const doc = await findDocumentByID(ctx, slug, id, {
    ...options,
    overrideAccess: true,
  });

  publishSideEffects(ctx, slug, 'create', id, doc ?? { id }, startedAt);

  return doc ?? { id };
}

/* --------------------------------------------------------------------- read */

export async function findDocuments(
  ctx: RepoContext,
  slug: string,
  query: FindQuery = {},
  options: OperationOptions = {},
): Promise<FindResult> {
  const table = documentTable(ctx.spec, slug);
  const access = decideAccess(
    collectionAccess(ctx, slug)?.read,
    accessArgs(ctx),
    options.overrideAccess,
  );
  if (!access.allowed) return emptyResult(query);

  const limit = Math.max(1, Math.min(query.limit ?? 20, 200));
  const page = Math.max(1, query.page ?? 1);
  // No locale means "give me the locale map"; the default locale is a write-time concern.
  const locale = query.locale ?? options.locale;

  const versions = versionsFor(ctx.config, slug);
  const includeDrafts = query.draft === true || options.draft === true;
  assertDraftAccess(ctx, versions.drafts, includeDrafts, options.overrideAccess);

  const where = buildWhere(
    ctx,
    table,
    query,
    access.constraint,
    versions.drafts && !includeDrafts,
    query.deleted === true,
  );
  const totalDocs = await countRows(ctx.client, table.name, where, ctx.engine);

  const columns =
    query.select && query.select.length > 0
      ? ['id', ...query.select.map((name) => resolveColumnName(ctx, table, name))]
      : ['*'];

  const sort = buildSort(ctx, table, query.sort);
  const rows = await selectRows(
    ctx.client,
    `select ${columns.map((column) => (column === '*' ? '*' : ident(column, ctx.engine))).join(', ')} from ${ident(table.name, ctx.engine)}${where.sql}${sort} limit ? offset ?`,
    [...where.bindings, limit, (page - 1) * limit],
  );

  const docs = await decorateMany(ctx, slug, rows, {
    depth: query.depth ?? options.depth ?? 1,
    locale,
  });

  const totalPages = Math.max(1, Math.ceil(totalDocs / limit));

  return {
    docs,
    totalDocs,
    limit,
    page,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

export async function findDocumentByID(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: OperationOptions = {},
): Promise<Record<string, unknown> | null> {
  const table = documentTable(ctx.spec, slug);
  const access = decideAccess(
    collectionAccess(ctx, slug)?.read,
    accessArgs(ctx, { id }),
    options.overrideAccess,
  );
  if (!access.allowed) return null;

  const versions = versionsFor(ctx.config, slug);
  const includeDrafts = options.draft === true;
  assertDraftAccess(ctx, versions.drafts, includeDrafts, options.overrideAccess);

  const doc = await loadDocument(ctx, slug, id, {
    depth: options.depth ?? 1,
    locale: options.locale,
    select: options.select,
  });

  if (!doc) return null;

  if (versions.drafts && !includeDrafts && !options.overrideAccess && doc._status !== 'published') {
    return null;
  }

  if (access.constraint) {
    const constraints = constraintToSql(access.constraint, ctx.spec, ctx.engine, table.name);
    const row = await selectOne(
      ctx.client,
      `select id from ${ident(table.name, ctx.engine)} where ${constraints.sql} and ${ident('id', ctx.engine)} = ?`,
      [...constraints.bindings, id],
    );
    if (!row) return null;
  }

  return doc;
}

/* ------------------------------------------------------------------- update */

export async function updateDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  data: Record<string, unknown>,
  options: OperationOptions = {},
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  const table = documentTable(ctx.spec, slug);
  const previous = await findDocumentByID(ctx, slug, id, { depth: 0, overrideAccess: true });
  if (!previous) throw new CmsNotFoundError(`"${slug}" ${id} not found`);

  const access = decideAccess(
    collectionAccess(ctx, slug)?.update,
    accessArgs(ctx, { id, data }),
    options.overrideAccess,
  );
  if (!access.allowed) throw denied(ctx, `update "${slug}" is not allowed`);

  let payload = { ...data };
  payload = await runHooks(ctx, slug, 'beforeValidate', payload, {
    operation: 'update',
    previousData: previous,
  });
  payload = await runHooks(ctx, slug, 'beforeChange', payload, {
    operation: 'update',
    previousData: previous,
  });

  const merged = options.replace === true ? payload : mergeDocument(previous, payload);
  const validated = validate(ctx, slug, merged);
  await assertUnique(ctx, table, validated, id);

  const status =
    options.status ??
    (payload._status === 'draft' ? 'draft' : (previous._status as 'draft' | 'published'));
  const rows = buildWriteRows(ctx, slug, validated, { id, status, isNew: false });
  rows.root.created_at = undefined;

  await transaction(ctx.client, ctx.engine, async (trx) => {
    const trxContext: RepoContext = { ...ctx, client: trx };
    await replaceRows(trxContext, table, id, rows);
    const doc = await loadDocument(trxContext, slug, id, {
      depth: options.depth ?? 1,
      locale: options.locale,
    });
    if (options.autosave !== true) {
      await runHooks(ctx, slug, 'afterChange', payload, {
        operation: 'update',
        doc: doc ?? { id },
        previousData: previous,
      });
    }

    await recordVersion(trxContext, slug, id, {
      status: options.autosave === true ? 'draft' : status,
      snapshot: doc ?? { id },
      autosave: options.autosave === true,
      locale: options.locale ?? null,
    });
  });

  const doc = await findDocumentByID(ctx, slug, id, { ...options, overrideAccess: true });
  publishSideEffects(ctx, slug, 'update', id, doc ?? { id }, startedAt);
  return doc ?? { id };
}

/* ------------------------------------------------------------------- delete */

export async function deleteDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: OperationOptions = {},
): Promise<void> {
  const startedAt = Date.now();
  const table = documentTable(ctx.spec, slug);
  const doc = await findDocumentByID(ctx, slug, id, { depth: 0, overrideAccess: true });
  if (!doc) throw new CmsNotFoundError(`"${slug}" ${id} not found`);

  const access = decideAccess(
    collectionAccess(ctx, slug)?.delete,
    accessArgs(ctx, { id }),
    options.overrideAccess,
  );
  if (!access.allowed) throw denied(ctx, `delete "${slug}" is not allowed`);

  await runHooks(ctx, slug, 'beforeDelete', doc, { operation: 'delete' });

  const soft = table.columns.some((column) => column.name === '_deleted_at');

  if (soft && options.force !== true) {
    await exec(
      ctx.client,
      `update ${ident(table.name, ctx.engine)} set ${ident('_deleted_at', ctx.engine)} = ? where ${ident('id', ctx.engine)} = ?`,
      [new Date().toISOString(), id],
    );
    await runHooks(ctx, slug, 'afterDelete', doc, { operation: 'delete' });
    publishSideEffects(ctx, slug, 'delete', id, undefined, startedAt);
    return;
  }

  await transaction(ctx.client, ctx.engine, async (trx) => {
    const trxContext: RepoContext = { ...ctx, client: trx };
    await deleteDescendants(trxContext, table, id, ctx.spec.tenancy.column);
    await exec(
      trxContext.client,
      `delete from ${ident(table.name, ctx.engine)} where ${ident('id', ctx.engine)} = ?`,
      [id],
    );
  });

  await runHooks(ctx, slug, 'afterDelete', doc, { operation: 'delete' });
  publishSideEffects(ctx, slug, 'delete', id, undefined, startedAt);
}

/** Emits observation + post-commit event. Never inside the transaction. */
function publishSideEffects(
  ctx: RepoContext,
  slug: string,
  operation: 'create' | 'update' | 'delete',
  documentId: string,
  doc: Record<string, unknown> | undefined,
  startedAt: number,
): void {
  ctx.observer?.({
    collection: slug,
    operation,
    durationMs: Math.max(0, Date.now() - startedAt),
    ok: true,
    documentId,
    tenant: ctx.tenant,
    userId: userIdOf(ctx.user),
  });

  ctx.events?.emit({
    collection: slug,
    operation,
    documentId,
    tenant: ctx.tenant,
    userId: userIdOf(ctx.user),
    ...(doc ? { doc } : {}),
  });
}

function userIdOf(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const id = (user as { id?: unknown }).id;
  return id === undefined || id === null ? null : String(id);
}

/** Clears `_deleted_at`, bringing a soft-deleted document back. */
export async function restoreDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: OperationOptions = {},
): Promise<Record<string, unknown>> {
  const table = documentTable(ctx.spec, slug);
  if (!table.columns.some((column) => column.name === '_deleted_at')) {
    throw new CmsNotFoundError(`"${slug}" does not use soft deletes`);
  }

  const access = decideAccess(
    collectionAccess(ctx, slug)?.update,
    accessArgs(ctx, { id }),
    options.overrideAccess,
  );
  if (!access.allowed) throw denied(ctx, `restore "${slug}" is not allowed`);

  const conditions = [`${ident('id', ctx.engine)} = ?`];
  const bindings: unknown[] = [id];
  if (ctx.spec.tenancy.column) {
    conditions.push(tenantCondition(ctx, ctx.spec.tenancy.column));
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  const existing = await selectOne(
    ctx.client,
    `select ${ident('id', ctx.engine)} as id from ${ident(table.name, ctx.engine)} where ${conditions.join(' and ')}`,
    bindings,
  );
  if (!existing) throw new CmsNotFoundError(`"${slug}" ${id} not found`);

  await exec(
    ctx.client,
    `update ${ident(table.name, ctx.engine)} set ${ident('_deleted_at', ctx.engine)} = null where ${conditions.join(' and ')}`,
    bindings,
  );

  const doc = await loadDocument(ctx, slug, id, {
    ...options,
    includeDeleted: true,
  });
  if (!doc) throw new CmsNotFoundError(`"${slug}" ${id} not found`);
  return doc;
}

/* ------------------------------------------------------------------ loading */

export async function loadDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: DocumentOptions = {},
): Promise<Record<string, unknown> | null> {
  const table = documentTable(ctx.spec, slug);
  const where = [`${ident('id', ctx.engine)} = ?`];
  const bindings: unknown[] = [id];

  if (ctx.spec.tenancy.column) {
    where.push(tenantCondition(ctx, ctx.spec.tenancy.column));
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  if (!options.includeDeleted && table.columns.some((column) => column.name === '_deleted_at')) {
    where.push(`${ident('_deleted_at', ctx.engine)} is null`);
  }

  const row = await selectOne(
    ctx.client,
    `select * from ${ident(table.name, ctx.engine)} where ${where.join(' and ')}`,
    bindings,
  );
  if (!row) return null;

  const [doc] = await decorateRows(ctx, slug, [row], options);
  return doc ?? null;
}

async function decorateMany(
  ctx: RepoContext,
  slug: string,
  rows: Row[],
  options: DocumentOptions,
): Promise<Record<string, unknown>[]> {
  return decorateRows(ctx, slug, rows, options);
}

async function decorateRows(
  ctx: RepoContext,
  slug: string,
  rows: Row[],
  options: DocumentOptions,
): Promise<Record<string, unknown>[]> {
  const table = documentTable(ctx.spec, slug);
  const children = await loadChildTree(
    ctx,
    table,
    rows.map((row) => String(row.id)),
  );

  const docs = rows.map((row) => rowToDocument(ctx, table, row, children, options));

  if ((options.depth ?? 1) > 0) {
    await populateRelations(ctx, table, docs, options);
  }

  for (const doc of docs) {
    stripFieldsByAccess(ctx, slug, doc);
  }

  return docs;
}

async function populateRelations(
  ctx: RepoContext,
  table: TableSpec,
  docs: Record<string, unknown>[],
  options: DocumentOptions,
): Promise<void> {
  const relationColumns = table.columns.filter(
    (column) => column.references && column.path && !column.locale,
  );

  await populateUploads(ctx, table, docs);

  for (const column of relationColumns) {
    const field = column.path ?? '';
    const targetSlug = ctx.spec.tables.find((item) => item.name === column.references?.table)?.slug;
    if (!targetSlug) continue;

    const targetTable = documentTable(ctx.spec, targetSlug);
    const ids = [
      ...new Set(docs.map((doc) => getRelationId(doc, field)).filter(Boolean)),
    ] as string[];
    if (ids.length === 0) continue;

    const rows = await selectRows(
      ctx.client,
      `select * from ${ident(targetTable.name, ctx.engine)} where ${ident('id', ctx.engine)} in (${placeholders(ids.length)})`,
      ids,
    );

    const byId = new Map(rows.map((row) => [String(row.id), row]));
    for (const doc of docs) {
      const id = getRelationId(doc, field);
      if (!id) continue;
      const targetRow = byId.get(id);
      if (!targetRow) continue;
      setByPath(
        doc,
        field,
        rowToDocument(ctx, targetTable, targetRow, new Map(), {
          depth: 0,
          locale: options.locale,
        }),
      );
    }
  }
}

async function populateUploads(
  ctx: RepoContext,
  table: TableSpec,
  docs: Record<string, unknown>[],
): Promise<void> {
  if (!ctx.media) return;

  const uploadFields = documentFields(ctx.config, table.slug).filter(
    (field) => field.type === 'upload',
  );

  for (const field of uploadFields) {
    const ids = docs
      .map((doc) => doc[field.name])
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (ids.length === 0) continue;

    const resolved = await ctx.media.resolveMany(ids);
    for (const doc of docs) {
      const id = doc[field.name];
      if (typeof id !== 'string') continue;
      doc[field.name] = resolved.get(id) ?? { id };
    }
  }
}

function getRelationId(doc: Record<string, unknown>, field: string): string | undefined {
  const value = getPath(doc, field);
  if (typeof value === 'string') return value;
  return undefined;
}

/* -------------------------------------------------------------------- write */

async function insertRows(ctx: RepoContext, rows: WriteRows): Promise<string> {
  const rootColumns = Object.keys(rows.root).filter((key) => rows.root[key] !== undefined);
  const rootValues = rootColumns.map((key) => rows.root[key]);

  if (ctx.spec.idKind === 'increment' && rows.root.id === undefined) {
    await exec(
      ctx.client,
      `insert into ${ident(rows.rootTable, ctx.engine)} (${rootColumns.map((name) => ident(name, ctx.engine)).join(', ')}) values (${placeholders(rootColumns.length)})`,
      rootValues,
    );
    const id = await lastInsertId(ctx.client, ctx.engine);
    rows.root.id = id;
    return String(id);
  }

  await exec(
    ctx.client,
    `insert into ${ident(rows.rootTable, ctx.engine)} (${rootColumns.map((name) => ident(name, ctx.engine)).join(', ')}) values (${placeholders(rootColumns.length)})`,
    rootValues,
  );

  for (const child of rows.children) {
    await insertChildRows(ctx, child.table, child.rows);
  }

  return String(rows.root.id);
}

async function insertChildRows(ctx: RepoContext, table: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
    .filter((key) => key !== '__nested')
    .filter((key) => rows.some((row) => row[key] !== undefined));

  const chunkSize = Math.max(1, Math.floor(900 / Math.max(1, columns.length)));

  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((row) => {
      for (const column of columns) values.push(row[column] === undefined ? null : row[column]);
      return `(${placeholders(columns.length)})`;
    });

    await exec(
      ctx.client,
      `insert into ${ident(table, ctx.engine)} (${columns.map((name) => ident(name, ctx.engine)).join(', ')}) values ${tuples.join(', ')}`,
      values,
    );
  }
}

async function replaceRows(
  ctx: RepoContext,
  table: TableSpec,
  id: string,
  rows: WriteRows,
): Promise<void> {
  await deleteDescendants(ctx, table, id, ctx.spec.tenancy.column);

  const columns = Object.keys(rows.root).filter(
    (key) => rows.root[key] !== undefined && key !== 'id' && key !== 'created_at',
  );

  await exec(
    ctx.client,
    `update ${ident(table.name, ctx.engine)} set ${columns.map((name) => `${ident(name, ctx.engine)} = ?`).join(', ')} where ${ident('id', ctx.engine)} = ?`,
    [...columns.map((key) => rows.root[key]), id],
  );

  for (const child of rows.children) {
    await insertChildRows(ctx, child.table, child.rows);
  }
}

async function deleteDescendants(
  ctx: RepoContext,
  table: TableSpec,
  id: string,
  _tenantColumn: string | null,
): Promise<void> {
  const children = ctx.spec.tables.filter(
    (item) => item.kind === 'child' && item.owner === table.name,
  );

  for (const child of children) {
    const rows = await selectRows(
      ctx.client,
      `select ${ident('id', ctx.engine)} as id from ${ident(child.name, ctx.engine)} where ${ident('_parent_id', ctx.engine)} = ?`,
      [id],
    );

    for (const row of rows) {
      await deleteDescendants(ctx, child, String(row.id), _tenantColumn);
    }

    await exec(
      ctx.client,
      `delete from ${ident(child.name, ctx.engine)} where ${ident('_parent_id', ctx.engine)} = ?`,
      [id],
    );
  }
}

/* --------------------------------------------------------------- validation */

function validate(
  ctx: RepoContext,
  slug: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const fields = documentFields(ctx.config, slug);
  const localization = resolveLocalization(ctx.config);
  const result = validateDocument(fields, data, {
    locales: ctx.spec.locales,
    defaultLocale: ctx.spec.defaultLocale,
    localizedRequired: localization.localizedRequired,
  });

  if (Object.keys(result.errors).length > 0) {
    throw new CmsValidationError(result.errors);
  }

  return result.data;
}

async function assertUnique(
  ctx: RepoContext,
  table: TableSpec,
  data: Record<string, unknown>,
  ignoreId: string | undefined,
): Promise<void> {
  for (const column of table.columns) {
    if (!column.unique || !column.path) continue;
    if (column.name.startsWith('_')) continue;

    const value = column.locale
      ? (getPath(data, column.path) as Record<string, unknown> | undefined)?.[column.locale]
      : getPath(data, column.path);

    if (value === undefined || value === null || value === '') continue;

    const conditions = [`${ident(column.name, ctx.engine)} = ?`];
    const bindings: unknown[] = [toUniqueValue(value)];

    if (ignoreId !== undefined) {
      conditions.push(`${ident('id', ctx.engine)} <> ?`);
      bindings.push(ignoreId);
    }

    if (ctx.spec.tenancy.column) {
      conditions.push(tenantCondition(ctx, ctx.spec.tenancy.column));
      if (ctx.tenant !== null) bindings.push(ctx.tenant);
    }

    const existing = await selectOne(
      ctx.client,
      `select ${ident('id', ctx.engine)} as id from ${ident(table.name, ctx.engine)} where ${conditions.join(' and ')} limit 1`,
      bindings,
    );

    if (existing) {
      throw new CmsConflictError(`"${column.path}" must be unique`);
    }
  }
}

/* -------------------------------------------------------------------- where */

export function buildWhere(
  ctx: RepoContext,
  table: TableSpec,
  query: FindQuery,
  constraint: Parameters<typeof constraintToSql>[0] | undefined,
  publishedOnly: boolean | undefined,
  includeDeleted = false,
): { sql: string; bindings: unknown[] } {
  const parts: { sql: string; bindings: unknown[] }[] = [];

  if (!includeDeleted && table.columns.some((column) => column.name === '_deleted_at')) {
    parts.push({ sql: `${ident('_deleted_at', ctx.engine)} is null`, bindings: [] });
  }

  if (ctx.spec.tenancy.column) {
    parts.push({
      sql: tenantCondition(ctx, ctx.spec.tenancy.column),
      bindings: ctx.tenant === null ? [] : [ctx.tenant],
    });
  }

  if (constraint) {
    parts.push(constraintToSql(constraint, ctx.spec, ctx.engine, table.name));
  }

  if (query.where) {
    for (const [field, value] of Object.entries(query.where)) {
      if (field === 'and' || field === 'or') {
        parts.push(combineGroup(ctx, table, field, value));
        continue;
      }
      parts.push(fieldCondition(ctx, table, field, value));
    }
  }

  if (publishedOnly) {
    parts.push({ sql: `${ident('_status', ctx.engine)} = ?`, bindings: ['published'] });
  }

  if (parts.length === 0) return { sql: '', bindings: [] };
  return {
    sql: ` where ${parts.map((part) => `(${part.sql})`).join(' and ')}`,
    bindings: parts.flatMap((part) => part.bindings),
  };
}

function combineGroup(
  ctx: RepoContext,
  table: TableSpec,
  field: 'and' | 'or',
  value: unknown,
): { sql: string; bindings: unknown[] } {
  if (!Array.isArray(value)) return { sql: '1 = 1', bindings: [] };

  const parts = value.map((item) => {
    const object = item as Record<string, unknown>;
    const conditions = Object.entries(object).map(([key, nested]) =>
      fieldCondition(ctx, table, key, nested),
    );
    return {
      sql: conditions.map((part) => `(${part.sql})`).join(' and '),
      bindings: conditions.flatMap((part) => part.bindings),
    };
  });

  if (parts.length === 0) return { sql: field === 'and' ? '1 = 1' : '1 = 0', bindings: [] };
  return {
    sql: parts.map((part) => `(${part.sql})`).join(` ${field} `),
    bindings: parts.flatMap((part) => part.bindings),
  };
}

function fieldCondition(
  ctx: RepoContext,
  table: TableSpec,
  field: string,
  value: unknown,
): { sql: string; bindings: unknown[] } {
  const entry = resolveEntry(ctx.spec, field, table.name);
  if (!entry) return { sql: '1 = 0', bindings: [] };

  const conditions = isOperatorObject(value)
    ? Object.entries(value).map(([operator, operand]) =>
        compileOperator(entry.column, operator, operand),
      )
    : [compileOperator(entry.column, 'equals', value)];

  const active = conditions.filter((item): item is { sql: string; bindings: unknown[] } =>
    Boolean(item),
  );
  if (active.length === 0) return { sql: '1 = 0', bindings: [] };

  return {
    sql: active
      .map((item) => `(${wrapEntry(ctx, table, entry, item.sql, item.bindings).sql})`)
      .join(' and '),
    bindings: active.flatMap((item) => item.bindings),
  };
}

function compileOperator(
  column: string,
  operator: string,
  operand: unknown,
): { sql: string; bindings: unknown[] } | null {
  const quoted = column;

  switch (operator) {
    case 'equals':
      return operand === null
        ? { sql: `${quoted} is null`, bindings: [] }
        : { sql: `${quoted} = ?`, bindings: [operand] };
    case 'not_equals':
      return operand === null
        ? { sql: `${quoted} is not null`, bindings: [] }
        : { sql: `${quoted} <> ?`, bindings: [operand] };
    case 'greater_than':
      return { sql: `${quoted} > ?`, bindings: [operand] };
    case 'greater_than_equal':
      return { sql: `${quoted} >= ?`, bindings: [operand] };
    case 'less_than':
      return { sql: `${quoted} < ?`, bindings: [operand] };
    case 'less_than_equal':
      return { sql: `${quoted} <= ?`, bindings: [operand] };
    case 'in':
    case 'not_in': {
      const list = Array.isArray(operand) ? operand : [operand];
      if (list.length === 0) {
        return { sql: operator === 'in' ? '1 = 0' : '1 = 1', bindings: [] };
      }
      const keyword = operator === 'in' ? 'in' : 'not in';
      return { sql: `${quoted} ${keyword} (${placeholders(list.length)})`, bindings: list };
    }
    case 'like':
      return { sql: `${quoted} like ?`, bindings: [operand] };
    case 'not_like':
      return { sql: `${quoted} not like ?`, bindings: [operand] };
    case 'contains':
      return { sql: `${quoted} like ?`, bindings: [`%${String(operand)}%`] };
    case 'not_contains':
      return { sql: `${quoted} not like ?`, bindings: [`%${String(operand)}%`] };
    case 'icontains':
      return { sql: `lower(${quoted}) like lower(?)`, bindings: [`%${String(operand)}%`] };
    case 'starts_with':
      return { sql: `${quoted} like ?`, bindings: [`${String(operand)}%`] };
    case 'ends_with':
      return { sql: `${quoted} like ?`, bindings: [`%${String(operand)}`] };
    case 'is_null':
      return { sql: `${quoted} is null`, bindings: [] };
    case 'is_not_null':
      return { sql: `${quoted} is not null`, bindings: [] };
    default:
      return null;
  }
}

function wrapEntry(
  ctx: RepoContext,
  table: TableSpec,
  entry: ReturnType<typeof resolveEntry> & {},
  condition: string,
  bindings: unknown[],
): { sql: string; bindings: unknown[] } {
  if (entry.chain.length === 0) return { sql: condition, bindings };
  return { sql: existsSql(entry, ctx.engine, table.name, condition), bindings };
}

function buildSort(ctx: RepoContext, table: TableSpec, sort: string | undefined): string {
  if (!sort) return ` order by ${ident('created_at', ctx.engine)} desc`;

  const parts = sort
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const clauses = parts.map((item) => {
    const descending = item.startsWith('-');
    const field = descending ? item.slice(1) : item;
    const entry = resolveEntry(ctx.spec, field, table.name);
    const column = entry?.column ?? field;
    return `${ident(column, ctx.engine)} ${descending ? 'desc' : 'asc'}`;
  });

  return clauses.length > 0 ? ` order by ${clauses.join(', ')}` : '';
}

function resolveColumnName(ctx: RepoContext, table: TableSpec, field: string): string {
  const entry = resolveEntry(ctx.spec, field, table.name);
  return entry?.column ?? field;
}

/* ------------------------------------------------------------------- access */

/** 401 when there is no principal, 403 when there is one and it is denied. */
function denied(ctx: RepoContext, message: string): CmsError {
  return ctx.user ? new CmsForbiddenError(message) : new CmsUnauthorizedError(message);
}

function assertDraftAccess(
  ctx: RepoContext,
  draftsEnabled: boolean,
  includeDrafts: boolean,
  overrideAccess: boolean | undefined,
): void {
  if (!draftsEnabled || !includeDrafts) return;
  if (overrideAccess) return;
  if (!ctx.user) {
    throw new CmsForbiddenError('drafts can only be read by an authenticated user');
  }
}

function collectionAccess(ctx: RepoContext, slug: string) {
  return (ctx.config.collections ?? []).find((item) => item.slug === slug)?.access;
}

function accessArgs(ctx: RepoContext, extra: { id?: string; data?: Record<string, unknown> } = {}) {
  return {
    req: ctx.req,
    user: ctx.user,
    tenant: ctx.tenant,
    ...(extra.id !== undefined ? { id: extra.id } : {}),
    ...(extra.data !== undefined ? { data: extra.data } : {}),
    locale: ctx.locale,
  };
}

function stripFieldsByAccess(ctx: RepoContext, slug: string, doc: Record<string, unknown>): void {
  const fields = documentFields(ctx.config, slug);
  for (const field of fields) {
    if (!field.access?.read) continue;
    const decision = decideAccess(field.access.read, accessArgs(ctx));
    if (!decision.allowed) delete doc[field.name];
  }
}

/* -------------------------------------------------------------------- hooks */

async function runHooks(
  ctx: RepoContext,
  slug: string,
  phase: 'beforeValidate' | 'beforeChange' | 'afterChange' | 'beforeDelete' | 'afterDelete',
  data: Record<string, unknown>,
  extra: {
    operation: 'create' | 'update' | 'delete';
    doc?: Record<string, unknown>;
    previousData?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const hooks = (ctx.config.collections ?? []).find((item) => item.slug === slug)?.hooks;
  const list = hooks?.[phase as keyof typeof hooks] as
    | readonly ((args: Record<string, unknown>) => unknown)[]
    | undefined;
  if (!list) return data;

  let current = data;
  for (const hook of list) {
    const result = await hook({
      data: current,
      operation: extra.operation,
      req: ctx.req,
      user: ctx.user,
      locale: ctx.locale,
      ...(extra.doc ? { doc: extra.doc } : {}),
      ...(extra.previousData ? { previousData: extra.previousData } : {}),
    });
    if (result && typeof result === 'object') current = result as Record<string, unknown>;
  }
  return current;
}

/* ------------------------------------------------------------------ helpers */

/**
 * PATCH semantics: plain objects merge (so a partial locale map keeps the other locales),
 * arrays and scalars replace.
 */
function mergeDocument(
  previous: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...previous };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    const current = merged[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = mergeDocument(current, value);
      continue;
    }

    merged[key] = value;
  }

  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  );
}

export function tenantCondition(ctx: RepoContext, column: string): string {
  return ctx.tenant === null
    ? `${ident(column, ctx.engine)} is null`
    : `${ident(column, ctx.engine)} = ?`;
}

function getPath(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, data);
}

const OPERATOR_NAMES = new Set([
  'equals',
  'not_equals',
  'greater_than',
  'greater_than_equal',
  'less_than',
  'less_than_equal',
  'in',
  'not_in',
  'like',
  'not_like',
  'contains',
  'not_contains',
  'icontains',
  'starts_with',
  'ends_with',
  'is_null',
  'is_not_null',
]);

function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => OPERATOR_NAMES.has(key))
  );
}

function toUniqueValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function emptyResult(query: FindQuery): FindResult {
  const limit = query.limit ?? 20;
  return {
    docs: [],
    totalDocs: 0,
    limit,
    page: query.page ?? 1,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  };
}
