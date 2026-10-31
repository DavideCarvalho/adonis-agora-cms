import type { AccessFn, WhereConstraint } from '../config/types.js';
import { CmsConfigError } from '../errors.js';
import type { Engine, QueryPlanEntry, SchemaSpec } from '../schema/types.js';
import type { Binding } from './sql.js';
import { ident } from './sql.js';

export type AccessArgsInternal = {
  req: unknown;
  user: unknown;
  id?: string;
  data?: Record<string, unknown>;
  doc?: Record<string, unknown>;
  locale?: string;
  tenant: string | null;
};

export type AccessDecision = {
  allowed: boolean;
  constraint?: WhereConstraint;
};

/**
 * Evaluates an access function.
 *
 * `overrideAccess` bypasses access checks but **never** tenancy — crossing tenants requires an
 * explicit `allowCrossTenant` on the repository, so a forgotten access function cannot leak
 * another tenant's data. A rule that throws rejects here, so the operation fails rather than opens.
 */
export async function decideAccess(
  fn: AccessFn | undefined,
  args: AccessArgsInternal,
  override = false,
): Promise<AccessDecision> {
  if (override) return { allowed: true };
  if (!fn) return { allowed: true };

  // Awaited: a Promise is truthy, so reading an async rule directly would allow everybody.
  const result = await fn({
    req: args.req,
    user: args.user,
    ...(args.id !== undefined ? { id: args.id } : {}),
    ...(args.data !== undefined ? { data: args.data } : {}),
    ...(args.doc !== undefined ? { doc: args.doc } : {}),
    ...(args.locale !== undefined ? { locale: args.locale } : {}),
  });

  if (typeof result === 'boolean') return { allowed: result };

  if (result && typeof result === 'object') {
    return { allowed: true, constraint: result };
  }

  return { allowed: false };
}

const OPERATORS: Record<string, string> = {
  equals: '=',
  not_equals: '<>',
  greater_than: '>',
  greater_than_equal: '>=',
  less_than: '<',
  less_than_equal: '<=',
  like: 'like',
  not_like: 'not like',
};

const COMMON_ALIASES: Record<string, string> = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  id: 'id',
};

/**
 * Compiles a where-constraint (returned by `read` access) into SQL over the root table.
 *
 * Fields inside arrays/blocks compile to `exists (...)` subqueries, so a scoped read cannot
 * leak a document through a child row.
 */
export function constraintToSql(
  constraint: WhereConstraint,
  spec: SchemaSpec,
  engine: Engine,
  rootTable: string,
): { sql: string; bindings: Binding[] } {
  if ('and' in constraint) {
    const parts = constraint.and.map((item) => constraintToSql(item, spec, engine, rootTable));
    if (parts.length === 0) return { sql: '1 = 1', bindings: [] };
    return {
      sql: parts.map((part) => `(${part.sql})`).join(' and '),
      bindings: parts.flatMap((part) => part.bindings),
    };
  }

  if ('or' in constraint) {
    const parts = constraint.or.map((item) => constraintToSql(item, spec, engine, rootTable));
    if (parts.length === 0) return { sql: '1 = 0', bindings: [] };
    return {
      sql: parts.map((part) => `(${part.sql})`).join(' or '),
      bindings: parts.flatMap((part) => part.bindings),
    };
  }

  const operator = OPERATORS[constraint.operator];
  if (!operator) {
    throw new CmsConfigError(
      'access',
      `unsupported access operator "${constraint.operator}" (expected one of ${Object.keys(OPERATORS).join(', ')})`,
    );
  }

  const entry = resolveEntry(spec, constraint.field, rootTable);
  if (!entry) {
    throw new CmsConfigError('access', `access references unknown field "${constraint.field}"`);
  }

  const column = ident(entry.column, engine);

  if (entry.chain.length === 0) {
    if (constraint.value === null && constraint.operator === 'equals') {
      return { sql: `${column} is null`, bindings: [] };
    }
    return { sql: `${column} ${operator} ?`, bindings: [constraint.value] };
  }

  return {
    sql: `${existsSql(entry, engine, rootTable, `${column} ${operator} ?`)}`,
    bindings: [constraint.value],
  };
}

export function existsSql(
  entry: QueryPlanEntry,
  engine: Engine,
  rootTable: string,
  innerCondition: string,
): string {
  let parent = ident(rootTable, engine);
  let sql = '';

  entry.chain.forEach((table, index) => {
    const alias = `c${index}`;
    sql += `exists (select 1 from ${ident(table, engine)} as ${alias} where ${alias}.${ident(
      '_parent_id',
      engine,
    )} = ${parent}.${ident('id', engine)} and `;
    parent = alias;
  });

  sql += `${innerCondition}`;
  sql += ')'.repeat(entry.chain.length);
  return sql;
}

export function resolveEntry(
  spec: SchemaSpec,
  field: string,
  rootTable: string,
): QueryPlanEntry | undefined {
  const entry = spec.queryPlan[field];
  if (entry) return entry;

  const alias = COMMON_ALIASES[field];
  if (alias) {
    return {
      table: rootTable,
      rootTable,
      chain: [],
      column: alias,
      path: [field],
    };
  }

  return undefined;
}
