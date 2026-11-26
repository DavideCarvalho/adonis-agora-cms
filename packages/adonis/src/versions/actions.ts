import { resolveVersions } from '../config/types.js';
import {
  CmsConflictError,
  CmsForbiddenError,
  CmsNotFoundError,
  CmsValidationError,
} from '../errors.js';
import { decideAccess } from '../repository/access.js';
import {
  assertUpdateAccess,
  findDocumentByID,
  loadDocument,
  type OperationOptions,
  stripHiddenFields,
  updateDocument,
} from '../repository/crud.js';
import type { RepoContext } from '../repository/document.js';
import { exec, ident, selectOne, sqlTimestamp } from '../repository/sql.js';
import {
  getVersion,
  latestDraftSnapshot,
  latestPublished,
  listVersions,
  recordVersion,
  type VersionRecord,
} from './store.js';

type PublishOptions = OperationOptions & { ttlSeconds?: number };

/** Publishes the current state: `_status = 'published'` plus a published version row. */
export async function publishDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: PublishOptions = {},
): Promise<Record<string, unknown>> {
  return updateDocument(ctx, slug, id, await pendingEdit(ctx, slug, id), {
    ...options,
    status: 'published',
  });
}

/** Back to draft. Published versions stay in the history. */
export async function unpublishDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: PublishOptions = {},
): Promise<Record<string, unknown>> {
  return updateDocument(ctx, slug, id, await pendingEdit(ctx, slug, id), {
    ...options,
    status: 'draft',
  });
}

/**
 * Restores a version by writing its snapshot as a new version.
 *
 * History is never rewritten: the restore itself becomes the next version.
 */
/** What publishing applies: the pending edit, if there is one. */
async function pendingEdit(ctx: RepoContext, slug: string, id: string) {
  const pending = await latestDraftSnapshot(ctx, slug, id);
  return pending ? stripSystemFields(pending) : {};
}

/** Throws the pending edit away: the document goes back to what is live. */
export async function discardDraft(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: OperationOptions = {},
): Promise<Record<string, unknown>> {
  const live = await findDocumentByID(ctx, slug, id, { ...options, draft: false, depth: 0 });
  if (!live) throw new CmsNotFoundError(`"${slug}" ${id} not found`);
  // The version and the update rule see the whole document; the caller gets their own view.
  const full = (await loadDocument(ctx, slug, id, { depth: 0, trusted: true })) ?? live;
  // Throwing an edit away is a write: it takes the collection's `update` rule, like the edit did.
  await assertUpdateAccess(ctx, slug, id, full, 'discard the draft of', options.overrideAccess);
  if (await latestDraftSnapshot(ctx, slug, id)) {
    await recordVersion(ctx, slug, id, {
      status: live._status === 'published' ? 'published' : 'draft',
      snapshot: full,
      autosave: false,
      locale: null,
    });
  }
  return live;
}

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

export type ReadVersionsOptions = {
  locale?: string | null;
  limit?: number;
  page?: number;
  overrideAccess?: boolean;
};

export async function readVersions(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: ReadVersionsOptions = {},
) {
  const { overrideAccess, ...query } = options;
  await assertReadable(ctx, slug, id, overrideAccess, 'history');
  return listVersions(ctx, slug, id, query);
}

export type ReadVersionOptions = {
  overrideAccess?: boolean;
  /** `false` returns the version's details only, under the same rule as {@link readVersions}. */
  snapshot?: boolean;
};

/** One version with its snapshot, trimmed to the fields the caller may read. */
export async function readVersion(
  ctx: RepoContext,
  slug: string,
  id: string,
  version: number,
  options: ReadVersionOptions = {},
) {
  if (options.snapshot === false) {
    await assertReadable(ctx, slug, id, options.overrideAccess, 'history');
    const record = await getVersion(ctx, slug, id, version);
    if (!record) return null;
    const { snapshot: _snapshot, ...summary } = record;
    return summary as VersionRecord;
  }
  await assertReadable(ctx, slug, id, options.overrideAccess, 'snapshot');
  return visibleSnapshot(ctx, slug, await getVersion(ctx, slug, id, version), options);
}

export async function readPublishedVersion(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: { overrideAccess?: boolean } = {},
) {
  await assertReadable(ctx, slug, id, options.overrideAccess, 'snapshot');
  return visibleSnapshot(ctx, slug, await latestPublished(ctx, slug, id), options);
}

/**
 * The history follows the document's `read` rule: whoever cannot read the document gets a 404.
 * The list is open to anyone who can read it (an unpublished draft only to a signed-in reader); a
 * snapshot holds draft content, so it takes the rule for reading a draft (`draft: true`).
 */
async function assertReadable(
  ctx: RepoContext,
  slug: string,
  id: string,
  overrideAccess: boolean | undefined,
  what: 'history' | 'snapshot',
): Promise<void> {
  if (overrideAccess) return;
  const draft = what === 'snapshot' || Boolean(ctx.user);
  const doc = await findDocumentByID(ctx, slug, id, { depth: 0, draft });
  if (!doc) throw new CmsNotFoundError(`"${slug}" ${id} not found`);
}

/** Snapshots are stored whole; the reader's `field.access.read` rules apply on the way out. */
async function visibleSnapshot(
  ctx: RepoContext,
  slug: string,
  record: VersionRecord | null,
  options: { overrideAccess?: boolean },
): Promise<VersionRecord | null> {
  if (!record || options.overrideAccess) return record;
  const snapshot = record.snapshot as { doc?: unknown } | null | undefined;
  const doc = snapshot?.doc;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return record;
  // A snapshot is only shown to a caller who may read drafts, so related drafts may show too.
  const visible = await stripHiddenFields(
    ctx,
    slug,
    structuredClone(doc as Record<string, unknown>),
    {
      relations: { drafts: true },
    },
  );
  return { ...record, snapshot: { ...snapshot, doc: visible } };
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
  ttlSeconds?: number,
  options: { overrideAccess?: boolean } = {},
): Promise<DocumentLock> {
  const ttl = lockTtl(ctx, ttlSeconds);
  // Only someone who may edit the document can claim it, and only a document that exists.
  const doc = await loadDocument(ctx, slug, id, { depth: 0, trusted: true });
  if (!doc) throw new CmsNotFoundError(`"${slug}" ${id} not found`);
  await assertUpdateAccess(ctx, slug, id, doc, 'lock', options.overrideAccess);

  const table = `${ctx.spec.tablePrefix}document_locks`;
  const userId = currentUserId(ctx.user);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 1000);

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

  if (!options.overrideAccess) {
    // A document deleted since keeps its lock until it expires; the owner may still release it.
    const doc = await loadDocument(ctx, slug, id, {
      depth: 0,
      includeDeleted: true,
      trusted: true,
    });
    if (doc) await assertUpdateAccess(ctx, slug, id, doc, 'unlock', false);
  }

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

/** The lock's lifetime: `versions.lockTtl` by default, at most `versions.maxLockTtl`. */
function lockTtl(ctx: RepoContext, requested: number | undefined): number {
  const { lockTtl: fallback, maxLockTtl } = resolveVersions(ctx.config);
  if (requested === undefined) return fallback;
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
    throw new CmsValidationError({ ttlSeconds: 'expected a positive number of seconds' });
  }
  if (requested > maxLockTtl) {
    throw new CmsValidationError({
      ttlSeconds: `at most ${maxLockTtl} seconds; raise \`versions.maxLockTtl\` to allow longer locks`,
    });
  }
  return requested;
}

function currentUserId(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const id = (user as { id?: unknown }).id;
  return id === undefined || id === null ? null : String(id);
}

function stripSystemFields(doc: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...doc };
  for (const key of ['id', 'createdAt', 'updatedAt', '_status', '_hasDraft']) {
    delete clean[key];
  }
  return clean;
}

export { decideAccess };
