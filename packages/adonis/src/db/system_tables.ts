import type { ColumnSpec, IdKind, SchemaSpec, SchemaTenancy, TableSpec } from '../schema/types.js';

type SystemTableContext = {
  tablePrefix: string;
  idKind: IdKind;
  tenancy: SchemaTenancy;
};

import { createTableFromSpec } from './sync.js';
import type { CmsKnex } from './types.js';

function column(
  name: string,
  type: ColumnSpec['type'],
  options: Partial<ColumnSpec> = {},
): ColumnSpec {
  return { name, type, nullable: false, ...options };
}

/** History table: one row per saved version, snapshot as JSON. */
export function versionsTable(spec: SystemTableContext): TableSpec {
  const columns: ColumnSpec[] = [
    column('id', 'increment'),
    column('collection', 'string', { length: 64, index: true }),
    column('document_id', spec.idKind === 'uuid' ? 'uuid' : 'integer'),
    column('locale', 'string', { length: 16, nullable: true }),
    column('version', 'integer'),
    column('status', 'string', { length: 16 }),
    column('autosave', 'boolean', { default: { kind: 'value', value: false } }),
    column('snapshot', 'json'),
    column('created_by', 'string', { length: 64, nullable: true }),
    column('created_at', 'timestamp', { default: { kind: 'now' } }),
    column('is_latest', 'boolean', { default: { kind: 'value', value: false } }),
  ];

  if (spec.tenancy.column) {
    columns.push(
      column(spec.tenancy.column, 'string', {
        length: 64,
        nullable: !spec.tenancy.required,
        index: true,
      }),
    );
  }

  return {
    name: `${spec.tablePrefix}versions`,
    kind: 'system',
    slug: 'versions',
    columns,
    indexes: [
      {
        name: `${spec.tablePrefix}versions_lookup_idx`,
        columns: ['collection', 'document_id', 'version'],
      },
      {
        name: `${spec.tablePrefix}versions_latest_idx`,
        columns: ['collection', 'document_id', 'is_latest'],
      },
    ],
  };
}

/** Advisory locks so two editors do not overwrite each other. */
export function locksTable(spec: SystemTableContext): TableSpec {
  const columns: ColumnSpec[] = [
    column('id', 'increment'),
    column('collection', 'string', { length: 64 }),
    column('document_id', spec.idKind === 'uuid' ? 'uuid' : 'integer'),
    column('user_id', 'string', { length: 64, nullable: true }),
    column('expires_at', 'timestamp'),
  ];

  if (spec.tenancy.column) {
    columns.push(
      column(spec.tenancy.column, 'string', { length: 64, nullable: !spec.tenancy.required }),
    );
  }

  const uniqueColumns = spec.tenancy.column
    ? ['collection', 'document_id', spec.tenancy.column]
    : ['collection', 'document_id'];

  return {
    name: `${spec.tablePrefix}document_locks`,
    kind: 'system',
    slug: 'document_locks',
    columns,
    indexes: [
      { name: `${spec.tablePrefix}document_locks_uniq`, columns: uniqueColumns, unique: true },
    ],
  };
}

/** Scheduled publish/unpublish, one pending change per document. */
export function schedulesTable(spec: SystemTableContext): TableSpec {
  const columns: ColumnSpec[] = [
    column('id', 'increment'),
    column('collection', 'string', { length: 64 }),
    column('document_id', spec.idKind === 'uuid' ? 'uuid' : 'integer'),
    column('action', 'string', { length: 16 }),
    column('run_at', 'timestamp', { index: true }),
  ];

  if (spec.tenancy.column) {
    columns.push(
      column(spec.tenancy.column, 'string', { length: 64, nullable: !spec.tenancy.required }),
    );
  }

  return {
    name: `${spec.tablePrefix}document_schedules`,
    kind: 'system',
    slug: 'document_schedules',
    columns,
    indexes: [
      {
        name: `${spec.tablePrefix}document_schedules_uniq`,
        columns: spec.tenancy.column
          ? ['collection', 'document_id', spec.tenancy.column]
          : ['collection', 'document_id'],
        unique: true,
      },
    ],
  };
}

/** Application tokens — the principal a content client authenticates with. */
export function apiTokensTable(spec: SystemTableContext): TableSpec {
  return {
    name: `${spec.tablePrefix}api_tokens`,
    kind: 'system',
    slug: 'api_tokens',
    columns: [
      column('id', 'increment'),
      column('name', 'string', { length: 64 }),
      column('token_hash', 'string', { length: 64, unique: true }),
      column('tenant', 'string', { length: 64, nullable: true, index: true }),
      column('abilities', 'json'),
      column('expires_at', 'timestamp', { nullable: true }),
      column('created_at', 'timestamp', { default: { kind: 'now' } }),
      column('last_used_at', 'timestamp', { nullable: true }),
    ],
    indexes: [{ name: `${spec.tablePrefix}api_tokens_tenant_idx`, columns: ['tenant'] }],
  };
}

export function systemTables(spec: SystemTableContext): TableSpec[] {
  return [versionsTable(spec), locksTable(spec), schedulesTable(spec), apiTokensTable(spec)];
}

/** Creates the CMS-owned tables that are outside the compiled spec (idempotent). */
export async function ensureSystemTables(client: CmsKnex, spec: SchemaSpec): Promise<void> {
  for (const table of systemTables(spec)) {
    if (await client.schema.hasTable(table.name)) continue;
    await createTableFromSpec(client, table, spec.engine);
  }
}
