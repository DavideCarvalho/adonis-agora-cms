import type { CmsConfig, FieldConfig } from '../config/types.js';
import { resolveDbConfig, resolveLocalization, resolveTenancy } from '../config/types.js';
import { assertValidConfig } from '../config/validate.js';
import { systemTables } from '../db/system_tables.js';
import { CmsConfigError } from '../errors.js';
import {
  childSystemColumns,
  columnsCompatible,
  localeSuffix,
  scalarColumn,
  snakeCase,
  systemColumns,
} from './column_specs.js';
import { hashSchema } from './hash.js';
import { buildQueryPlan } from './query_plan.js';
import type { ColumnSpec, Engine, IdKind, SchemaSpec, SchemaTenancy, TableSpec } from './types.js';

export type CompileOptions = {
  engine?: Engine;
};

type CompileContext = {
  engine: Engine;
  idKind: IdKind;
  tablePrefix: string;
  locales: readonly string[];
  defaultLocale: string;
  tenancy: SchemaTenancy;
  tables: TableSpec[];
  collectionSlugs: ReadonlySet<string>;
};

type FieldScope = {
  /** Prefix for physical column names, from flattened groups (`seo_`). */
  prefix: string;
  /** Logical path from the document root. */
  path: readonly string[];
  /** When true, `localized` on a scalar expands it into one column per locale. */
  columnLocalized: boolean;
  /** When true, `localized` is handled by `_locale` rows and must not suffix columns. */
  rowScoped: boolean;
};

/**
 * Compiles a config into a `SchemaSpec`.
 *
 * Pure by design: no database, no environment, no clock. The same function powers `cms:diff`,
 * `cms:sync`, `cms:generate` and the admin schema endpoint.
 */
export function compileSchema(config: CmsConfig, options: CompileOptions = {}): SchemaSpec {
  assertValidConfig(config);

  const db = resolveDbConfig(config);
  const localization = resolveLocalization(config);
  const tenancyConfig = resolveTenancy(config);
  const tenancy: SchemaTenancy = {
    strategy: tenancyConfig.strategy,
    required: tenancyConfig.required,
    column: tenancyConfig.column,
  };
  const ctx: CompileContext = {
    engine: options.engine ?? 'pg',
    idKind: db.id,
    tablePrefix: db.tablePrefix,
    locales: localization.locales,
    defaultLocale: localization.defaultLocale,
    tenancy,
    tables: [],
    collectionSlugs: new Set((config.collections ?? []).map((c) => c.slug)),
  };

  for (const collection of config.collections ?? []) {
    ctx.tables.push(compileDocumentTable(collection.slug, 'collection', collection.fields, ctx));
  }

  for (const global of config.globals ?? []) {
    ctx.tables.push(compileDocumentTable(global.slug, 'global', global.fields, ctx));
  }

  const tables = [
    ...ctx.tables,
    ...systemTables({
      tablePrefix: ctx.tablePrefix,
      idKind: ctx.idKind,
      tenancy: ctx.tenancy,
    }),
  ];

  const queryPlan = buildQueryPlan(tables);
  const withoutHash = {
    engine: ctx.engine,
    idKind: ctx.idKind,
    tablePrefix: ctx.tablePrefix,
    locales: ctx.locales,
    defaultLocale: ctx.defaultLocale,
    tenancy: ctx.tenancy,
    renames: db.renames,
    tables,
    queryPlan,
  };

  return { hash: hashSchema(withoutHash), ...withoutHash };
}

function compileDocumentTable(
  slug: string,
  kind: 'collection' | 'global',
  fields: readonly FieldConfig[],
  ctx: CompileContext,
): TableSpec {
  const table: TableSpec = {
    name: `${ctx.tablePrefix}${slug}`,
    kind,
    slug,
    columns: systemColumns(ctx.idKind, ctx.tenancy),
    indexes: [],
  };

  compileFields(table, fields, ctx, {
    prefix: '',
    path: [],
    columnLocalized: true,
    rowScoped: false,
  });

  finalizeIndexes(table, ctx.tenancy);
  return table;
}

function compileFields(
  table: TableSpec,
  fields: readonly FieldConfig[],
  ctx: CompileContext,
  scope: FieldScope,
): void {
  for (const field of fields) {
    compileField(table, field, ctx, scope);
  }
}

function compileField(
  table: TableSpec,
  field: FieldConfig,
  ctx: CompileContext,
  scope: FieldScope,
): void {
  switch (field.type) {
    case 'tabs': {
      for (const tab of field.tabs) {
        compileFields(table, tab.fields, ctx, scope);
      }
      return;
    }

    case 'row':
    case 'collapsible': {
      compileFields(table, field.fields, ctx, scope);
      return;
    }

    case 'group': {
      compileFields(table, field.fields, ctx, {
        prefix: `${scope.prefix}${field.name}_`,
        path: [...scope.path, field.name],
        columnLocalized: scope.columnLocalized,
        rowScoped: scope.rowScoped,
      });
      return;
    }

    case 'array': {
      compileArray(table, field, ctx, scope);
      return;
    }

    case 'blocks': {
      compileBlocks(table, field, ctx, scope);
      return;
    }

    case 'relation': {
      if (field.hasMany) {
        compileHasManyRelation(table, field, ctx, scope);
      } else {
        compileScalar(table, field, ctx, scope);
      }
      return;
    }

    case 'select': {
      if (field.hasMany) {
        compileHasManySelect(table, field, ctx, scope);
      } else {
        compileScalar(table, field, ctx, scope);
      }
      return;
    }

    default: {
      compileScalar(table, field, ctx, scope);
    }
  }
}

function compileScalar(
  table: TableSpec,
  field: FieldConfig,
  ctx: CompileContext,
  scope: FieldScope,
): void {
  const path = [...scope.path, field.name].join('.');
  const physical = (suffix = '') => `${snakeCase(scope.prefix + field.name)}${suffix}`;
  const nullable = !field.required;

  if (scope.columnLocalized && !scope.rowScoped && field.localized) {
    for (const locale of ctx.locales) {
      const column = scalarColumn(
        field,
        {
          name: physical(`_${localeSuffix(locale)}`),
          path,
          locale,
          nullable,
          unique: field.unique,
          index: field.index,
          defaultValue: field.defaultValue,
        },
        ctx.idKind,
      );
      if (column) table.columns.push(withRelationRef(column, field, ctx));
    }
    return;
  }

  const column = scalarColumn(
    field,
    {
      name: physical(),
      path,
      nullable,
      unique: field.unique,
      index: field.index,
      defaultValue: field.defaultValue,
    },
    ctx.idKind,
  );

  if (column) table.columns.push(withRelationRef(column, field, ctx));
}

function withRelationRef(column: ColumnSpec, field: FieldConfig, ctx: CompileContext): ColumnSpec {
  if (field.type === 'relation' && typeof field.relationTo === 'string') {
    column.references = {
      table: `${ctx.tablePrefix}${field.relationTo}`,
      column: 'id',
      onDelete: 'set null',
    };
  }
  return column;
}

function compileArray(
  table: TableSpec,
  field: Extract<FieldConfig, { type: 'array' }>,
  ctx: CompileContext,
  scope: FieldScope,
): void {
  const logicalPath = [...scope.path, field.name];
  const localized = field.localized === true || hasLocalizedDescendant(field.fields);
  const child = createChildTable(ctx, table, field.name, logicalPath, localized);

  compileFields(child, field.fields, ctx, {
    prefix: '',
    path: logicalPath,
    columnLocalized: false,
    rowScoped: localized,
  });

  pushChild(ctx, child, { order: true, locale: localized });
}

function compileBlocks(
  table: TableSpec,
  field: Extract<FieldConfig, { type: 'blocks' }>,
  ctx: CompileContext,
  scope: FieldScope,
): void {
  const logicalPath = [...scope.path, field.name];
  const localized =
    field.localized === true ||
    field.blocks.some((blockDefinition) => hasLocalizedDescendant(blockDefinition.fields));
  const child = createChildTable(ctx, table, field.name, logicalPath, localized);

  child.columns.push({
    name: 'type',
    type: 'string',
    length: 64,
    nullable: false,
    path: `${logicalPath.join('.')}.type`,
  });

  const seen = new Map<string, ColumnSpec>();

  for (const blockDefinition of field.blocks) {
    const before = child.columns.length;
    compileFields(child, blockDefinition.fields, ctx, {
      prefix: '',
      path: logicalPath,
      columnLocalized: false,
      rowScoped: localized,
    });

    for (const added of child.columns.slice(before)) {
      const existing = seen.get(added.name);
      if (!existing) {
        seen.set(added.name, added);
        continue;
      }
      if (!columnsCompatible(existing, added)) {
        throw new CmsConfigError(
          `collections.${table.slug}.fields.${logicalPath.join('.')}`,
          `block field "${added.name}" is declared with incompatible types across blocks`,
        );
      }
      // A column absent in one block must be nullable in the union.
      existing.nullable = existing.nullable || added.nullable;
    }
  }

  child.indexes.push({
    name: indexName(child.name, 'type', 'idx'),
    columns: ['type'],
  });

  pushChild(ctx, child, { order: true, locale: localized });
}

function compileHasManySelect(
  table: TableSpec,
  field: Extract<FieldConfig, { type: 'select' }>,
  ctx: CompileContext,
  scope: FieldScope,
): void {
  const logicalPath = [...scope.path, field.name];
  const localized = field.localized === true;
  const child = createChildTable(ctx, table, field.name, logicalPath, localized);

  child.columns.push({
    name: 'value',
    type: 'string',
    length: 255,
    nullable: false,
    path: logicalPath.join('.'),
  });

  pushChild(ctx, child, { order: true, locale: localized });
}

function compileHasManyRelation(
  table: TableSpec,
  field: Extract<FieldConfig, { type: 'relation' }>,
  ctx: CompileContext,
  scope: FieldScope,
): void {
  const logicalPath = [...scope.path, field.name];
  const localized = field.localized === true;
  const child = createChildTable(ctx, table, field.name, logicalPath, localized);
  const polymorphic = Array.isArray(field.relationTo);

  child.columns.push({
    name: 'related_id',
    type: ctx.idKind,
    nullable: false,
    path: logicalPath.join('.'),
  });

  if (polymorphic) {
    child.columns.push({
      name: 'related_collection',
      type: 'string',
      length: 64,
      nullable: false,
      path: logicalPath.join('.'),
    });
  }

  pushChild(ctx, child, { order: true, locale: localized });
}

function createChildTable(
  ctx: CompileContext,
  parent: TableSpec,
  slug: string,
  logicalPath: readonly string[],
  localized: boolean,
): TableSpec {
  const name = `${parent.name}__${snakeCase(slug)}`;
  const chain = parent.kind === 'child' ? [...(parent.chain ?? []), name] : [name];

  return {
    name,
    kind: 'child',
    slug,
    owner: parent.name,
    path: logicalPath.join('.'),
    rootTable: parent.kind === 'child' ? (parent.rootTable ?? parent.name) : parent.name,
    chain,
    columns: childSystemColumns(ctx.idKind, parent.name, localized, ctx.tenancy),
    indexes: [],
  };
}

function pushChild(
  ctx: CompileContext,
  child: TableSpec,
  options: { order: boolean; locale: boolean },
): void {
  if (options.order) {
    child.indexes.push({
      name: indexName(child.name, '_order', 'idx'),
      columns: ['_parent_id', '_order'],
    });
  }

  if (options.locale) {
    child.indexes.push({
      name: indexName(child.name, '_locale', 'idx'),
      columns: ['_parent_id', '_locale'],
    });
  }

  finalizeIndexes(child, ctx.tenancy);
  ctx.tables.push(child);
}

function finalizeIndexes(table: TableSpec, tenancy: SchemaTenancy): void {
  const existing = new Set(table.indexes.map((index) => index.name));

  for (const column of table.columns) {
    if (!column.path && !column.index && !column.unique && !column.references) continue;
    if (column.references) {
      const name = indexName(table.name, column.name, 'fk');
      if (!existing.has(name)) {
        table.indexes.push({ name, columns: [column.name] });
        existing.add(name);
      }
      continue;
    }

    if (column.unique) {
      const name = indexName(table.name, column.name, 'uniq');
      if (!existing.has(name)) {
        table.indexes.push({
          name,
          columns: tenancy.column ? [column.name, tenancy.column] : [column.name],
          unique: true,
        });
        existing.add(name);
      }
    } else if (column.index) {
      const name = indexName(table.name, column.name, 'idx');
      if (!existing.has(name)) {
        table.indexes.push({ name, columns: [column.name] });
        existing.add(name);
      }
    }
  }
}

/** Postgres caps identifiers at 63 chars; keep a stable 8-char digest for long names. */
export function indexName(table: string, column: string, kind: 'idx' | 'uniq' | 'fk'): string {
  const base = `${table}_${column}_${kind}`;
  if (base.length <= 60) return base;

  let hash = 0;
  for (let index = 0; index < base.length; index += 1) {
    hash = (hash * 31 + base.charCodeAt(index)) >>> 0;
  }
  return `${base.slice(0, 51)}_${hash.toString(36).padStart(8, '0').slice(-8)}`;
}

export function hasLocalizedDescendant(fields: readonly FieldConfig[]): boolean {
  return fields.some((field) => {
    if (field.localized) return true;
    if ('fields' in field && Array.isArray(field.fields)) {
      if (hasLocalizedDescendant(field.fields)) return true;
    }
    if (field.type === 'blocks') {
      if (field.blocks.some((blockDefinition) => hasLocalizedDescendant(blockDefinition.fields))) {
        return true;
      }
    }
    if (field.type === 'tabs') {
      if (field.tabs.some((tab) => hasLocalizedDescendant(tab.fields))) return true;
    }
    return false;
  });
}
