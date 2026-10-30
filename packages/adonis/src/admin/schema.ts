import type { CmsConfig, FieldConfig } from '../config/types.js';
import { resolveVersions } from '../config/types.js';
import { decideAccess } from '../repository/access.js';

export type AdminField = {
  type: string;
  name: string;
  label?: unknown;
  required?: boolean;
  unique?: boolean;
  localized?: boolean;
  hidden?: boolean;
  defaultValue?: unknown;
  admin?: unknown;
  /** Present for select/radio — the panel needs the option list. */
  options?: readonly { label: string; value: string }[];
  relationTo?: string | readonly string[];
  /** Present for upload — the dropzone's `accept` list. */
  mimeTypes?: readonly string[];
  hasMany?: boolean;
  minRows?: number;
  maxRows?: number;
  fields?: AdminField[];
  blocks?: { slug: string; labels?: unknown; fields: AdminField[] }[];
  tabs?: { label: string; fields: AdminField[] }[];
  /** `access.read` denied for this principal. */
  restricted?: boolean;
};

export type AdminCollection = {
  slug: string;
  kind: 'collection' | 'global';
  labels?: unknown;
  admin?: unknown;
  versioned: boolean;
  drafts: boolean;
  softDelete: boolean;
  fields: AdminField[];
};

export type AdminPermission = {
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

export type AdminSchema = {
  version: 1;
  admin: { title: string; path: string };
  locales: readonly string[];
  defaultLocale: string;
  tenancy: { strategy: string; required: boolean };
  collections: AdminCollection[];
  globals: AdminCollection[];
  user: unknown;
  permissions: Record<string, AdminPermission>;
};

/**
 * Serializes the config for the panel.
 *
 * Functions cannot cross the wire, so access/validation/hooks are **evaluated** here instead:
 * the panel receives `permissions` and `restricted` flags and never has to reimplement access.
 */
export function toAdminSchema(
  config: CmsConfig,
  options: { user?: unknown; req?: unknown } = {},
): AdminSchema {
  const permissions: Record<string, AdminPermission> = {};
  const accessArgs = { req: options.req ?? null, user: options.user ?? null, tenant: null };

  const collections = (config.collections ?? []).map((collection) => {
    permissions[collection.slug] = {
      read: decideAccess(collection.access?.read, accessArgs).allowed,
      create: decideAccess(collection.access?.create, accessArgs).allowed,
      update: decideAccess(collection.access?.update, accessArgs).allowed,
      delete: decideAccess(collection.access?.delete, accessArgs).allowed,
    };

    return {
      slug: collection.slug,
      kind: 'collection' as const,
      labels: collection.labels,
      admin: collection.admin,
      versioned: resolveVersions(config, collection.versions).drafts,
      drafts: resolveVersions(config, collection.versions).drafts,
      softDelete: collection.softDelete === true,
      fields: serializeFields(collection.fields, accessArgs),
    };
  });

  const globals = (config.globals ?? []).map((global) => {
    permissions[global.slug] = {
      read: decideAccess(global.access?.read, accessArgs).allowed,
      create: true,
      update: decideAccess(global.access?.update, accessArgs).allowed,
      delete: false,
    };

    return {
      slug: global.slug,
      kind: 'global' as const,
      labels: global.labels,
      admin: global.admin,
      versioned: false,
      drafts: false,
      softDelete: false,
      fields: serializeFields(global.fields, accessArgs),
    };
  });

  return {
    version: 1,
    admin: {
      title: config.admin?.title ?? 'CMS',
      path: config.admin?.path ?? '/admin',
    },
    locales: config.localization?.locales ?? [],
    defaultLocale: config.localization?.defaultLocale ?? 'en',
    tenancy: {
      strategy: config.tenancy?.strategy ?? 'single',
      required: config.tenancy?.required ?? false,
    },
    collections,
    globals,
    user: options.user ?? null,
    permissions,
  };
}

type AccessArgs = Parameters<typeof decideAccess>[1];

function serializeFields(fields: readonly FieldConfig[], accessArgs: AccessArgs): AdminField[] {
  return fields.map((field) => serializeField(field, accessArgs));
}

function serializeField(field: FieldConfig, accessArgs: AccessArgs): AdminField {
  const serialized: AdminField = {
    type: field.type,
    name: field.name,
  };

  if (field.label !== undefined) serialized.label = field.label;
  if (field.required !== undefined) serialized.required = field.required;
  if (field.unique !== undefined) serialized.unique = field.unique;
  if (field.localized !== undefined) serialized.localized = field.localized;
  if (field.hidden !== undefined) serialized.hidden = field.hidden;
  if (field.defaultValue !== undefined) serialized.defaultValue = field.defaultValue;
  if (field.admin !== undefined) serialized.admin = field.admin;

  if ((field.type === 'select' || field.type === 'radio') && 'options' in field) {
    serialized.options = field.options;
    if ('hasMany' in field && field.hasMany) serialized.hasMany = true;
  }

  if (field.type === 'relation' && 'relationTo' in field) {
    serialized.relationTo = field.relationTo;
    if ('hasMany' in field && field.hasMany) serialized.hasMany = true;
  }

  if (field.type === 'upload' && 'relationTo' in field) {
    serialized.relationTo = field.relationTo;
    if ('mimeTypes' in field && field.mimeTypes) serialized.mimeTypes = field.mimeTypes;
  }

  if (field.type === 'array') {
    serialized.fields = serializeFields(field.fields, accessArgs);
    if (field.minRows !== undefined) serialized.minRows = field.minRows;
    if (field.maxRows !== undefined) serialized.maxRows = field.maxRows;
  }

  if (field.type === 'group' || field.type === 'row' || field.type === 'collapsible') {
    serialized.fields = serializeFields(field.fields, accessArgs);
  }

  if (field.type === 'blocks') {
    serialized.blocks = field.blocks.map((blockDefinition) => ({
      slug: blockDefinition.slug,
      labels: blockDefinition.labels,
      fields: serializeFields(blockDefinition.fields, accessArgs),
    }));
  }

  if (field.type === 'tabs') {
    serialized.tabs = field.tabs.map((tab) => ({
      label: tab.label,
      fields: serializeFields(tab.fields, accessArgs),
    }));
  }

  if (field.access?.read && !decideAccess(field.access.read, accessArgs).allowed) {
    serialized.restricted = true;
  }

  return serialized;
}
