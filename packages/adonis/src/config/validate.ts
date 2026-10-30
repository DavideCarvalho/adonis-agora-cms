import { CmsConfigError } from '../errors.js';
import type {
  CmsConfig,
  CollectionConfig,
  FieldConfig,
  GlobalConfig,
  LocaleCode,
  SelectOption,
} from './types.js';
import { resolveDbConfig, resolveLocalization } from './types.js';

const SLUG_PATTERN = /^[a-z][a-z0-9_]*$/;
const FIELD_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

const TEXTUAL_TYPES = new Set(['text', 'textarea', 'email', 'slug', 'code', 'richText']);
const BUILTIN_TYPES = new Set([
  'text',
  'textarea',
  'email',
  'password',
  'number',
  'checkbox',
  'date',
  'select',
  'radio',
  'json',
  'code',
  'slug',
  'richText',
  'relation',
  'upload',
  'array',
  'group',
  'blocks',
  'tabs',
  'row',
  'collapsible',
]);
const NON_UNIQUEABLE = new Set(['array', 'blocks', 'group', 'json', 'richText', 'tabs', 'row']);
const STRUCTURAL = new Set(['group', 'array', 'row', 'collapsible']);

/**
 * Validates a config and returns **all** problems instead of throwing on the first one.
 * Boot and `cms:diff` both call this and surface the whole list, so a broken config is fixed
 * in one pass.
 */
export function validateConfig(config: CmsConfig): CmsConfigError[] {
  const errors: CmsConfigError[] = [];
  const collections = config.collections ?? [];
  const globals = config.globals ?? [];
  const db = resolveDbConfig(config);
  const localization = resolveLocalization(config);

  const collectionSlugs = new Set<string>();
  const allSlugs = new Set<string>();

  for (const item of [...collections, ...globals]) {
    if (!SLUG_PATTERN.test(item.slug)) {
      errors.push(
        new CmsConfigError(
          `collections.${item.slug}`,
          `invalid slug "${item.slug}": must match ${SLUG_PATTERN}`,
        ),
      );
    }
    if (allSlugs.has(item.slug)) {
      errors.push(
        new CmsConfigError(`collections.${item.slug}`, 'duplicate collection/global slug'),
      );
    }
    allSlugs.add(item.slug);
  }

  for (const item of collections) {
    collectionSlugs.add(item.slug);
  }

  for (const collection of collections) {
    errors.push(
      ...validateCollection(collection, {
        collectionSlugs,
        locales: localization.locales,
        customTypes: new Set(config.fieldTypes ?? []),
        mediaEnabled: config.integrations?.media ?? false,
      }),
    );
  }

  for (const item of globals) {
    errors.push(...validateGlobal(item, config, localization.locales));
  }

  if (localization.locales.length > 0) {
    for (const locale of localization.locales) {
      if (!LOCALE_PATTERN.test(locale)) {
        errors.push(
          new CmsConfigError(
            'localization.locales',
            `invalid locale "${locale}": expected forms like "pt" or "pt-BR"`,
          ),
        );
      }
    }
    if (!localization.locales.includes(localization.defaultLocale)) {
      errors.push(
        new CmsConfigError(
          'localization.defaultLocale',
          `"${localization.defaultLocale}" is not one of the configured locales`,
        ),
      );
    }
  }

  // Renames are validated regardless of the schema mode: they are a diff input.
  for (const [from, to] of Object.entries(db.renames)) {
    if (!from.includes('.') || !to) {
      errors.push(
        new CmsConfigError(
          'db.renames',
          `invalid rename entry "${from}": expected "collection.field" -> "newField"`,
        ),
      );
    }
  }

  errors.push(...validateTenancy(config, collectionSlugs, allSlugs));

  return errors;
}

function validateTenancy(
  config: CmsConfig,
  collectionSlugs: ReadonlySet<string>,
  allSlugs: ReadonlySet<string>,
): CmsConfigError[] {
  const errors: CmsConfigError[] = [];
  const tenancy = config.tenancy;
  if (!tenancy) return errors;

  if (tenancy.strategy === 'database') {
    if (!tenancy.connection) {
      errors.push(
        new CmsConfigError(
          'tenancy.connection',
          'database strategy requires a connection resolver',
        ),
      );
    }
    return errors;
  }

  if (tenancy.strategy !== 'row') {
    errors.push(
      new CmsConfigError(
        'tenancy.strategy',
        `invalid strategy "${String(tenancy.strategy)}": expected "row" or "database"`,
      ),
    );
    return errors;
  }

  for (const [tenant, override] of Object.entries(tenancy.overrides ?? {})) {
    for (const slug of override.collections?.only ?? []) {
      if (!collectionSlugs.has(slug)) {
        errors.push(
          new CmsConfigError(
            `tenancy.overrides.${tenant}.collections.only`,
            `"${slug}" is not a declared collection`,
          ),
        );
      }
    }
    for (const slug of override.globals?.only ?? []) {
      if (!allSlugs.has(slug)) {
        errors.push(
          new CmsConfigError(
            `tenancy.overrides.${tenant}.globals.only`,
            `"${slug}" is not a declared global`,
          ),
        );
      }
    }
  }

  return errors;
}

type CollectionContext = {
  collectionSlugs: Set<string>;
  locales: readonly LocaleCode[];
  customTypes: Set<string>;
  mediaEnabled: boolean;
};

function validateCollection(
  collection: CollectionConfig,
  ctx: CollectionContext,
): CmsConfigError[] {
  const errors: CmsConfigError[] = [];
  const path = `collections.${collection.slug}`;

  if (collection.fields.length === 0) {
    errors.push(new CmsConfigError(`${path}.fields`, 'a collection needs at least one field'));
  }

  errors.push(...validateFields(collection.fields, `${path}.fields`, ctx));

  if (collection.admin?.useAsTitle) {
    const titleField = findField(collection.fields, collection.admin.useAsTitle);
    if (!titleField) {
      errors.push(
        new CmsConfigError(
          `${path}.admin.useAsTitle`,
          `"${collection.admin.useAsTitle}" is not a field of this collection`,
        ),
      );
    } else if (!TEXTUAL_TYPES.has(titleField.type) || titleField.type === 'richText') {
      errors.push(
        new CmsConfigError(
          `${path}.admin.useAsTitle`,
          `"${collection.admin.useAsTitle}" must be a textual field`,
        ),
      );
    }
  }

  for (const column of collection.admin?.defaultColumns ?? []) {
    const normalized = column.split('.').at(-1) ?? column;
    if (!findField(collection.fields, normalized)) {
      errors.push(
        new CmsConfigError(
          `${path}.admin.defaultColumns`,
          `"${column}" is not a field of this collection`,
        ),
      );
    }
  }

  return errors;
}

function validateGlobal(
  item: GlobalConfig,
  config: CmsConfig,
  locales: readonly LocaleCode[],
): CmsConfigError[] {
  const errors: CmsConfigError[] = [];
  const path = `globals.${item.slug}`;
  const ctx: CollectionContext = {
    collectionSlugs: new Set((config.collections ?? []).map((c) => c.slug)),
    locales,
    customTypes: new Set(config.fieldTypes ?? []),
    mediaEnabled: config.integrations?.media ?? false,
  };

  if (item.fields.length === 0) {
    errors.push(new CmsConfigError(`${path}.fields`, 'a global needs at least one field'));
  }

  if (item.versions?.drafts) {
    errors.push(new CmsConfigError(`${path}.versions.drafts`, 'globals do not support drafts'));
  }

  errors.push(...validateFields(item.fields, `${path}.fields`, ctx));
  return errors;
}

function validateFields(
  fields: readonly FieldConfig[],
  path: string,
  ctx: CollectionContext,
): CmsConfigError[] {
  const errors: CmsConfigError[] = [];
  const seen = new Set<string>();

  fields.forEach((field, index) => {
    const fieldPath = `${path}[${index}]`;
    const label = field.name || `<unnamed:${index}>`;

    if (!field.name) {
      errors.push(new CmsConfigError(fieldPath, 'field is missing a name'));
    } else if (field.name.startsWith('_')) {
      errors.push(
        new CmsConfigError(`${fieldPath}.name`, `"${field.name}" is reserved (leading underscore)`),
      );
    } else if (!FIELD_NAME_PATTERN.test(field.name)) {
      errors.push(
        new CmsConfigError(
          `${fieldPath}.name`,
          `invalid field name "${field.name}": must match ${FIELD_NAME_PATTERN}`,
        ),
      );
    }

    if (seen.has(label)) {
      errors.push(new CmsConfigError(`${fieldPath}.name`, `duplicate field name "${label}"`));
    }
    seen.add(label);

    const customColumn = (field as { __column?: unknown }).__column;
    if (!BUILTIN_TYPES.has(field.type) && !customColumn) {
      errors.push(
        new CmsConfigError(
          `${fieldPath}.type`,
          `unknown field type "${field.type}" (use defineField or register it via config.fieldTypes)`,
        ),
      );
    }

    if (field.localized && ctx.locales.length === 0) {
      errors.push(
        new CmsConfigError(
          `${fieldPath}.localized`,
          'field is localized but no locales are configured',
        ),
      );
    }

    if (field.unique && NON_UNIQUEABLE.has(field.type)) {
      errors.push(
        new CmsConfigError(`${fieldPath}.unique`, `"${field.type}" fields cannot be unique`),
      );
    }

    if (field.type === 'select' || field.type === 'radio') {
      errors.push(...validateOptions(field.options, `${fieldPath}.options`));
    }

    if (field.type === 'relation') {
      const targets = typeof field.relationTo === 'string' ? [field.relationTo] : field.relationTo;
      if (targets.length === 0) {
        errors.push(new CmsConfigError(`${fieldPath}.relationTo`, 'relationTo cannot be empty'));
      }
      for (const target of targets) {
        if (!ctx.collectionSlugs.has(target)) {
          errors.push(
            new CmsConfigError(
              `${fieldPath}.relationTo`,
              `relation target "${target}" is not a declared collection`,
            ),
          );
        }
      }
    }

    if (field.type === 'upload' && !ctx.collectionSlugs.has(field.relationTo)) {
      // Uploads live in the media library, outside the CMS collections. The integration flag is
      // what makes that explicit.
      if (!ctx.mediaEnabled) {
        errors.push(
          new CmsConfigError(
            `${fieldPath}.relationTo`,
            `upload target "${field.relationTo}" is not a collection; install @adonis-agora/media and set integrations.media: true`,
          ),
        );
      }
    }

    errors.push(...validateNested(field, fieldPath, ctx));
  });

  return errors;
}

function validateNested(
  field: FieldConfig,
  fieldPath: string,
  ctx: CollectionContext,
): CmsConfigError[] {
  if (STRUCTURAL.has(field.type) && 'fields' in field) {
    const errors: CmsConfigError[] = [];
    if (field.fields.length === 0) {
      errors.push(
        new CmsConfigError(`${fieldPath}.fields`, `"${field.type}" needs at least one field`),
      );
    }
    errors.push(...validateFields(field.fields, `${fieldPath}.fields`, ctx));
    return errors;
  }

  if (field.type === 'blocks') {
    const errors: CmsConfigError[] = [];
    const seen = new Set<string>();

    if (field.blocks.length === 0) {
      errors.push(new CmsConfigError(`${fieldPath}.blocks`, 'blocks needs at least one block'));
    }

    field.blocks.forEach((blockDefinition, index) => {
      const blockPath = `${fieldPath}.blocks[${index}]`;
      if (!SLUG_PATTERN.test(blockDefinition.slug)) {
        errors.push(
          new CmsConfigError(`${blockPath}.slug`, `invalid block slug "${blockDefinition.slug}"`),
        );
      }
      if (seen.has(blockDefinition.slug)) {
        errors.push(
          new CmsConfigError(`${blockPath}.slug`, `duplicate block slug "${blockDefinition.slug}"`),
        );
      }
      seen.add(blockDefinition.slug);
      errors.push(...validateFields(blockDefinition.fields, `${blockPath}.fields`, ctx));
    });

    return errors;
  }

  if (field.type === 'tabs') {
    const errors: CmsConfigError[] = [];
    if (field.tabs.length === 0) {
      errors.push(new CmsConfigError(`${fieldPath}.tabs`, 'tabs needs at least one tab'));
    }
    field.tabs.forEach((tab, index) => {
      errors.push(...validateFields(tab.fields, `${fieldPath}.tabs[${index}].fields`, ctx));
    });
    return errors;
  }

  return [];
}

function validateOptions(options: readonly SelectOption[], path: string): CmsConfigError[] {
  const errors: CmsConfigError[] = [];
  if (!options || options.length === 0) {
    errors.push(new CmsConfigError(path, 'at least one option is required'));
    return errors;
  }
  const values = new Set<string>();
  options.forEach((option, index) => {
    if (!option.value) {
      errors.push(new CmsConfigError(`${path}[${index}].value`, 'option value cannot be empty'));
    }
    if (values.has(option.value)) {
      errors.push(
        new CmsConfigError(`${path}[${index}].value`, `duplicate option value "${option.value}"`),
      );
    }
    values.add(option.value);
  });
  return errors;
}

/** Throws when the config is invalid. Used at boot and by every command. */
export function assertValidConfig(config: CmsConfig): void {
  const errors = validateConfig(config);
  if (errors.length === 0) return;

  const error = new CmsConfigError(
    'config',
    `invalid CMS configuration:\n${errors.map((e) => `  - ${e.message}`).join('\n')}`,
  );
  error.context.errors = errors.map((e) => e.message);
  throw error;
}

function findField(fields: readonly FieldConfig[], name: string): FieldConfig | undefined {
  for (const field of fields) {
    if (field.name === name) return field;
    if ('fields' in field && Array.isArray(field.fields)) {
      const nested = findField(field.fields, name);
      if (nested) return nested;
    }
    if (field.type === 'blocks') {
      for (const blockDefinition of field.blocks) {
        const nested = findField(blockDefinition.fields, name);
        if (nested) return nested;
      }
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        const nested = findField(tab.fields, name);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}
