import type {
  ColumnSpec,
  ColumnType,
  Engine,
  ForeignKeyRef,
  IndexSpec,
  TableSpec,
} from '../schema/types.js';

/**
 * The slice of Knex the CMS uses.
 *
 * Deliberately structural: the core never imports `knex` at runtime, so `@adonisjs/lucid`
 * stays a peer. A real `Knex` instance is assignable to this.
 */
export interface CmsKnex {
  schema: {
    hasTable(tableName: string): Promise<boolean>;
    createTable(tableName: string, callback: (table: unknown) => unknown): unknown;
    alterTable(tableName: string, callback: (table: unknown) => unknown): unknown;
    dropTable(tableName: string): unknown;
    dropTableIfExists?(tableName: string): unknown;
  };
  raw(statement: string, bindings?: readonly unknown[]): unknown;
  /** Knex's transaction getter; used through a cast in `withTransaction`. */
  transaction?: unknown;
  fn?: {
    now(): unknown;
  };
}

export interface ColumnBuilderLike {
  notNullable(): ColumnBuilderLike;
  nullable(): ColumnBuilderLike;
  primary(): ColumnBuilderLike;
  unique(): ColumnBuilderLike;
  defaultTo(value: unknown): ColumnBuilderLike;
  references(reference: string): ColumnBuilderLike;
  onDelete(action: string): ColumnBuilderLike;
  unsigned(): ColumnBuilderLike;
  alter?(): ColumnBuilderLike;
}

export interface TableBuilderLike {
  increments(name: string): ColumnBuilderLike;
  uuid(name: string): ColumnBuilderLike;
  string(name: string, length?: number): ColumnBuilderLike;
  text(name: string): ColumnBuilderLike;
  integer(name: string): ColumnBuilderLike;
  bigInteger(name: string): ColumnBuilderLike;
  decimal(name: string, precision?: number, scale?: number): ColumnBuilderLike;
  float(name: string): ColumnBuilderLike;
  boolean(name: string): ColumnBuilderLike;
  timestamp(name: string, options?: { useTz?: boolean; precision?: number }): ColumnBuilderLike;
  json(name: string): ColumnBuilderLike;
  jsonb(name: string): ColumnBuilderLike;
  binary(name: string): ColumnBuilderLike;
  dropColumn(name: string): unknown;
  dropIndex(name: string): unknown;
  renameColumn?(from: string, to: string): unknown;
  index(columns: string[], name?: string): unknown;
  unique(columns: string[], options?: { indexName?: string }): unknown;
  foreign(
    columns: string | string[],
    options?: { references?: string; onDelete?: string },
  ): unknown;
}

export type IntrospectedColumn = {
  name: string;
  type: ColumnType;
  nullable: boolean;
  length?: number;
  precision?: number;
  scale?: number;
};

export type IntrospectedIndex = {
  name: string;
  columns: string[];
  unique: boolean;
};

export type IntrospectedForeignKey = {
  column: string;
  table: string;
  onDelete?: string | undefined;
};

export type IntrospectedTable = {
  name: string;
  columns: IntrospectedColumn[];
  indexes: IntrospectedIndex[];
  foreignKeys: IntrospectedForeignKey[];
};

export type Introspection = {
  engine: Engine;
  tables: IntrospectedTable[];
};

export type ColumnAlter = {
  column: string;
  from: IntrospectedColumn;
  to: ColumnSpec;
};

export type TableAlter = {
  table: string;
  addColumns: ColumnSpec[];
  dropColumns: string[];
  alterColumns: ColumnAlter[];
  addIndexes: IndexSpec[];
  dropIndexes: string[];
  /** Column-level renames resolved from `db.renames` (old physical name → new). */
  renames: { from: string; to: string }[];
};

export type SchemaPlan = {
  creates: TableSpec[];
  alters: TableAlter[];
  drops: string[];
  /** Anything that can lose data: drops, narrowing, not-null changes. */
  destructive: boolean;
  warnings: string[];
};

export type DiffOptions = {
  prune?: boolean;
  renames?: Record<string, string>;
  allowDestructive?: boolean;
};

export type SyncOptions = DiffOptions & {
  engine?: Engine;
  dryRun?: boolean;
  /** Skip the `cms_schema_state` write (used by tests that only want DDL). */
  skipState?: boolean;
};

export type SchemaState = {
  hash: string;
  engine: Engine;
  appliedAt: Date | null;
};

export function emptyPlan(): SchemaPlan {
  return { creates: [], alters: [], drops: [], destructive: false, warnings: [] };
}

export function planIsEmpty(plan: SchemaPlan): boolean {
  return (
    plan.creates.length === 0 &&
    plan.alters.length === 0 &&
    plan.drops.length === 0 &&
    plan.warnings.length === 0
  );
}

export type { ColumnType, Engine, ForeignKeyRef, IndexSpec, TableSpec } from '../schema/types.js';
