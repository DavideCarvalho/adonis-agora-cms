import { CmsForbiddenError, CmsNotFoundError } from '../errors.js';
import { decideAccess } from '../repository/access.js';
import type { OperationOptions } from '../repository/crud.js';
import { findDocumentByID } from '../repository/crud.js';
import type { RepoContext } from '../repository/document.js';
import { exec, ident, selectOne, selectRows, sqlTimestamp } from '../repository/sql.js';
import { publishDocument, unpublishDocument } from './actions.js';

export type ScheduleAction = 'publish' | 'unpublish';
export type DocumentSchedule = { action: ScheduleAction; at: Date };

const table = (ctx: RepoContext) => `${ctx.spec.tablePrefix}document_schedules`;

function scope(ctx: RepoContext, slug: string, id: string) {
  const conditions = [
    `${ident('collection', ctx.engine)} = ?`,
    `${ident('document_id', ctx.engine)} = ?`,
  ];
  const bindings: (string | number)[] = [slug, id];
  const column = ctx.spec.tenancy.column;

  if (column) {
    conditions.push(
      ctx.tenant === null
        ? `${ident(column, ctx.engine)} is null`
        : `${ident(column, ctx.engine)} = ?`,
    );
    if (ctx.tenant !== null) bindings.push(ctx.tenant);
  }

  return { where: conditions.join(' and '), bindings };
}

/** Whoever may update a document may decide when it goes live. */
function assertCanSchedule(ctx: RepoContext, slug: string, options: OperationOptions): void {
  const collection = ctx.config.collections?.find((item) => item.slug === slug);
  if (!collection) throw new CmsNotFoundError(`collection "${slug}" not found`);
  const access = decideAccess(
    collection.access?.update,
    { req: null, user: ctx.user ?? null, tenant: ctx.tenant },
    options.overrideAccess,
  );
  if (!access.allowed) throw new CmsForbiddenError(`cannot schedule "${slug}"`);
}

/** One pending change per document: scheduling again replaces it. */
export async function scheduleDocument(
  ctx: RepoContext,
  slug: string,
  id: string,
  schedule: DocumentSchedule,
  options: OperationOptions = {},
): Promise<DocumentSchedule> {
  assertCanSchedule(ctx, slug, options);
  const existing = await findDocumentByID(ctx, slug, id, { overrideAccess: true });
  if (!existing) throw new CmsNotFoundError(`"${slug}" ${id} not found`);

  const { where, bindings } = scope(ctx, slug, id);
  await exec(ctx.client, `delete from ${ident(table(ctx), ctx.engine)} where ${where}`, bindings);

  const columns = ['collection', 'document_id', 'action', 'run_at'];
  const values: (string | null)[] = [
    slug,
    id,
    schedule.action,
    sqlTimestamp(schedule.at, ctx.engine),
  ];
  if (ctx.spec.tenancy.column) {
    columns.push(ctx.spec.tenancy.column);
    values.push(ctx.tenant);
  }

  await exec(
    ctx.client,
    `insert into ${ident(table(ctx), ctx.engine)} (${columns.map((name) => ident(name, ctx.engine)).join(', ')}) values (${columns.map(() => '?').join(', ')})`,
    values,
  );
  return schedule;
}

export async function cancelSchedule(
  ctx: RepoContext,
  slug: string,
  id: string,
  options: OperationOptions = {},
): Promise<void> {
  assertCanSchedule(ctx, slug, options);
  const { where, bindings } = scope(ctx, slug, id);
  await exec(ctx.client, `delete from ${ident(table(ctx), ctx.engine)} where ${where}`, bindings);
}

export async function readSchedule(
  ctx: RepoContext,
  slug: string,
  id: string,
): Promise<DocumentSchedule | null> {
  const { where, bindings } = scope(ctx, slug, id);
  const row = await selectOne(
    ctx.client,
    `select ${ident('action', ctx.engine)}, ${ident('run_at', ctx.engine)} from ${ident(table(ctx), ctx.engine)} where ${where}`,
    bindings,
  );
  if (!row) return null;
  return { action: row.action as ScheduleAction, at: new Date(String(row.run_at)) };
}

/**
 * Applies what is due and returns how many ran.
 *
 * The row goes first: a failing document must not retry forever on every tick, and two app
 * instances racing here at worst publish an already published document, which changes nothing.
 */
export async function runDueSchedules(ctx: RepoContext, now = new Date()): Promise<number> {
  const name = ident(table(ctx), ctx.engine);
  const tenant = ctx.spec.tenancy.column;
  const rows = await selectRows(
    ctx.client,
    `select * from ${name} where ${ident('run_at', ctx.engine)} <= ?`,
    [sqlTimestamp(now, ctx.engine)],
  );

  let done = 0;
  for (const row of rows) {
    await exec(ctx.client, `delete from ${name} where ${ident('id', ctx.engine)} = ?`, [
      row.id as number,
    ]);

    const scoped: RepoContext = tenant ? { ...ctx, tenant: (row[tenant] as string) ?? null } : ctx;
    const apply = row.action === 'unpublish' ? unpublishDocument : publishDocument;
    try {
      await apply(scoped, String(row.collection), String(row.document_id), {
        overrideAccess: true,
      });
      done += 1;
    } catch (error) {
      console.error('[cms] scheduled change failed', row.collection, row.document_id, error);
    }
  }
  return done;
}
