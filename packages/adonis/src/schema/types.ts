/**
 * The compiled schema spec.
 *
 * `compileSchema` produces this from a config; it is the only input the database layer needs.
 * It must stay JSON-serializable: `cms:generate` embeds it in a migration file, so migrations
 * keep reproducing the schema even after the config evolves.
 */

export type Engine = 'pg' | 'mysql' | 'sqlite';

export type IdKind = 'uuid' | 'increment';

export type ColumnType =
  | 'uuid'
  | 'increment'
  | 'string'
  | 'text'
  | 'integer'
  | 'bigint'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'timestamp'
  | 'json'
  | 'binary';

export type ColumnDefault =
  | { kind: 'now' }
  | { kind: 'value'; value: string | number | boolean | null };

export type ForeignKeyRef = {
  table: string;
  column: string;
  onDelete: 'cascade' | 'set null' | 'restrict';
};

export type ColumnSpec = {
  /** Physical column name. */
  name: string;
  type: ColumnType;
  /** Logical field path inside the document, e.g. `seo.title` or `tags.label`. */
  path?: string;
  /** Locale this column holds, when the field is localized. */
  locale?: string;
  length?: number;
  precision?: number;
  scale?: number;
  nullable: boolean;
  default?: ColumnDefault;
  references?: ForeignKeyRef;
  unique?: boolean;
  index?: boolean;
};

export type IndexSpec = {
  name: string;
  columns: readonly string[];
  unique?: boolean;
};

export type TableKind = 'collection' | 'global' | 'child' | 'system';

export type TableSpec = {
  name: string;
  kind: TableKind;
  /** The field/collection slug this table belongs to. */
  slug: string;
  /** Physical table that owns this one (child tables only). */
  owner?: string;
  /** Dotted path from the root document, e.g. `layout.gallery`. */
  path?: string;
  /** Root document table (child tables only). */
  rootTable?: string;
  /** Ancestor child tables from the root to this one, inclusive (child tables only). */
  chain?: readonly string[];
  columns: ColumnSpec[];
  indexes: IndexSpec[];
};

export type QueryPlanEntry = {
  /** Physical table holding the column. */
  table: string;
  /** Table of the root document. */
  rootTable: string;
  /** Child tables to join, in order, starting at the root document. */
  chain: readonly string[];
  /** Physical column for the default locale (or the only column). */
  column: string;
  /** Locale → physical column, when the field is localized. */
  columns?: Readonly<Record<string, string>>;
  /** Logical path, split into segments. */
  path: readonly string[];
};

export type SchemaTenancy = {
  strategy: 'single' | 'row' | 'database';
  required: boolean;
  /** Physical tenant column (`_tenant_id`) in `row` strategy, `null` otherwise. */
  column: string | null;
};

export type SchemaSpec = {
  hash: string;
  engine: Engine;
  idKind: IdKind;
  tablePrefix: string;
  locales: readonly string[];
  defaultLocale: string;
  tenancy: SchemaTenancy;
  /** `db.renames`, carried so `cms:sync` and `cms:generate` see them without the config. */
  renames: Record<string, string>;
  tables: TableSpec[];
  /** Maps a logical field path (`layout.gallery.caption`) to where it physically lives. */
  queryPlan: Record<string, QueryPlanEntry>;
};

/** Depth used to order DDL: parents before children, drops in reverse. */
export function tableDepth(table: TableSpec): number {
  if (table.kind !== 'child') return 0;
  return table.path?.split('.').length ?? 1;
}
