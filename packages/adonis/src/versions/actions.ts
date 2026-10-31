import { CmsConflictError, CmsForbiddenError, CmsNotFoundError } from '../errors.js';
import { decideAccess } from '../repository/access.js';
import { type OperationOptions, updateDocument } from '../repository/crud.js';
import type { RepoContext } from '../repository/document.js';
import { exec, ident, selectOne, sqlTimestamp } from '../repository/sql.js';
import { getVersion, latestPublished, listVersions } from './store.js';

type PublishOptions = OperationOptions & { ttlSeconds?: number };

/** Publishes the current state: `_status = 'published'` plus a published version row. */
export async function publishDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: PublishOptions = {},
): Promise<Record<string, unknown>> {
  return updateDocument(ctx, slug, id, {}, { ...options, status: 'published' });
}

/** Back to draft. Published versions stay in the history. */
export async function unpublishDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: PublishOptions = {},
): Promise<Record<string, unknown>> {
  return updateDocument(ctx, slug, id, {}, { ...options, status: 'draft' });
}

/**
 * Restores a version by writing its snapshot as a new version.
 *
 * History is never rewritten: the restore itself becomes the next version.
 */
export async function restoreVersion(
  ctx: RepoContext,
  slug: string,
  id: string,
  version: number,
  options: PublishOptions = {},
): Promise<Record<string, unknown>> {
  const record = await getVersion(ctx, slug, id, version);
  if (!record) throw new CmsNotFoundError(`version ${version} of "${slug}" ${id} not found`);

  const snapshot = record.snapshot as { doc?: Record<string, unknown> } | undefined;
  if (!snapshot?.doc) throw new CmsNotFoundError(`version ${version} has no snapshot`);

  const data = stripSystemFields(snapshot.doc);
  return updateDocument(ctx, slug, id, data, {
    ...options,
    replace: true,
    status: record.status === 'published' ? 'published' : 'draft',
  });
}

export async function readVersions(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: { locale?: string | null; limit?: number; page?: number } = {},
) {
  return listVersions(ctx, slug, id, options);
}

export async function readVersion(ctx: RepoContext, slug: string, id: string, version: number) {
  return getVersion(ctx, slug, id, version);
}

export async function readPublishedVersion(ctx: RepoContext, slug: string, id: string) {
  return latestPublished(ctx, slug, id);
}

/* -------------------------------------------------------------------- locks */

export type DocumentLock = {
  userId: string | null;
  expiresAt: Date;
};

/**
 * Advisory lock so two editors do not overwrite each other.
 *
 * Not a database lock: it never blocks a write, it only tells the panel who is editing.
 */
export async function lockDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  ttlSeconds: number,
): Promise<DocumentLock> {
  const table = `${ctx.spec.tablePrefix}document_locks`;
  const userId = currentUserId(ctx.user);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  await exec(
    ctx.client,
    `delete from ${ident(table, ctx.engine)} where ${ident('expires_at', ctx.engine)} < ?`,
    [sqlTimestamp(now, ctx.engine)],
  );

  const existing = await getDocumentLock(ctx, slug, id);

  if (existing && existing.userId !== null && existing.userId !== userId) {
    throw new CmsConflictError(
      `document is locked by ${existing.userId} until ${existing.expiresAt.toISOString()}`,
    );
  }

  if (existing) {
    await exec(
      ctx.client,
      `update ${ident(table, ctx.engine)} set ${ident('expires_at', ctx.engine)} = ?, ${ident('user_id', ctx.engine)} = ? where ${ident('collection', ctx.engine)} = ? and ${ident('document_id', ctx.engine)} = ?`,
      [sqlTimestamp(expiresAt, ctx.engine), userId, slug, id],
    );
    return { userId, expiresAt };
  }

  const columns = ['collection', 'document_id', 'user_id', 'expires_at'];
  const values: unknown[] = [slug, id, userId, sqlTimestamp(expiresAt, ctx.engine)];

  if (ctx.spec.tenancy.column) {
    columns.push(ctx.spec.tenancy.column);
    values.push(ctx.tenant);
  }

  await exec(
    ctx.client,
    `insert into ${ident(table, ctx.engine)} (${columns.map((name) => ident(name, ctx.engine)).join(', ')}) values (${columns.map(() => '?').join(', ')})`,
    values,
  );

  return { userId, expiresAt };
}

export async function unlockDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: { overrideAccess?: boolean } = {},
): Promise<void> {
  const existing = await getDocumentLock(ctx, slug, id);
  if (!existing) return;

  const userId = currentUserId(ctx.user);
  if (!options.overrideAccess && existing.userId !== null && existing.userId !== userId) {
    throw new CmsForbiddenError('the document is locked by another user');
  }

  const conditions = [
    `${ident('collection', ctx.engine)} = ?`,
    `${ident('document_id', ctx.engine)} = ?`,
  ];
  const bindings: unknown[] = [slug, id];

  if (ctx.spec.tenancy.column) {
    const column = ident(ctx.spec.tenancy.column, ctx.engine);
    conditions.push(ctx.tenant === null ? `${column} is null` : `${column} = ?`);
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  await exec(
    ctx.client,
    `delete from ${ident(`${ctx.spec.tablePrefix}document_locks`, ctx.engine)} where ${conditions.join(' and ')}`,
    bindings,
  );
}

export async function getDocumentLock(
  ctx: RepoContext,
  slug: string,
  id: string,
): Promise<DocumentLock | null> {
  const conditions = [
    `${ident('collection', ctx.engine)} = ?`,
    `${ident('document_id', ctx.engine)} = ?`,
  ];
  const bindings: unknown[] = [slug, id];

  if (ctx.spec.tenancy.column) {
    const column = ident(ctx.spec.tenancy.column, ctx.engine);
    conditions.push(ctx.tenant === null ? `${column} is null` : `${column} = ?`);
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  const row = await selectOne(
    ctx.client,
    `select ${ident('user_id', ctx.engine)}, ${ident('expires_at', ctx.engine)} from ${ident(`${ctx.spec.tablePrefix}document_locks`, ctx.engine)} where ${conditions.join(' and ')}`,
    bindings,
  );

  if (!row) return null;
  return {
    userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    expiresAt: new Date(String(row.expires_at)),
  };
}

/* ------------------------------------------------------------------ helpers */

function currentUserId(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const id = (user as { id?: unknown }).id;
  return id === undefined || id === null ? null : String(id);
}

function stripSystemFields(doc: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...doc };
  for (const key of ['id', 'createdAt', 'updatedAt', '_status']) {
    delete clean[key];
  }
  return clean;
}

export { decideAccess };
