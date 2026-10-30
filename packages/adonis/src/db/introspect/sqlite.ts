import type {
  CmsKnex,
  ColumnType,
  IntrospectedColumn,
  IntrospectedIndex,
  Introspection,
} from '../types.js';
import { rowsOf } from './index.js';

/** `varchar(120)` / `char(36)` / `boolean` / `numeric(10,2)` → the portable column type. */
export function normalizeSqliteType(declared: string): {
  type: ColumnType;
  length?: number | undefined;
  precision?: number | undefined;
  scale?: number | undefined;
} {
  const value = declared.trim().toLowerCase();

  const sized = /^(\w+)\s*\((\d+)(?:\s*,\s*(\d+))?\)/.exec(value);
  const base = sized?.[1] ?? value;
  const first = sized?.[2] ? Number(sized[2]) : undefined;
  const second = sized?.[3] ? Number(sized[3]) : undefined;

  switch (base) {
    case 'varchar':
    case 'char':
    case 'character':
    case 'nvarchar':
      return { type: 'string', length: first };
    case 'uuid':
      return { type: 'uuid' };
    case 'int':
    case 'integer':
    case 'mediumint':
      return { type: 'integer' };
    case 'bigint':
      return { type: 'bigint' };
    case 'numeric':
    case 'decimal':
      return { type: 'decimal', precision: first, scale: second };
    case 'real':
    case 'double':
    case 'float':
      return { type: 'float' };
    case 'boolean':
    case 'bool':
    case 'tinyint':
      return { type: 'boolean' };
    case 'timestamp':
    case 'datetime':
    case 'date':
      return { type: 'timestamp' };
    case 'json':
    case 'jsonb':
      return { type: 'json' };
    case 'text':
    case 'longtext':
    case 'clob':
      return { type: 'text' };
    case 'blob':
    case 'binary':
      return { type: 'binary' };
    default:
      return { type: 'string' };
  }
}

function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export async function introspectSqlite(client: CmsKnex): Promise<Introspection> {
  const tableRows = rowsOf(
    await client.raw(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
    ),
  );

  const tables = [];

  for (const row of tableRows) {
    const name = String(row.name);

    const columnRows = rowsOf(await client.raw(`pragma table_info(${quote(name)})`));
    const columns: IntrospectedColumn[] = columnRows.map((column) => {
      const normalized = normalizeSqliteType(String(column.type ?? ''));
      return {
        name: String(column.name),
        type: normalized.type,
        nullable: Number(column.notnull ?? 0) === 0,
        ...(normalized.length !== undefined ? { length: normalized.length } : {}),
        ...(normalized.precision !== undefined ? { precision: normalized.precision } : {}),
        ...(normalized.scale !== undefined ? { scale: normalized.scale } : {}),
      };
    });

    const indexes: IntrospectedIndex[] = [];
    const indexRows = rowsOf(await client.raw(`pragma index_list(${quote(name)})`));

    for (const index of indexRows) {
      const indexName = String(index.name);
      if (indexName.startsWith('sqlite_autoindex')) continue;

      const info = rowsOf(await client.raw(`pragma index_info(${quote(indexName)})`))
        .sort((a, b) => Number(a.seqno ?? 0) - Number(b.seqno ?? 0))
        .map((item) => String(item.name));

      indexes.push({ name: indexName, columns: info, unique: Number(index.unique ?? 0) === 1 });
    }

    const foreignKeys = rowsOf(await client.raw(`pragma foreign_key_list(${quote(name)})`)).map(
      (fk) => ({
        column: String(fk.from),
        table: String(fk.table),
        onDelete: fk.on_delete ? String(fk.on_delete).toLowerCase() : undefined,
      }),
    );

    tables.push({ name, columns, indexes, foreignKeys });
  }

  return { engine: 'sqlite', tables };
}
