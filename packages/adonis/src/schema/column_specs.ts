import type { FieldConfig } from '../config/types.js';
import type { ColumnSpec, IdKind, SchemaTenancy } from './types.js';

/** `pt-BR` → `pt_br`, used as the column suffix for localized fields. */
export function localeSuffix(locale: string): string {
  return locale.replace(/-/g, '_').toLowerCase();
}

/**
 * `publishedAt` → `published_at`.
 *
 * Field names are written in JS style (camelCase), columns are snake_case — the Adonis
 * convention, and what the filter/admin layers expect.
 */
export function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/^_+/, '')
    .toLowerCase();
}

export function idColumn(idKind: IdKind): ColumnSpec {
  return idKind === 'uuid'
    ? { name: 'id', type: 'uuid', nullable: false }
    : { name: 'id', type: 'increment', nullable: false };
}

/** The system columns every collection/global table starts with. */
export function systemColumns(idKind: IdKind, tenancy: SchemaTenancy): ColumnSpec[] {
  const columns: ColumnSpec[] = [
    idColumn(idKind),
    { name: 'created_at', type: 'timestamp', nullable: false, default: { kind: 'now' } },
    { name: 'updated_at', type: 'timestamp', nullable: false, default: { kind: 'now' } },
    {
      name: '_status',
      type: 'string',
      length: 16,
      nullable: false,
      default: { kind: 'value', value: 'draft' },
      path: '_status',
    },
  ];

  if (tenancy.column) {
    columns.push({
      name: tenancy.column,
      type: 'string',
      length: 64,
      nullable: !tenancy.required,
      index: true,
    });
  }

  return columns;
}

/** Columns every child table (array/blocks/hasMany) starts with. */
export function childSystemColumns(
  idKind: IdKind,
  ownerTable: string,
  localized: boolean,
  tenancy: SchemaTenancy,
): ColumnSpec[] {
  const columns: ColumnSpec[] = [
    idColumn(idKind),
    {
      name: '_parent_id',
      type: idKind === 'uuid' ? 'uuid' : 'integer',
      nullable: false,
      references: { table: ownerTable, column: 'id', onDelete: 'cascade' },
    },
    { name: '_order', type: 'integer', nullable: false, default: { kind: 'value', value: 0 } },
  ];

  if (localized) {
    columns.push({ name: '_locale', type: 'string', length: 16, nullable: false });
  }

  if (tenancy.column) {
    columns.push({
      name: tenancy.column,
      type: 'string',
      length: 64,
      nullable: !tenancy.required,
      index: true,
    });
  }

  return columns;
}

export function isScalarField(field: FieldConfig): boolean {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'password':
    case 'number':
    case 'checkbox':
    case 'date':
    case 'select':
    case 'radio':
    case 'json':
    case 'code':
    case 'slug':
    case 'richText':
    case 'upload':
      return true;
    default:
      return false;
  }
}

type ColumnOptions = {
  name: string;
  path: string;
  locale?: string | undefined;
  nullable: boolean;
  unique?: boolean | undefined;
  index?: boolean | undefined;
  defaultValue?: unknown;
};

function base(options: ColumnOptions): ColumnSpec {
  const column: ColumnSpec = {
    name: options.name,
    type: 'string',
    nullable: options.nullable,
    path: options.path,
  };

  if (options.locale) column.locale = options.locale;
  if (options.unique) column.unique = true;
  if (options.index) column.index = true;
  if (options.defaultValue !== undefined) {
    column.default = { kind: 'value', value: options.defaultValue as string | number | boolean };
  }

  return column;
}

/**
 * Maps a scalar field to a column. Returns `undefined` for fields that are not columns
 * (containers, arrays, blocks, relations with children).
 */
export function scalarColumn(
  field: FieldConfig,
  options: ColumnOptions,
  idKind: IdKind,
): ColumnSpec | undefined {
  const column = base(options);

  switch (field.type) {
    case 'text':
      column.type = 'string';
      column.length = field.maxLength ?? 255;
      return column;

    case 'textarea':
      column.type = 'text';
      return column;

    case 'email':
      column.type = 'string';
      column.length = 320;
      return column;

    case 'password':
      column.type = 'string';
      column.length = 255;
      return column;

    case 'number': {
      const format = field.format ?? 'int';
      if (format === 'int') column.type = 'integer';
      else if (format === 'float') column.type = 'float';
      else {
        column.type = 'decimal';
        column.precision = field.precision ?? 10;
        column.scale = field.scale ?? 2;
      }
      return column;
    }

    case 'checkbox':
      column.type = 'boolean';
      return column;

    case 'date':
      column.type = 'timestamp';
      return column;

    case 'select':
    case 'radio':
      column.type = 'string';
      column.length = 255;
      return column;

    case 'json':
    case 'richText':
      column.type = 'json';
      return column;

    case 'code':
      column.type = 'text';
      return column;

    case 'slug':
      column.type = 'string';
      column.length = 255;
      return column;

    case 'upload':
      column.type = 'string';
      column.length = 64;
      column.name = `${options.name}_id`;
      return column;

    case 'relation':
      if (field.hasMany) return undefined;
      column.type = idKind === 'uuid' ? 'uuid' : 'integer';
      column.name = `${options.name}_id`;
      return column;

    default: {
      const custom = (
        field as {
          __column?: {
            type: ColumnSpec['type'];
            length?: number;
            precision?: number;
            scale?: number;
          };
        }
      ).__column;
      if (!custom) return undefined;

      column.type = custom.type;
      if (custom.length !== undefined) column.length = custom.length;
      if (custom.precision !== undefined) column.precision = custom.precision;
      if (custom.scale !== undefined) column.scale = custom.scale;
      return column;
    }
  }
}

/** Two columns are compatible when a block union can merge them without losing information. */
export function columnsCompatible(a: ColumnSpec, b: ColumnSpec): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.length === b.length &&
    a.precision === b.precision &&
    a.scale === b.scale
  );
}
