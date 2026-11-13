import {
  type ColumnFilter,
  InvalidColumnFilterError,
  MAX_FILTER_DEPTH,
  normalizeOperator,
  parseFilterRequest,
  parsePageParams,
  resolveSort,
} from '@adonis-agora/filter';
import type { CmsConfig } from '../config/types.js';
import { CmsNotFoundError } from '../errors.js';
import type { FindQuery } from '../repository/crud.js';
import { documentFields, passwordFields } from '../repository/document.js';
import type { SchemaSpec } from '../schema/types.js';
import { parseReadOptions } from './parse.js';

/** Page size when the request sends none, and the largest one it may ask for. */
export const LIST_PAGE_SIZE = { defaultSize: 20, maxSize: 200 } as const;

/** Version history pages: newest first, the only order the store keeps. */
export const VERSIONS_PAGE_SIZE = { defaultSize: 20, maxSize: 100 } as const;

/** Fields every collection can be filtered and sorted by, besides its own. */
const SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt'] as const;

/** Column types an `order by` cannot use on every engine. */
const UNSORTABLE_TYPES = new Set(['json', 'binary']);

/**
 * Wire operator (`@adonis-agora/filter`) → repository operator. Operators missing here are refused
 * with a 400 rather than ignored, so a typo never widens the list.
 */
const OPERATORS: Readonly<Record<string, string>> = {
  equals: 'equals',
  notEquals: 'not_equals',
  gt: 'greater_than',
  gte: 'greater_than_equal',
  lt: 'less_than',
  lte: 'less_than_equal',
  contains: 'contains',
  notContains: 'not_contains',
  iContains: 'icontains',
  startsWith: 'starts_with',
  endsWith: 'ends_with',
  in: 'in',
  isAnyOf: 'in',
  notIn: 'not_in',
  isNull: 'is_null',
  isNotNull: 'is_not_null',
};

const LIST_OPERATORS = new Set(['in', 'not_in']);

export type ListableFields = {
  /** Logical paths a `filter[...]` may target, nested ones included (`layout.type`). */
  filterable: ReadonlySet<string>;
  /** Fields `sort` accepts: the document's own scalar columns plus the system timestamps. */
  sortable: readonly string[];
};

/**
 * What a collection's list endpoint can filter and sort by, read off the compiled schema. Password
 * fields are never listed: a filter on the hash would read it one character at a time.
 */
export function listableFields(spec: SchemaSpec, config: CmsConfig, slug: string): ListableFields {
  const root = spec.tables.find((table) => table.kind === 'collection' && table.slug === slug);
  if (!root) throw new CmsNotFoundError(`unknown collection "${slug}"`);

  const hidden = new Set(passwordFields(documentFields(config, slug)));
  const filterable = new Set<string>(SYSTEM_FIELDS);
  const sortable = new Set<string>(SYSTEM_FIELDS);

  const hasStatus = root.columns.some((column) => column.name === '_status');
  if (hasStatus) {
    filterable.add('_status');
    sortable.add('_status');
  }

  for (const table of spec.tables) {
    const own = table === root;
    if (!own && !(table.kind === 'child' && table.rootTable === root.name)) continue;
    for (const column of table.columns) {
      if (!column.path || column.name.startsWith('_') || hidden.has(column.path)) continue;
      filterable.add(column.path);
      if (own && !UNSORTABLE_TYPES.has(column.type)) sortable.add(column.path);
    }
  }

  return { filterable, sortable: [...sortable] };
}

/**
 * Turns a list request into the repository query.
 *
 * - `filter[field]=v`, `filter[field][op]=v`, `filter[field][]=a&filter[field][]=b`,
 *   `filter[field]=a,b`, and `where[i][OR][j][...]` groups from `filter-client`'s `.or()`.
 * - `sort=-createdAt,title`, checked against the collection's sortable fields.
 * - `page` (1-based) and `size`.
 * - `locale`, `depth`, `draft`, `deleted` and `select` shape the documents, as on a single read.
 *
 * An unknown field, operator or sort field throws `InvalidColumnFilterError`, which the handlers
 * answer with a 400.
 */
export function parseListQuery(
  spec: SchemaSpec,
  config: CmsConfig,
  slug: string,
  qs: Record<string, unknown>,
): FindQuery {
  const fields = listableFields(spec, config, slug);

  if (qs.where !== undefined && !Array.isArray(qs.where)) {
    throw new InvalidColumnFilterError(
      'Filter with `filter[field][operator]=value`; the `where[field]` form is not accepted.',
    );
  }

  const input = parseFilterRequest(qs);
  const query: FindQuery = parseReadOptions(qs);

  const clauses = (input.filters ?? []).map((filter) => toClause(filter, fields, 0));
  if (clauses.length > 0) query.where = { and: clauses };

  const sort = resolveSort(input.sort, { sortable: fields.sortable });
  if (sort.length > 0) {
    query.sort = sort
      .map((item) => (item.direction === 'desc' ? `-${item.field}` : item.field))
      .join(',');
  }

  const { page, size } = parsePageParams(qs, LIST_PAGE_SIZE);
  query.page = page;
  query.limit = size;

  return query;
}

/**
 * Turns a version-history request into the store's options. The history has one order (newest
 * first), so `sort` only accepts `-version`; `filter[locale]` narrows it to one locale.
 */
export function parseVersionsQuery(qs: Record<string, unknown>): {
  locale?: string;
  page: number;
  limit: number;
} {
  const input = parseFilterRequest(qs);
  resolveSort(input.sort, { sortable: ['version'] });
  if (input.sort?.some((item) => item.direction !== 'desc')) {
    throw new InvalidColumnFilterError('Versions are listed newest first: only `-version` sorts.');
  }

  const options: { locale?: string; page: number; limit: number } = { page: 1, limit: 20 };
  for (const filter of input.filters ?? []) {
    if (filter.field !== 'locale') {
      throw new InvalidColumnFilterError(
        `Unknown filter field: "${filter.field ?? ''}". Filterable fields: locale.`,
      );
    }
    if (normalizeOperator(String(filter.operator)) !== 'equals') {
      throw new InvalidColumnFilterError(`"locale" only supports the "equals" operator.`);
    }
    if (typeof filter.value === 'string' && filter.value !== '') options.locale = filter.value;
  }

  const { page, size } = parsePageParams(qs, VERSIONS_PAGE_SIZE);
  options.page = page;
  options.limit = size;
  return options;
}

function toClause(
  filter: ColumnFilter,
  fields: ListableFields,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_FILTER_DEPTH) {
    throw new InvalidColumnFilterError(
      `Filter nesting exceeds maximum depth (${MAX_FILTER_DEPTH}).`,
    );
  }

  const isGroup = !filter.field && (filter.AND !== undefined || filter.OR !== undefined);
  if (isGroup) {
    const clauses: Record<string, unknown>[] = [];
    if (filter.AND) {
      clauses.push({
        and: asList(filter.AND).map((item) => toClause(item as ColumnFilter, fields, depth + 1)),
      });
    }
    if (filter.OR) {
      clauses.push({
        or: asList(filter.OR).map((item) => toClause(item as ColumnFilter, fields, depth + 1)),
      });
    }
    return clauses.length === 1 ? (clauses[0] as Record<string, unknown>) : { and: clauses };
  }

  if (filter.AND !== undefined || filter.OR !== undefined) {
    throw new InvalidColumnFilterError(
      'A filter is either a condition or an AND/OR group, not both.',
    );
  }

  const field = filter.field;
  if (typeof field !== 'string' || field === '') {
    throw new InvalidColumnFilterError('Column filter needs a field.');
  }
  if (!fields.filterable.has(field)) {
    throw new InvalidColumnFilterError(`Unknown filter field: "${field}".`);
  }

  const wire = normalizeOperator(String(filter.operator));
  if (wire === 'between') {
    const [low, high] = operandList(filter.value);
    if (low === undefined || high === undefined) {
      throw new InvalidColumnFilterError(`"between" on "${field}" needs two values.`);
    }
    return { [field]: { greater_than_equal: low, less_than_equal: high } };
  }

  const operator = OPERATORS[wire];
  if (!operator) {
    throw new InvalidColumnFilterError(
      `"${field}" does not support the "${String(filter.operator)}" operator.`,
    );
  }
  if (field === '_status' && operator !== 'equals') {
    throw new InvalidColumnFilterError(`"_status" only supports the "equals" operator.`);
  }

  const value = LIST_OPERATORS.has(operator) ? operandList(filter.value) : filter.value;
  return { [field]: { [operator]: value } };
}

/**
 * A list operand from the wire: an array, a comma-separated string, or the numeric-keyed object the
 * query-string parser produces past its array limit.
 */
function operandList(value: unknown): unknown[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return asList(value);
}

function asList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.every(([key]) => /^\d+$/.test(key))) {
      return entries.sort(([a], [b]) => Number(a) - Number(b)).map(([, entry]) => entry);
    }
  }
  return value === undefined ? [] : [value];
}
