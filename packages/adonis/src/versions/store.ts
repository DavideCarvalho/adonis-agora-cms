import type { RepoContext } from '../repository/document.js';
import { documentTable } from '../repository/document.js';
import {
  exec,
  ident,
  placeholders,
  selectOne,
  selectRows,
  sqlTimestamp,
} from '../repository/sql.js';

export type VersionRecord = {
  id: number;
  version: number;
  status: string;
  autosave: boolean;
  locale: string | null;
  createdBy: string | null;
  createdAt: Date;
  isLatest: boolean;
  snapshot?: unknown;
};

export type RecordVersionOptions = {
  status: 'draft' | 'published';
  snapshot: Record<string, unknown>;
  autosave?: boolean;
  locale?: string | null;
};

export type ListVersionsOptions = {
  locale?: string | null;
  limit?: number;
  page?: number;
};

/**
 * Writes a version row and marks it as the latest.
 *
 * Runs inside the caller's transaction so a document and its history are always consistent.
 */
export async function recordVersion(
  ctx: RepoContext,
  slug: string,
  documentId: string,
  options: RecordVersionOptions,
): Promise<number> {
  const table = `${ctx.spec.tablePrefix}versions`;
  const next = (await maxVersion(ctx, slug, documentId)) + 1;
  const now = sqlTimestamp(new Date(), ctx.engine);
  const userId = userIdentifier(ctx.user);

  await exec(
    ctx.client,
    `update ${ident(table, ctx.engine)} set ${ident('is_latest', ctx.engine)} = ${bool(ctx.engine, false)} where ${ident('collection', ctx.engine)} = ? and ${ident('document_id', ctx.engine)} = ?`,
    [slug, documentId],
  );

  const columns = [
    'collection',
    'document_id',
    'locale',
    'version',
    'status',
    'autosave',
    'snapshot',
    'created_by',
    'created_at',
    'is_latest',
  ];
  const values: unknown[] = [
    slug,
    documentId,
    options.locale ?? null,
    next,
    options.status,
    bool(ctx.engine, options.autosave === true),
    JSON.stringify({ doc: options.snapshot, schemaHash: ctx.spec.hash }),
    userId,
    now,
    bool(ctx.engine, true),
  ];

  if (ctx.spec.tenancy.column) {
    columns.push(ctx.spec.tenancy.column);
    values.push(ctx.tenant);
  }

  await exec(
    ctx.client,
    `insert into ${ident(table, ctx.engine)} (${columns.map((name) => ident(name, ctx.engine)).join(', ')}) values (${placeholders(columns.length)})`,
    values,
  );

  await pruneVersions(ctx, slug, documentId);
  return next;
}

export async function listVersions(
  ctx: RepoContext,
  slug: string,
  documentId: string,
  options: ListVersionsOptions = {},
): Promise<{ docs: VersionRecord[]; totalDocs: number }> {
  const table = `${ctx.spec.tablePrefix}versions`;
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const page = Math.max(1, options.page ?? 1);

  const conditions = [
    `${ident('collection', ctx.engine)} = ?`,
    `${ident('document_id', ctx.engine)} = ?`,
  ];
  const bindings: unknown[] = [slug, documentId];

  if (options.locale) {
    conditions.push(`${ident('locale', ctx.engine)} = ?`);
    bindings.push(options.locale);
  }

  if (ctx.spec.tenancy.column) {
    conditions.push(tenantFragment(ctx));
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  const where = conditions.join(' and ');
  const total = await selectOne(
    ctx.client,
    `select count(*) as total from ${ident(table, ctx.engine)} where ${where}`,
    bindings,
  );

  const rows = await selectRows(
    ctx.client,
    `select ${ident('id', ctx.engine)}, ${ident('version', ctx.engine)}, ${ident('status', ctx.engine)}, ${ident('autosave', ctx.engine)}, ${ident('locale', ctx.engine)}, ${ident('created_by', ctx.engine)}, ${ident('created_at', ctx.engine)}, ${ident('is_latest', ctx.engine)} from ${ident(table, ctx.engine)} where ${where} order by ${ident('version', ctx.engine)} desc limit ? offset ?`,
    [...bindings, limit, (page - 1) * limit],
  );

  return {
    docs: rows.map((row) => toVersionRecord(row)),
    totalDocs: Number(total?.total ?? 0),
  };
}

export async function getVersion(
  ctx: RepoContext,
  slug: string,
  documentId: string,
  version: number,
): Promise<VersionRecord | null> {
  const table = `${ctx.spec.tablePrefix}versions`;
  const conditions = [
    `${ident('collection', ctx.engine)} = ?`,
    `${ident('document_id', ctx.engine)} = ?`,
    `${ident('version', ctx.engine)} = ?`,
  ];
  const bindings: unknown[] = [slug, documentId, version];

  if (ctx.spec.tenancy.column) {
    conditions.push(tenantFragment(ctx));
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  const row = await selectOne(
    ctx.client,
    `select * from ${ident(table, ctx.engine)} where ${conditions.join(' and ')}`,
    bindings,
  );

  return row ? toVersionRecord(row, true) : null;
}

export async function latestPublished(
  ctx: RepoContext,
  slug: string,
  documentId: string,
): Promise<VersionRecord | null> {
  const table = `${ctx.spec.tablePrefix}versions`;
  const conditions = [
    `${ident('collection', ctx.engine)} = ?`,
    `${ident('document_id', ctx.engine)} = ?`,
    `${ident('status', ctx.engine)} = ?`,
  ];
  const bindings: unknown[] = [slug, documentId, 'published'];

  if (ctx.spec.tenancy.column) {
    conditions.push(tenantFragment(ctx));
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  const row = await selectOne(
    ctx.client,
    `select * from ${ident(table, ctx.engine)} where ${conditions.join(' and ')} order by ${ident('version', ctx.engine)} desc limit 1`,
    bindings,
  );

  return row ? toVersionRecord(row, true) : null;
}

/**
 * Retention. `null` keeps everything; a number keeps the newest N while always preserving the
 * latest published version and pruning autosave rows first.
 */
export async function pruneVersions(
  ctx: RepoContext,
  slug: string,
  documentId: string,
): Promise<void> {
  const retention = retentionFor(ctx, slug);
  if (retention === null) return;

  const table = `${ctx.spec.tablePrefix}versions`;
  const conditions = [
    `${ident('collection', ctx.engine)} = ?`,
    `${ident('document_id', ctx.engine)} = ?`,
  ];
  const bindings: unknown[] = [slug, documentId];

  if (ctx.spec.tenancy.column) {
    conditions.push(tenantFragment(ctx));
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  const rows = await selectRows(
    ctx.client,
    `select ${ident('id', ctx.engine)}, ${ident('status', ctx.engine)}, ${ident('autosave', ctx.engine)}, ${ident('version', ctx.engine)} from ${ident(table, ctx.engine)} where ${conditions.join(' and ')} order by ${ident('version', ctx.engine)} desc`,
    bindings,
  );

  if (rows.length <= retention) return;

  const published = rows.find((row) => row.status === 'published');
  const keep = new Set<number>();

  for (const row of rows) {
    if (keep.size >= retention) break;
    if (row.status === 'published') keep.add(Number(row.id));
    else if (!row.autosave) keep.add(Number(row.id));
  }
  if (published) keep.add(Number(published.id));

  const remove = rows.map((row) => Number(row.id)).filter((id) => !keep.has(id));
  if (remove.length === 0) return;

  await exec(
    ctx.client,
    `delete from ${ident(table, ctx.engine)} where ${ident('id', ctx.engine)} in (${placeholders(remove.length)})`,
    remove,
  );
}

/** Structural diff between two snapshots, field by field. */
export function diffSnapshots(
  before: unknown,
  after: unknown,
  path = '',
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};

  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let index = 0; index < max; index += 1) {
      Object.assign(
        changes,
        diffSnapshots(before[index], after[index], path ? `${path}[${index}]` : `[${index}]`),
      );
    }
    return changes;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const nested = diffSnapshots(before[key], after[key], path ? `${path}.${key}` : key);
      Object.assign(changes, nested);
    }
    return changes;
  }

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    changes[path] = { before, after };
  }

  return changes;
}

/* ------------------------------------------------------------------ helpers */

function retentionFor(ctx: RepoContext, slug: string): number | null {
  const collection = (ctx.config.collections ?? []).find((item) => item.slug === slug);
  return collection?.versions?.retention ?? ctx.config.versions?.retention ?? null;
}

async function maxVersion(ctx: RepoContext, slug: string, documentId: string): Promise<number> {
  const table = `${ctx.spec.tablePrefix}versions`;
  const conditions = [
    `${ident('collection', ctx.engine)} = ?`,
    `${ident('document_id', ctx.engine)} = ?`,
  ];
  const bindings: unknown[] = [slug, documentId];

  if (ctx.spec.tenancy.column) {
    conditions.push(tenantFragment(ctx));
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  const row = await selectOne(
    ctx.client,
    `select max(${ident('version', ctx.engine)}) as max_version from ${ident(table, ctx.engine)} where ${conditions.join(' and ')}`,
    bindings,
  );

  return Number(row?.max_version ?? 0);
}

function tenantFragment(ctx: RepoContext): string {
  const column = ident(ctx.spec.tenancy.column ?? '_tenant_id', ctx.engine);
  return ctx.tenant === null ? `${column} is null` : `${column} = ?`;
}

function bool(engine: RepoContext['engine'], value: boolean): unknown {
  return engine === 'pg' ? value : value ? 1 : 0;
}

function userIdentifier(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const id = (user as { id?: unknown }).id;
  return id === undefined || id === null ? null : String(id);
}

function toVersionRecord(row: Record<string, unknown>, withSnapshot = false): VersionRecord {
  const record: VersionRecord = {
    id: Number(row.id),
    version: Number(row.version),
    status: String(row.status),
    autosave: row.autosave === true || row.autosave === 1 || row.autosave === '1',
    locale: row.locale === null || row.locale === undefined ? null : String(row.locale),
    createdBy:
      row.created_by === null || row.created_by === undefined ? null : String(row.created_by),
    createdAt: new Date(String(row.created_at)),
    isLatest: row.is_latest === true || row.is_latest === 1 || row.is_latest === '1',
  };

  if (withSnapshot && typeof row.snapshot === 'string') {
    record.snapshot = JSON.parse(row.snapshot);
  } else if (withSnapshot && row.snapshot && typeof row.snapshot === 'object') {
    record.snapshot = row.snapshot;
  }

  return record;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export { documentTable };
