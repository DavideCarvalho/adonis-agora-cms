import type {
  CmsKnex,
  ColumnType,
  IntrospectedColumn,
  IntrospectedIndex,
  Introspection,
} from '../types.js';
import { rowsOf } from './index.js';

/** MySQL reports `data_type` + `column_type` (`tinyint(1)`, `varchar(120)`, `decimal(10,2)`). */
export function normalizeMysqlType(
  dataType: string,
  columnType = '',
  length?: number | null,
  precision?: number | null,
  scale?: number | null,
): {
  type: ColumnType;
  length?: number | undefined;
  precision?: number | undefined;
  scale?: number | undefined;
} {
  const base = dataType.trim().toLowerCase();

  switch (base) {
    case 'varchar':
    case 'char':
      return { type: 'string', ...(length ? { length: Number(length) } : {}) };
    case 'uuid':
      return { type: 'uuid' };
    case 'int':
    case 'mediumint':
    case 'smallint':
      return { type: 'integer' };
    case 'bigint':
      return { type: 'bigint' };
    case 'tinyint':
      return columnType.toLowerCase().startsWith('tinyint(1)')
        ? { type: 'boolean' }
        : { type: 'integer' };
    case 'decimal':
    case 'numeric':
      return {
        type: 'decimal',
        ...(precision ? { precision: Number(precision) } : {}),
        ...(scale !== null && scale !== undefined ? { scale: Number(scale) } : {}),
      };
    case 'float':
    case 'double':
      return { type: 'float' };
    case 'datetime':
    case 'timestamp':
    case 'date':
      return { type: 'timestamp' };
    case 'json':
      return { type: 'json' };
    case 'text':
    case 'mediumtext':
    case 'longtext':
    case 'tinytext':
      return { type: 'text' };
    case 'blob':
    case 'mediumblob':
    case 'longblob':
    case 'binary':
    case 'varbinary':
      return { type: 'binary' };
    default:
      return { type: 'string' };
  }
}

const COLUMNS_SQL = `
  select table_name, column_name, data_type, column_type, is_nullable,
         character_maximum_length, numeric_precision, numeric_scale
    from information_schema.columns
   where table_schema = database()
   order by table_name, ordinal_position
`;

const INDEXES_SQL = `
  select table_name, index_name, non_unique, column_name, seq_in_index
    from information_schema.statistics
   where table_schema = database()
   order by table_name, index_name, seq_in_index
`;

const FOREIGN_KEYS_SQL = `
  select kcu.table_name, kcu.column_name, kcu.referenced_table_name as foreign_table,
         rc.delete_rule
    from information_schema.key_column_usage kcu
    join information_schema.referential_constraints rc
      on rc.constraint_name = kcu.constraint_name
     and rc.constraint_schema = kcu.table_schema
   where kcu.table_schema = database()
     and kcu.referenced_table_name is not null
`;

export async function introspectMysql(client: CmsKnex): Promise<Introspection> {
  const columnRows = rowsOf(await client.raw(COLUMNS_SQL));
  const indexRows = rowsOf(await client.raw(INDEXES_SQL));
  const foreignKeyRows = rowsOf(await client.raw(FOREIGN_KEYS_SQL));

  type TableEntry = {
    name: string;
    columns: IntrospectedColumn[];
    indexes: Map<string, IntrospectedIndex>;
    foreignKeys: Introspection['tables'][number]['foreignKeys'];
  };

  const tables = new Map<string, TableEntry>();

  const ensure = (name: string): TableEntry => {
    let table = tables.get(name);
    if (!table) {
      table = { name, columns: [], indexes: new Map(), foreignKeys: [] };
      tables.set(name, table);
    }
    return table;
  };

  for (const row of columnRows) {
    const table = ensure(String(row.table_name));
    const normalized = normalizeMysqlType(
      String(row.data_type),
      String(row.column_type ?? ''),
      row.character_maximum_length as number | null,
      row.numeric_precision as number | null,
      row.numeric_scale as number | null,
    );

    table.columns.push({
      name: String(row.column_name),
      type: normalized.type,
      nullable: String(row.is_nullable).toUpperCase() === 'YES',
      ...(normalized.length !== undefined ? { length: normalized.length } : {}),
      ...(normalized.precision !== undefined ? { precision: normalized.precision } : {}),
      ...(normalized.scale !== undefined ? { scale: normalized.scale } : {}),
    });
  }

  for (const row of indexRows) {
    const table = ensure(String(row.table_name));
    const indexName = String(row.index_name);
    const index = table.indexes.get(indexName) ?? {
      name: indexName,
      columns: [],
      unique: Number(row.non_unique ?? 1) === 0,
    };
    index.columns.push(String(row.column_name));
    table.indexes.set(indexName, index);
  }

  for (const row of foreignKeyRows) {
    const table = ensure(String(row.table_name));
    table.foreignKeys.push({
      column: String(row.column_name),
      table: String(row.foreign_table),
      ...(row.delete_rule ? { onDelete: String(row.delete_rule).toLowerCase() } : {}),
    });
  }

  return {
    engine: 'mysql',
    tables: [...tables.values()].map((table) => ({
      name: table.name,
      columns: table.columns,
      indexes: [...table.indexes.values()],
      foreignKeys: table.foreignKeys,
    })),
  };
}
