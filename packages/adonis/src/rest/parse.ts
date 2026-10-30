import type { FindQuery } from '../repository/crud.js';

/**
 * Parses the REST query string into the repository query.
 *
 * The wire format matches `@adonis-agora/filter` (and `filter-client`), so the admin can build
 * these strings with the client package: `where[field][operator]`, `sort`, `limit`, `page`.
 * Both filter-style (`notEquals`, `gt`, `iContains`) and Payload-style (`not_equals`,
 * `greater_than`) operator names are accepted.
 */
export function parseFindQuery(input: Record<string, unknown>): FindQuery {
  const query: FindQuery = {};

  if (input.where && typeof input.where === 'object') {
    query.where = normalizeWhere(input.where as Record<string, unknown>);
  }

  if (typeof input.sort === 'string') query.sort = input.sort;
  if (typeof input.locale === 'string') query.locale = input.locale;

  const limit = toNumber(input.limit);
  if (limit !== undefined) query.limit = limit;

  const page = toNumber(input.page);
  if (page !== undefined) query.page = page;

  const depth = toNumber(input.depth);
  if (depth !== undefined) query.depth = depth;

  if (typeof input.draft === 'boolean') query.draft = input.draft;
  else if (input.draft === 'true' || input.draft === '1') query.draft = true;
  else if (input.draft === 'false' || input.draft === '0') query.draft = false;

  if (typeof input.select === 'string') {
    query.select = input.select
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  } else if (Array.isArray(input.select)) {
    query.select = input.select.map(String);
  }

  return query;
}

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf']);

const OPERATOR_ALIASES: Record<string, string> = {
  equals: 'equals',
  not_equals: 'not_equals',
  notEquals: 'not_equals',
  greater_than: 'greater_than',
  greaterThan: 'greater_than',
  greater_than_equal: 'greater_than_equal',
  greaterThanEqual: 'greater_than_equal',
  gte: 'greater_than_equal',
  gt: 'greater_than',
  less_than: 'less_than',
  lessThan: 'less_than',
  less_than_equal: 'less_than_equal',
  lessThanEqual: 'less_than_equal',
  lte: 'less_than_equal',
  lt: 'less_than',
  like: 'like',
  not_like: 'not_like',
  notLike: 'not_like',
  contains: 'contains',
  not_contains: 'not_contains',
  notContains: 'not_contains',
  i_contains: 'icontains',
  iContains: 'icontains',
  starts_with: 'starts_with',
  startsWith: 'starts_with',
  ends_with: 'ends_with',
  endsWith: 'ends_with',
  in: 'in',
  not_in: 'not_in',
  notIn: 'not_in',
  isAnyOf: 'in',
  is_null: 'is_null',
  isNull: 'is_null',
  is_not_null: 'is_not_null',
  isNotNull: 'is_not_null',
};

/** Array-operand operators accept a comma-separated string from the query string. */
const LIST_OPERATORS = new Set(['in', 'not_in']);

function normalizeWhere(where: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(where)) {
    if (BLOCKED_KEYS.has(key)) continue;

    if (key === 'and' || key === 'or') {
      if (Array.isArray(value)) {
        output[key] = value
          .filter(
            (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
          )
          .map(normalizeWhere);
      }
      continue;
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = normalizeOperators(value as Record<string, unknown>);
      continue;
    }

    output[key] = value;
  }

  return output;
}

function normalizeOperators(operators: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(operators)) {
    if (BLOCKED_KEYS.has(rawKey)) continue;

    const operator = OPERATOR_ALIASES[rawKey];
    if (!operator) continue;

    if (LIST_OPERATORS.has(operator) && typeof value === 'string') {
      output[operator] = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    output[operator] = value;
  }

  return output;
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export { OPERATOR_ALIASES };
