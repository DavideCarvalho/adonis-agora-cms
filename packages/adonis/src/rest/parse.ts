import type { FindQuery } from '../repository/crud.js';

/**
 * Reads the options that shape the returned documents: `locale`, `depth`, `draft`, `deleted` and
 * `select`. A single read takes only these; a list takes them next to its filter, sort and paging
 * (see `parseListQuery`).
 */
export function parseReadOptions(input: Record<string, unknown>): FindQuery {
  const query: FindQuery = {};

  if (typeof input.locale === 'string') query.locale = input.locale;

  const depth = toNumber(input.depth);
  if (depth !== undefined) query.depth = depth;

  if (input.deleted === 'true' || input.deleted === '1' || input.deleted === true) {
    query.deleted = true;
  }

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

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
