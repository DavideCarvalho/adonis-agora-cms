import { createHash } from 'node:crypto';
import type { SchemaSpec } from './types.js';

type SpecWithoutHash = Omit<SchemaSpec, 'hash'>;

/**
 * A stable digest of the schema spec.
 *
 * Table, column and index order is not semantic, so it is normalized away: reordering the
 * fields in the config must not look like drift. Anything that changes the physical schema
 * does change the hash.
 */
export function hashSchema(spec: SpecWithoutHash): string {
  return createHash('sha256')
    .update(canonicalJson(normalizeSpec(spec)))
    .digest('hex');
}

function normalizeSpec(spec: SpecWithoutHash) {
  return {
    engine: spec.engine,
    idKind: spec.idKind,
    tablePrefix: spec.tablePrefix,
    defaultLocale: spec.defaultLocale,
    tenancy: { ...spec.tenancy },
    locales: [...spec.locales].sort(),
    tables: [...spec.tables]
      .sort((a, b) => compare(a.name, b.name))
      .map((table) => ({
        name: table.name,
        kind: table.kind,
        slug: table.slug,
        owner: table.owner,
        path: table.path,
        rootTable: table.rootTable,
        chain: table.chain ? [...table.chain] : undefined,
        columns: [...table.columns]
          .sort((a, b) => compare(a.name, b.name))
          .map((column) => ({ ...column })),
        indexes: [...table.indexes]
          .sort((a, b) => compare(a.name, b.name))
          .map((index) => ({ ...index, columns: [...index.columns] })),
      })),
    queryPlan: Object.fromEntries(
      Object.entries(spec.queryPlan)
        .sort(([a], [b]) => compare(a, b))
        .map(([key, entry]) => [key, { ...entry, chain: [...entry.chain], path: [...entry.path] }]),
    ),
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic JSON: object keys sorted, `undefined` dropped, arrays preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};

  for (const key of Object.keys(source).sort(compare)) {
    if (source[key] === undefined) continue;
    sorted[key] = canonicalize(source[key]);
  }

  return sorted;
}
