import { InvalidColumnFilterError } from '@adonis-agora/filter';
import { hashPassword, verifyPassword } from '../auth/builtin.js';
import type { AccessFn, FieldConfig } from '../config/types.js';
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
import { latestDraftSnapshot, recordVersion } from '../versions/store.js';
import { constraintToSql, decideAccess, existsSql, resolveEntry } from './access.js';
import {
  BLOCKED_KEYS,
  buildWriteRows,
  type DocumentOptions,
  documentFields,
  documentTable,
  loadChildTree,
  passwordFields,
  type RelationReadOptions,
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
  sqlTimestamp,
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
  /** Skips post-commit events, so webhooks and listeners do not see this write. */
  silent?: boolean;
  /** On a published document: keep the edit as a pending version, leaving what is live untouched. */
  asDraft?: boolean;
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
  const access = await decideAccess(
    collectionAccess(ctx, slug)?.create,
    accessArgs(ctx),
    options.overrideAccess,
  );
  if (!access.allowed) throw denied(ctx, `create "${slug}" is not allowed`);

  let payload = await dropDeniedFields(ctx, slug, { ...data }, options);
  payload = await runHooks(ctx, slug, 'beforeValidate', payload, { operation: 'create' });
  payload = await runHooks(ctx, slug, 'beforeChange', payload, { operation: 'create' });

  const validated = await validate(ctx, slug, payload);
  await hashPasswords(validated, passwordFields(documentFields(ctx.config, slug)));
  await assertUnique(ctx, table, validated, undefined);

  const status = options.status ?? (options.draft === true ? 'draft' : 'published');
  const rows = buildWriteRows(ctx, slug, validated, { status, isNew: true });

  if (ctx.spec.tenancy.column && ctx.spec.tenancy.required && !ctx.tenant) {
    throw new CmsForbiddenError('a tenant is required to create documents');
  }

  const id = await transaction(ctx.client, ctx.engine, async (trx) => {
    const trxContext: RepoContext = { ...ctx, client: trx };
    const insertedId = await insertRows(trxContext, rows);
    // Hooks and the version see the whole document; the caller's view is trimmed on the way out.
    const doc = await loadDocument(trxContext, slug, insertedId, {
      depth: options.depth ?? 1,
      locale: options.locale,
      trusted: true,
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

  // The creator sees what they wrote, but related documents keep their own rules.
  const doc = await readDocumentByID(
    ctx,
    slug,
    id,
    { ...options, overrideAccess: true },
    options.overrideAccess,
  );

  publishSideEffects(ctx, slug, 'create', id, doc ?? { id }, startedAt, options.silent);

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
  const access = await decideAccess(
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

  // A filter or sort on a field the caller cannot read would reveal its value by elimination.
  const hidden = options.overrideAccess ? new Set<string>() : await hiddenFields(ctx, slug);
  const where = buildWhere(
    ctx,
    table,
    query,
    access.constraint,
    versions.drafts && !includeDrafts,
    query.deleted === true,
    hidden,
  );
  const totalDocs = await countRows(ctx.client, table.name, where, ctx.engine);

  const columns =
    query.select && query.select.length > 0
      ? ['id', ...query.select.map((name) => resolveColumnName(ctx, table, name))]
      : ['*'];

  const sort = buildSort(ctx, table, query.sort, hidden);
  const rows = await selectRows(
    ctx.client,
    `select ${columns.map((column) => (column === '*' ? '*' : ident(column, ctx.engine))).join(', ')} from ${ident(table.name, ctx.engine)}${where.sql}${sort} limit ? offset ?`,
    [...where.bindings, limit, (page - 1) * limit],
  );

  const docs = await decorateMany(ctx, slug, rows, {
    depth: query.depth ?? options.depth ?? 1,
    locale,
    relations: relationReads(ctx, includeDrafts, options.overrideAccess),
  });

  if (versions.drafts && includeDrafts) await overlayPendingDrafts(ctx, slug, docs);

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
  return readDocumentByID(ctx, slug, id, options, options.overrideAccess);
}

/** `relationsOverride`: whether related documents skip their own `read` rule too. */
async function readDocumentByID(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: OperationOptions,
  relationsOverride: boolean | undefined,
): Promise<Record<string, unknown> | null> {
  const table = documentTable(ctx.spec, slug);
  const versions = versionsFor(ctx.config, slug);
  const includeDrafts = options.draft === true;
  assertDraftAccess(ctx, versions.drafts, includeDrafts, options.overrideAccess);

  // Loaded before the access decision so `read` can see it (Payload's `doc`), and whole: a rule
  // must decide on the document, not on what the caller's field rules would show of it.
  const doc = await loadDocument(ctx, slug, id, {
    depth: options.depth ?? 1,
    locale: options.locale,
    select: options.select,
    relations: relationReads(ctx, includeDrafts, relationsOverride),
    keepHiddenFields: true,
  });

  if (!doc) return null;

  const access = await decideAccess(
    collectionAccess(ctx, slug)?.read,
    accessArgs(ctx, { id, doc }),
    options.overrideAccess,
  );
  if (!access.allowed) return null;

  // Decided: from here on the document is the caller's view of it.
  for (const name of await hiddenFields(ctx, slug)) delete doc[name];

  if (versions.drafts && !includeDrafts && !options.overrideAccess && doc._status !== 'published') {
    return null;
  }
  if (versions.drafts && includeDrafts) await overlayPendingDrafts(ctx, slug, [doc]);

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
  // The whole document: the merge base, `previousData` for hooks and `doc` for the update rule.
  const previous = await loadDocument(ctx, slug, id, { depth: 0, trusted: true });
  if (!previous) throw new CmsNotFoundError(`"${slug}" ${id} not found`);

  const access = await decideAccess(
    collectionAccess(ctx, slug)?.update,
    accessArgs(ctx, { id, data, doc: previous }),
    options.overrideAccess,
  );
  if (!access.allowed) throw denied(ctx, `update "${slug}" is not allowed`);

  let payload = await dropDeniedFields(ctx, slug, { ...data }, options, previous);
  payload = await runHooks(ctx, slug, 'beforeValidate', payload, {
    operation: 'update',
    previousData: previous,
  });
  payload = await runHooks(ctx, slug, 'beforeChange', payload, {
    operation: 'update',
    previousData: previous,
  });

  // An autosave is a draft by nature: it must never change what a published document shows.
  const keepLive =
    previous._status === 'published' &&
    versionsFor(ctx.config, slug).drafts &&
    options.status === undefined &&
    (options.asDraft === true || options.autosave === true);
  const pending = keepLive ? await latestDraftSnapshot(ctx, slug, id) : null;
  const base = pending ? { ...previous, ...pending } : previous;

  const merged = options.replace === true ? payload : mergeDocument(base, payload);
  // Reads never carry the hash, so what was not sent comes from the row, and only what was is hashed.
  const passwords = passwordFields(documentFields(ctx.config, slug));
  const changed = passwords.filter((name) => isNewPassword(payload[name]));
  if (passwords.length > changed.length) {
    const row = await selectStored(ctx, table, id);
    for (const name of passwords) {
      if (changed.includes(name)) continue;
      const stored = row?.[resolveColumnName(ctx, table, name)];
      if (stored) merged[name] = stored;
      else delete merged[name];
    }
  }
  const validated = await validate(ctx, slug, merged);
  await hashPasswords(validated, changed);
  await assertUnique(ctx, table, validated, id);

  if (keepLive) {
    await recordVersion(ctx, slug, id, {
      status: 'draft',
      snapshot: withoutKeys(validated, passwords),
      autosave: options.autosave === true,
      locale: options.locale ?? null,
    });
    const overlaid = {
      ...previous,
      ...withoutKeys(validated, passwords),
      id,
      _status: 'published',
      _hasDraft: true,
    };
    return stripHiddenFields(ctx, slug, overlaid);
  }

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
      trusted: true,
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

  const doc = await readDocumentByID(
    ctx,
    slug,
    id,
    { ...options, overrideAccess: true },
    options.overrideAccess,
  );
  publishSideEffects(ctx, slug, 'update', id, doc ?? { id }, startedAt, options.silent);
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
  // The whole document, for the delete rule and the delete hooks.
  const doc = await loadDocument(ctx, slug, id, { depth: 0, trusted: true });
  if (!doc) throw new CmsNotFoundError(`"${slug}" ${id} not found`);

  const access = await decideAccess(
    collectionAccess(ctx, slug)?.delete,
    accessArgs(ctx, { id, doc }),
    options.overrideAccess,
  );
  if (!access.allowed) throw denied(ctx, `delete "${slug}" is not allowed`);

  await runHooks(ctx, slug, 'beforeDelete', doc, { operation: 'delete', id, doc });

  const soft = table.columns.some((column) => column.name === '_deleted_at');

  if (soft && options.force !== true) {
    await exec(
      ctx.client,
      `update ${ident(table.name, ctx.engine)} set ${ident('_deleted_at', ctx.engine)} = ? where ${ident('id', ctx.engine)} = ?`,
      [sqlTimestamp(new Date(), ctx.engine), id],
    );
    await runHooks(ctx, slug, 'afterDelete', doc, { operation: 'delete', id, doc });
    publishSideEffects(ctx, slug, 'delete', id, undefined, startedAt, options.silent);
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

  await runHooks(ctx, slug, 'afterDelete', doc, { operation: 'delete', id, doc });
  publishSideEffects(ctx, slug, 'delete', id, undefined, startedAt, options.silent);
}

/** Emits observation + post-commit event. Never inside the transaction. */
function publishSideEffects(
  ctx: RepoContext,
  slug: string,
  operation: 'create' | 'update' | 'delete',
  documentId: string,
  doc: Record<string, unknown> | undefined,
  startedAt: number,
  silent = false,
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

  if (silent) return;

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

  // The update rule decides on the whole (deleted) document, like it does for an edit.
  const whole = await loadDocument(ctx, slug, id, {
    depth: 0,
    includeDeleted: true,
    trusted: true,
  });
  if (!whole) throw new CmsNotFoundError(`"${slug}" ${id} not found`);
  const access = await decideAccess(
    collectionAccess(ctx, slug)?.update,
    accessArgs(ctx, { id, doc: whole }),
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
    await populateNestedRelations(ctx, table, docs, options);
  }

  if ((options.depth ?? 1) > 0) await populateJoins(ctx, slug, docs);

  if (docs.length > 0 && !options.trusted && !options.keepHiddenFields) {
    const hidden = await hiddenFields(ctx, slug);
    for (const doc of docs) for (const name of hidden) delete doc[name];
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

  await populateUploads(ctx, table, docs, options);

  for (const column of relationColumns) {
    const field = column.path ?? '';
    const targetSlug = ctx.spec.tables.find((item) => item.name === column.references?.table)?.slug;
    if (!targetSlug) continue;

    const targetTable = documentTable(ctx.spec, targetSlug);
    const ids = [
      ...new Set(docs.map((doc) => getRelationId(doc, field)).filter(Boolean)),
    ] as string[];
    if (ids.length === 0) continue;

    const rows = await readableRelationRows(ctx, targetSlug, ids, '*', relationReadsFor(options));
    const hidden = options.trusted ? new Set<string>() : await hiddenFields(ctx, targetSlug);

    const byId = new Map(rows.map((row) => [String(row.id), row]));
    for (const doc of docs) {
      const id = getRelationId(doc, field);
      if (!id) continue;
      const targetRow = byId.get(id);
      // Missing, or not readable by the caller: the id stays, as for a deleted document.
      if (!targetRow) continue;
      const target = rowToDocument(ctx, targetTable, targetRow, new Map(), {
        depth: 0,
        locale: options.locale,
      });
      for (const name of hidden) delete target[name];
      setByPath(doc, field, target);
    }
  }
}

/**
 * Relations declared inside arrays and blocks.
 *
 * Those rows live in child tables, so `populateRelations` (which walks the root table columns) never
 * sees them. The column path already says where the value sits (`layout.acao`), so this walks the
 * document along that path — through arrays — and swaps each id for the stored document.
 */
async function populateNestedRelations(
  ctx: RepoContext,
  table: TableSpec,
  docs: Record<string, unknown>[],
  options: DocumentOptions,
): Promise<void> {
  const children = ctx.spec.tables.filter(
    (item) => item.kind === 'child' && item.rootTable === table.name,
  );

  for (const child of children) {
    for (const column of child.columns) {
      if (!column.references || !column.path || column.locale) continue;

      const segments = column.path.split('.');
      const holders = collectRelationHolders(docs, segments);
      if (holders.length === 0) continue;

      const field = segments.at(-1) as string;
      const targetSlug = ctx.spec.tables.find(
        (item) => item.name === column.references?.table,
      )?.slug;
      if (!targetSlug) continue;

      const ids = [
        ...new Set(
          holders
            .map((holder) => toRelationId(holder[field]))
            .filter((value): value is string => typeof value === 'string'),
        ),
      ];
      if (ids.length === 0) continue;

      const targetTable = documentTable(ctx.spec, targetSlug);
      const rows = await readableRelationRows(ctx, targetSlug, ids, '*', relationReadsFor(options));
      const hidden = options.trusted ? new Set<string>() : await hiddenFields(ctx, targetSlug);
      const byId = new Map(rows.map((row) => [String(row.id), row]));

      for (const holder of holders) {
        const id = toRelationId(holder[field]);
        const targetRow = id ? byId.get(id) : undefined;
        if (!targetRow) continue;
        const target = rowToDocument(ctx, targetTable, targetRow, new Map(), {
          depth: 0,
          locale: options.locale,
        });
        for (const name of hidden) delete target[name];
        holder[field] = target;
      }
    }
  }
}

/** A trusted load sees every related document of its tenant; any other follows `relations`. */
function relationReadsFor(options: DocumentOptions): RelationReadOptions | undefined {
  return options.trusted ? { overrideAccess: true, drafts: true } : options.relations;
}

/** Related reads for a request: drafts only for a signed-in caller who asked for them. */
function relationReads(
  ctx: RepoContext,
  includeDrafts: boolean,
  overrideAccess: boolean | undefined,
): RelationReadOptions {
  return {
    overrideAccess: overrideAccess === true,
    drafts: includeDrafts && (overrideAccess === true || Boolean(ctx.user)),
  };
}

/**
 * The rows among `ids` of `targetSlug` the caller may read, in one query: the related collection's
 * `read` rule (a `where` it returns joins the query), its drafts, soft deletes and the tenant.
 * `overrideAccess` skips the rule and the drafts filter, never the tenant.
 */
async function readableRelationRows(
  ctx: RepoContext,
  targetSlug: string,
  ids: readonly string[],
  columns: '*' | 'id',
  relations: RelationReadOptions = {},
): Promise<Row[]> {
  if (ids.length === 0) return [];
  const table = documentTable(ctx.spec, targetSlug);
  const conditions = [`${ident('id', ctx.engine)} in (${placeholders(ids.length)})`];
  const bindings: unknown[] = [...ids];

  const tenancy = ctx.spec.tenancy.column;
  if (tenancy && table.columns.some((column) => column.name === tenancy)) {
    conditions.push(tenantCondition(ctx, tenancy));
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }
  if (table.columns.some((column) => column.name === '_deleted_at')) {
    conditions.push(`${ident('_deleted_at', ctx.engine)} is null`);
  }

  if (!relations.overrideAccess) {
    const access = await decideAccess(collectionAccess(ctx, targetSlug)?.read, accessArgs(ctx));
    if (!access.allowed) return [];
    if (access.constraint) {
      const constraint = constraintToSql(access.constraint, ctx.spec, ctx.engine, table.name);
      conditions.push(`(${constraint.sql})`);
      bindings.push(...constraint.bindings);
    }
    if (versionsFor(ctx.config, targetSlug).drafts && !relations.drafts) {
      conditions.push(`${ident('_status', ctx.engine)} = ?`);
      bindings.push('published');
    }
  }

  return selectRows(
    ctx.client,
    `select ${columns === '*' ? '*' : ident('id', ctx.engine)} from ${ident(table.name, ctx.engine)} where ${conditions.join(' and ')}`,
    bindings,
  );
}

/**
 * Related documents stored inside a document read some other way than a fresh load (a version
 * snapshot, a pending draft) were populated for whoever wrote them. This applies the reader's rules
 * again: one query per related collection, a document they cannot read goes back to its id, and
 * the fields they cannot see are removed.
 */
async function secureStoredRelations(
  ctx: RepoContext,
  slug: string,
  doc: Record<string, unknown>,
  relations: RelationReadOptions,
): Promise<void> {
  const root = documentTable(ctx.spec, slug);
  const tables = [
    root,
    ...ctx.spec.tables.filter((item) => item.kind === 'child' && item.rootTable === root.name),
  ];
  const slots = new Map<
    string,
    { holder: Record<string, unknown>; key: string; upload?: boolean }[]
  >();

  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.references || !column.path || column.locale) continue;
      const targetSlug = ctx.spec.tables.find(
        (item) => item.name === column.references?.table,
      )?.slug;
      if (!targetSlug) continue;
      const segments = column.path.split('.');
      const key = segments.at(-1) as string;
      for (const holder of collectRelationHolders([doc], segments)) {
        const value = holder[key];
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const list = slots.get(targetSlug) ?? [];
        list.push({ holder, key });
        slots.set(targetSlug, list);
      }
    }
  }

  // Resolved uploads into a collection of this CMS follow that collection's `read` rule too.
  for (const field of documentFields(ctx.config, slug)) {
    if (field.type !== 'upload' || !isCollection(ctx, field.relationTo)) continue;
    const value = doc[field.name];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const list = slots.get(field.relationTo) ?? [];
    list.push({ holder: doc, key: field.name, upload: true });
    slots.set(field.relationTo, list);
  }

  for (const [targetSlug, list] of slots) {
    const ids = [
      ...new Set(
        list
          .map(({ holder, key }) => toRelationId(holder[key]))
          .filter((value): value is string => typeof value === 'string'),
      ),
    ];
    const readable = new Set(
      (await readableRelationRows(ctx, targetSlug, ids, 'id', relations)).map((row) =>
        String(row.id),
      ),
    );
    const hidden = await hiddenFields(ctx, targetSlug);
    const passwords = passwordFields(documentFields(ctx.config, targetSlug));
    for (const { holder, key, upload } of list) {
      const target = holder[key] as Record<string, unknown>;
      const id = toRelationId(target);
      if (!id || !readable.has(id)) {
        // The shapes a missing one has: a bare id for a relation, `{ id }` for an upload.
        holder[key] = id === undefined ? null : upload ? { id } : id;
        continue;
      }
      if (upload) continue;
      const visible = { ...target };
      for (const name of [...hidden, ...passwords]) delete visible[name];
      holder[key] = visible;
    }
  }
}

/** Every object that holds the last segment of `segments`, walking arrays on the way. */
function collectRelationHolders(
  docs: Record<string, unknown>[],
  segments: readonly string[],
): Record<string, unknown>[] {
  const last = segments.at(-1);
  if (!last) return [];

  const holders: Record<string, unknown>[] = [];

  const walk = (value: unknown, depth: number) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth);
      return;
    }
    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, unknown>;
    if (depth === segments.length - 1) {
      if (last in record) holders.push(record);
      return;
    }

    const segment = segments[depth] as string;
    if (segment in record) walk(record[segment], depth + 1);
  };

  for (const doc of docs) walk(doc, 0);
  return holders;
}

function toRelationId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

/**
 * `upload` fields, resolved by the media adapter. When `relationTo` is a collection of this CMS,
 * that collection's rules decide first, like for a relation (one query per field): an upload the
 * caller cannot read is never resolved and comes back as `{ id }`, the shape of a missing one. An
 * external library gets the caller (`user`, `tenant`) to apply its own rules.
 */
async function populateUploads(
  ctx: RepoContext,
  table: TableSpec,
  docs: Record<string, unknown>[],
  options: DocumentOptions = {},
): Promise<void> {
  if (!ctx.media) return;

  const uploadFields = documentFields(ctx.config, table.slug).filter(
    (field) => field.type === 'upload',
  );

  for (const field of uploadFields) {
    if (field.type !== 'upload') continue;
    const ids = [
      ...new Set(
        docs
          .map((doc) => doc[field.name])
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
      ),
    ];
    if (ids.length === 0) continue;

    const readable = isCollection(ctx, field.relationTo)
      ? new Set(
          (
            await readableRelationRows(ctx, field.relationTo, ids, 'id', relationReadsFor(options))
          ).map((row) => String(row.id)),
        )
      : null;
    const allowed = readable ? ids.filter((id) => readable.has(id)) : ids;

    const resolved =
      allowed.length > 0
        ? await ctx.media.resolveMany(allowed, { user: ctx.user, tenant: ctx.tenant })
        : new Map();
    for (const doc of docs) {
      const id = doc[field.name];
      if (typeof id !== 'string') continue;
      doc[field.name] = resolved.get(id) ?? { id };
    }
  }
}

function isCollection(ctx: RepoContext, slug: string): boolean {
  return ctx.spec.tables.some((table) => table.kind === 'collection' && table.slug === slug);
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

function isNewPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

async function hashPasswords(data: Record<string, unknown>, names: readonly string[]) {
  for (const name of names) {
    const value = data[name];
    if (isNewPassword(value)) data[name] = await hashPassword(value);
    else delete data[name];
  }
}

function withoutKeys(data: Record<string, unknown>, names: readonly string[]) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !names.includes(key)));
}

async function selectStored(ctx: RepoContext, table: TableSpec, id: string) {
  const where = buildWhere(ctx, table, {}, undefined, false);
  const idColumn = `${ident('id', ctx.engine)} = ?`;
  return selectOne(
    ctx.client,
    `select * from ${ident(table.name, ctx.engine)}${where.sql ? `${where.sql} and ${idColumn}` : ` where ${idColumn}`}`,
    [...where.bindings, id],
  );
}

/** Checks a `fields.password` value. A missing document, or a field that is no password, is `false`. */
export async function checkDocumentPassword(
  ctx: RepoContext,
  slug: string,
  id: string,
  field: string,
  password: string,
): Promise<boolean> {
  if (!passwordFields(documentFields(ctx.config, slug)).includes(field)) return false;
  const table = documentTable(ctx.spec, slug);
  const stored = (await selectStored(ctx, table, id))?.[resolveColumnName(ctx, table, field)];
  return typeof stored === 'string' && verifyPassword(password, stored);
}

async function validate(
  ctx: RepoContext,
  slug: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = documentFields(ctx.config, slug);
  const localization = resolveLocalization(ctx.config);
  const result = await validateDocument(fields, data, {
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
  /** Fields the caller may not read (`field.access.read`): filtering on them is refused. */
  hidden: ReadonlySet<string> = new Set(),
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
      parts.push(whereCondition(ctx, table, field, value, hidden));
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

/** One `where` entry: an `and`/`or` group, the workflow status, or a field condition. */
function whereCondition(
  ctx: RepoContext,
  table: TableSpec,
  field: string,
  value: unknown,
  hidden: ReadonlySet<string>,
): { sql: string; bindings: unknown[] } {
  if (field === 'and' || field === 'or') return combineGroup(ctx, table, field, value, hidden);
  // The workflow column is not a config field, but the panel filters its list by it.
  if (field === '_status') {
    const status = isOperatorObject(value) ? (value as { equals?: unknown }).equals : value;
    return { sql: `${ident('_status', ctx.engine)} = ?`, bindings: [String(status)] };
  }
  return fieldCondition(ctx, table, field, value, hidden);
}

function combineGroup(
  ctx: RepoContext,
  table: TableSpec,
  field: 'and' | 'or',
  value: unknown,
  hidden: ReadonlySet<string>,
): { sql: string; bindings: unknown[] } {
  if (!Array.isArray(value)) return { sql: '1 = 1', bindings: [] };

  const parts = value.map((item) => {
    const object = item as Record<string, unknown>;
    const conditions = Object.entries(object).map(([key, nested]) =>
      whereCondition(ctx, table, key, nested, hidden),
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
  hidden: ReadonlySet<string>,
): { sql: string; bindings: unknown[] } {
  assertReadable(field, hidden, 'filter');
  const entry = resolveEntry(ctx.spec, field, table.name);
  // A filter on the hash would read it one character at a time.
  if (!entry || passwordFields(documentFields(ctx.config, table.slug)).includes(field)) {
    return { sql: '1 = 0', bindings: [] };
  }

  const conditions = isOperatorObject(value)
    ? Object.entries(value).map(([operator, operand]) =>
        compileOperator(entry.column, operator, operand, ctx.engine),
      )
    : [compileOperator(entry.column, 'equals', value, ctx.engine)];

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

const ACCENTED: readonly (readonly [string, string])[] = [
  ['á', 'a'],
  ['à', 'a'],
  ['ã', 'a'],
  ['â', 'a'],
  ['ä', 'a'],
  ['é', 'e'],
  ['ê', 'e'],
  ['è', 'e'],
  ['ë', 'e'],
  ['í', 'i'],
  ['î', 'i'],
  ['ì', 'i'],
  ['ï', 'i'],
  ['ó', 'o'],
  ['ô', 'o'],
  ['õ', 'o'],
  ['ò', 'o'],
  ['ö', 'o'],
  ['ú', 'u'],
  ['ü', 'u'],
  ['ù', 'u'],
  ['û', 'u'],
  ['ç', 'c'],
  ['ñ', 'n'],
];

/**
 * Searching `inicio` must find `Início`. Nested `replace` is the one form every engine has; SQLite's
 * `lower()` only folds ASCII, so the uppercase accents are replaced too.
 */
function foldAccents(expression: string): string {
  return ACCENTED.flatMap(([from, to]) => [
    [from, to],
    [from.toUpperCase(), to],
  ]).reduce((sql, [from, to]) => `replace(${sql}, '${from}', '${to}')`, expression);
}

function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compileOperator(
  column: string,
  operator: string,
  operand: unknown,
  engine: RepoContext['engine'],
): { sql: string; bindings: unknown[] } | null {
  // A field called `from` or `order` is a reserved word in SQL.
  const quoted = ident(column, engine);

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
      return {
        sql: `${foldAccents(`lower(${quoted})`)} like ?`,
        bindings: [`%${foldText(String(operand))}%`],
      };
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

/** Raw columns a sort may name besides the document's fields (the panel sorts by `_status`). */
const SYSTEM_SORT_COLUMNS = ['_status', 'created_at', 'updated_at'];

function buildSort(
  ctx: RepoContext,
  table: TableSpec,
  sort: string | undefined,
  hidden: ReadonlySet<string>,
): string {
  if (!sort) return ` order by ${ident('created_at', ctx.engine)} desc`;

  const parts = sort
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const clauses = parts.map((item) => {
    const descending = item.startsWith('-');
    const field = descending ? item.slice(1) : item;
    if (passwordFields(documentFields(ctx.config, table.slug)).includes(field)) {
      throw new CmsValidationError({ [field]: 'cannot sort by a password' });
    }
    assertReadable(field, hidden, 'sort');
    const column = sortColumn(ctx, table, field);
    return `${ident(column, ctx.engine)} ${descending ? 'desc' : 'asc'}`;
  });

  return clauses.length > 0 ? ` order by ${clauses.join(', ')}` : '';
}

/**
 * The root-table column a sort field orders by. Anything else is refused: a name that is not a
 * field would otherwise reach the SQL as a raw column, past every field rule.
 */
function sortColumn(ctx: RepoContext, table: TableSpec, field: string): string {
  const entry = resolveEntry(ctx.spec, field, table.name);
  if (entry && entry.chain.length === 0) return entry.column;
  if (
    SYSTEM_SORT_COLUMNS.includes(field) &&
    table.columns.some((column) => column.name === field)
  ) {
    return field;
  }
  if (entry) {
    throw new InvalidColumnFilterError(
      `Cannot sort "${table.slug}" by "${field}": it lives inside an array or blocks field. Sort by a top-level field.`,
    );
  }
  throw new InvalidColumnFilterError(
    `Cannot sort "${table.slug}" by "${field}": no such field. Sort by one of its fields, \`id\`, \`createdAt\` or \`updatedAt\`.`,
  );
}

/** `field.access.read` covers querying too: a hidden field cannot be filtered or sorted by. */
function assertReadable(field: string, hidden: ReadonlySet<string>, use: 'filter' | 'sort'): void {
  const root = field.split('.')[0] ?? field;
  if (!hidden.has(root)) return;
  throw new InvalidColumnFilterError(
    `Cannot ${use} by "${field}": its \`access.read\` rule hides it from the current user.`,
  );
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

/**
 * The collection's `update` rule, for writes that do not go through {@link updateDocument} (discard
 * a draft, take or release the editing lock). Throws 401/403 like an update would.
 */
export async function assertUpdateAccess(
  ctx: RepoContext,
  slug: string,
  id: string,
  doc: Record<string, unknown>,
  action: string,
  overrideAccess?: boolean,
): Promise<void> {
  const access = await decideAccess(
    collectionAccess(ctx, slug)?.update,
    accessArgs(ctx, { id, doc }),
    overrideAccess,
  );
  if (!access.allowed) throw denied(ctx, `${action} "${slug}" ${id} is not allowed`);
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

function accessArgs(
  ctx: RepoContext,
  extra: {
    id?: string;
    data?: Record<string, unknown>;
    doc?: Record<string, unknown>;
  } = {},
) {
  return {
    req: ctx.req,
    user: ctx.user,
    tenant: ctx.tenant,
    ...(extra.id !== undefined ? { id: extra.id } : {}),
    ...(extra.data !== undefined ? { data: extra.data } : {}),
    ...(extra.doc !== undefined ? { doc: extra.doc } : {}),
    locale: ctx.locale,
  };
}

/**
 * Names of the document's fields the caller may not read, by `field.access.read`. Fields inside a
 * row, collapsible or tabs sit at the top of the document, so they are walked too, and a rule on
 * the structural field covers every field in it.
 */
export async function hiddenFields(ctx: RepoContext, slug: string): Promise<Set<string>> {
  const hidden = new Set<string>();
  const decisions = new Map<AccessFn, boolean>();
  const allowed = async (rule: AccessFn) => {
    let decision = decisions.get(rule);
    if (decision === undefined) {
      decision = (await decideAccess(rule, accessArgs(ctx))).allowed;
      decisions.set(rule, decision);
    }
    return decision;
  };

  const walk = async (fields: readonly FieldConfig[], inherited: readonly AccessFn[]) => {
    for (const field of fields) {
      const rules = field.access?.read ? [...inherited, field.access.read] : inherited;
      if (field.type === 'row' || field.type === 'collapsible') {
        await walk(field.fields, rules);
        continue;
      }
      if (field.type === 'tabs') {
        for (const tab of field.tabs) await walk(tab.fields, rules);
        continue;
      }
      for (const rule of rules) {
        if (!(await allowed(rule))) {
          hidden.add(field.name);
          break;
        }
      }
    }
  };

  await walk(documentFields(ctx.config, slug), []);
  return hidden;
}

/**
 * Removes what the caller may not see from a document read some other way than `find` (a version
 * snapshot, a pending draft): fields hidden by `access.read`, and password hashes.
 */
export async function stripHiddenFields(
  ctx: RepoContext,
  slug: string,
  doc: Record<string, unknown>,
  options: { hidden?: ReadonlySet<string>; relations?: RelationReadOptions } = {},
): Promise<Record<string, unknown>> {
  for (const name of options.hidden ?? (await hiddenFields(ctx, slug))) delete doc[name];
  for (const name of passwordFields(documentFields(ctx.config, slug))) delete doc[name];
  await secureStoredRelations(ctx, slug, doc, options.relations ?? {});
  return doc;
}

/** Top-level `join` fields; each is a normal read, so the other collection's access applies. */
async function populateJoins(
  ctx: RepoContext,
  slug: string,
  docs: Record<string, unknown>[],
): Promise<void> {
  const joins = documentFields(ctx.config, slug).filter((field) => field.type === 'join');
  if (joins.length === 0) return;

  await Promise.all(
    docs.flatMap((doc) =>
      joins.map(async (field) => {
        if (field.type !== 'join') return;
        // The join filters the other collection by its relationship; hidden from the reader, it
        // cannot be filtered on, so the join stays empty rather than failing the whole read.
        if ((await hiddenFields(ctx, field.collection)).has(field.on.split('.')[0] ?? field.on)) {
          doc[field.name] = { docs: [], totalDocs: 0 };
          return;
        }
        const found = await findDocuments(
          ctx,
          field.collection,
          { where: { [field.on]: { equals: doc.id } }, limit: field.limit ?? 10, depth: 0 },
          {},
        );
        doc[field.name] = { docs: found.docs, totalDocs: found.totalDocs };
      }),
    ),
  );
}

/** `field.access.update`: a field the caller may not write keeps its value, whatever was sent. */
async function dropDeniedFields(
  ctx: RepoContext,
  slug: string,
  data: Record<string, unknown>,
  options: OperationOptions,
  doc?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (options.overrideAccess) return data;
  for (const field of documentFields(ctx.config, slug)) {
    if (!field.access?.update || !(field.name in data)) continue;
    const decision = await decideAccess(
      field.access.update,
      accessArgs(ctx, { data, ...(doc ? { doc } : {}) }),
    );
    if (!decision.allowed) delete data[field.name];
  }
  return data;
}

/** Whoever asks for drafts sees a published document with its pending edit on top. */
async function overlayPendingDrafts(
  ctx: RepoContext,
  slug: string,
  docs: Record<string, unknown>[],
): Promise<void> {
  const hidden = await hiddenFields(ctx, slug);
  await Promise.all(
    docs.map(async (doc) => {
      if (doc._status !== 'published') return;
      const pending = await latestDraftSnapshot(ctx, slug, String(doc.id));
      if (!pending) return;
      const { id, createdAt, updatedAt } = doc;
      for (const key of Object.keys(pending)) {
        if (!BLOCKED_KEYS.has(key)) doc[key] = pending[key];
      }
      Object.assign(doc, { id, createdAt, updatedAt, _status: 'published', _hasDraft: true });
      // The pending edit is stored whole, so the reader's field rules apply to it again.
      await stripHiddenFields(ctx, slug, doc, { hidden, relations: { drafts: true } });
    }),
  );
}

/* -------------------------------------------------------------------- hooks */

async function runHooks(
  ctx: RepoContext,
  slug: string,
  phase: 'beforeValidate' | 'beforeChange' | 'afterChange' | 'beforeDelete' | 'afterDelete',
  data: Record<string, unknown>,
  extra: {
    operation: 'create' | 'update' | 'delete';
    /** Delete hooks: `DeleteHookArgs` promises the id and the document. */
    id?: string;
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
      ...(extra.id !== undefined ? { id: extra.id } : {}),
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
    // An own `__proto__` key (plain `JSON.parse` keeps one) would otherwise swap the prototype.
    if (value === undefined || BLOCKED_KEYS.has(key)) continue;

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
