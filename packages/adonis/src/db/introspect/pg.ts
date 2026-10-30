import type {
  CmsKnex,
  ColumnType,
  IntrospectedColumn,
  IntrospectedIndex,
  Introspection,
} from '../types.js';
import { rowsOf } from './index.js';

/** `character varying(120)` / `timestamp with time zone` / `numeric(10,2)`. */
export function normalizePgType(declared: string): {
  type: ColumnType;
  length?: number | undefined;
  precision?: number | undefined;
  scale?: number | undefined;
} {
  const value = declared.trim().toLowerCase();

  const sized = /^(\w[\w ]*?)\s*\((\d+)(?:\s*,\s*(\d+))?\)/.exec(value);
  const base = sized?.[1]?.trim() ?? value;
  const first = sized?.[2] ? Number(sized[2]) : undefined;
  const second = sized?.[3] ? Number(sized[3]) : undefined;

  switch (base) {
    case 'character varying':
    case 'character':
      return { type: 'string', length: first };
    case 'uuid':
      return { type: 'uuid' };
    case 'integer':
    case 'smallint':
      return { type: 'integer' };
    case 'bigint':
      return { type: 'bigint' };
    case 'numeric':
    case 'decimal':
      return { type: 'decimal', precision: first, scale: second };
    case 'double precision':
    case 'real':
      return { type: 'float' };
    case 'boolean':
      return { type: 'boolean' };
    case 'timestamp with time zone':
    case 'timestamp without time zone':
    case 'timestamp':
    case 'date':
      return { type: 'timestamp' };
    case 'json':
    case 'jsonb':
      return { type: 'json' };
    case 'text':
      return { type: 'text' };
    case 'bytea':
      return { type: 'binary' };
    default:
      return { type: 'string' };
  }
}

const COLUMNS_SQL = `
  select c.relname as table_name,
         a.attname as column_name,
         format_type(a.atttypid, a.atttypmod) as data_type,
         not a.attnotnull as nullable
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = current_schema()
     and c.relkind = 'r'
     and a.attnum > 0
     and not a.attisdropped
   order by c.relname, a.attnum
`;

const INDEXES_SQL = `
  select t.relname as table_name,
         i.relname as index_name,
         ix.indisunique as is_unique,
         a.attname as column_name,
         k.ord as position
    from pg_index ix
    join pg_class t on t.oid = ix.indrelid
    join pg_class i on i.oid = ix.indexrelid
    join pg_namespace n on n.oid = t.relnamespace
    join lateral unnest(ix.indkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
   where n.nspname = current_schema()
     and t.relkind = 'r'
   order by t.relname, i.relname, k.ord
`;

const FOREIGN_KEYS_SQL = `
  select tc.table_name,
         kcu.column_name,
         ccu.table_name as foreign_table,
         rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on kcu.constraint_name = tc.constraint_name
     and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
     and ccu.table_schema = tc.table_schema
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
     and rc.constraint_schema = tc.table_schema
   where tc.constraint_type = 'FOREIGN KEY'
     and tc.table_schema = current_schema()
`;

export async function introspectPostgres(client: CmsKnex): Promise<Introspection> {
  const columnRows = rowsOf(await client.raw(COLUMNS_SQL));
  const indexRows = rowsOf(await client.raw(INDEXES_SQL));
  const foreignKeyRows = rowsOf(await client.raw(FOREIGN_KEYS_SQL));

  const tables = new Map<
    string,
    {
      name: string;
      columns: IntrospectedColumn[];
      indexes: Map<string, IntrospectedIndex>;
      foreignKeys: Introspection['tables'][number]['foreignKeys'];
    }
  >();

  for (const row of columnRows) {
    const tableName = String(row.table_name);
    const table = ensureTable(tables, tableName);
    const normalized = normalizePgType(String(row.data_type));
    table.columns.push({
      name: String(row.column_name),
      type: normalized.type,
      nullable: row.nullable === true || row.nullable === 't',
      ...(normalized.length !== undefined ? { length: normalized.length } : {}),
      ...(normalized.precision !== undefined ? { precision: normalized.precision } : {}),
      ...(normalized.scale !== undefined ? { scale: normalized.scale } : {}),
    });
  }

  for (const row of indexRows) {
    const tableName = String(row.table_name);
    const table = ensureTable(tables, tableName);
    const indexName = String(row.index_name);
    const index = table.indexes.get(indexName) ?? {
      name: indexName,
      columns: [],
      unique: row.is_unique === true || row.is_unique === 't',
    };
    index.columns.push(String(row.column_name));
    table.indexes.set(indexName, index);
  }

  for (const row of foreignKeyRows) {
    const tableName = String(row.table_name);
    const table = ensureTable(tables, tableName);
    table.foreignKeys.push({
      column: String(row.column_name),
      table: String(row.foreign_table),
      ...(row.delete_rule ? { onDelete: String(row.delete_rule).toLowerCase() } : {}),
    });
  }

  return {
    engine: 'pg',
    tables: [...tables.values()].map((table) => ({
      name: table.name,
      columns: table.columns,
      indexes: [...table.indexes.values()],
      foreignKeys: table.foreignKeys,
    })),
  };
}

function ensureTable(
  tables: Map<
    string,
    {
      name: string;
      columns: IntrospectedColumn[];
      indexes: Map<string, IntrospectedIndex>;
      foreignKeys: Introspection['tables'][number]['foreignKeys'];
    }
  >,
  name: string,
) {
  let table = tables.get(name);
  if (!table) {
    table = { name, columns: [], indexes: new Map(), foreignKeys: [] };
    tables.set(name, table);
  }
  return table;
}
