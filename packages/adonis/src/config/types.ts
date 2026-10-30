/**
 * Configuration types.
 *
 * These describe the *shape* a user writes in `config/cms.ts`. Everything here is plain data:
 * no classes, no getters, no functions that need `this`. That is what makes the config
 * serializable to the admin panel and hashable for drift detection.
 */

export type LocaleCode = string;

export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'password'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'select'
  | 'radio'
  | 'json'
  | 'code'
  | 'slug'
  | 'richText'
  | 'relation'
  | 'upload'
  | 'array'
  | 'group'
  | 'blocks'
  | 'tabs'
  | 'row'
  | 'collapsible';

export type Labels = {
  singular: string;
  plural: string;
};

export type AdminPosition = 'main' | 'sidebar';

export type FieldAdmin = {
  position?: AdminPosition;
  description?: string;
  /** Component id registered in the admin `FieldRegistry`. */
  component?: string;
  placeholder?: string;
  /** Shown only when the predicate holds for the current form value. */
  condition?: (data: Record<string, unknown>) => boolean;
  /** Hide from the list view. */
  hiddenInList?: boolean;
};

export type FieldAccess = {
  read?: AccessFn;
  update?: AccessFn;
};

export type FieldValidator = (args: {
  value: unknown;
  data: Record<string, unknown>;
  locale?: LocaleCode;
}) => string | undefined | Promise<string | undefined>;

export type FieldHook = (args: {
  value: unknown;
  data: Record<string, unknown>;
  locale?: LocaleCode;
}) => unknown | Promise<unknown>;

export type FieldHooks = {
  beforeValidate?: readonly FieldHook[];
  beforeChange?: readonly FieldHook[];
  afterRead?: readonly FieldHook[];
};

export type FieldCommon = {
  name: string;
  label?: string | Record<LocaleCode, string>;
  required?: boolean;
  unique?: boolean;
  index?: boolean;
  localized?: boolean;
  defaultValue?: unknown;
  hidden?: boolean;
  admin?: FieldAdmin;
  access?: FieldAccess;
  validate?: FieldValidator;
  hooks?: FieldHooks;
};

export type SelectOption<Value extends string = string> = {
  label: string;
  value: Value;
};

export type TextField = FieldCommon & {
  type: 'text';
  maxLength?: number;
  minLength?: number;
  pattern?: string;
};

export type TextareaField = FieldCommon & {
  type: 'textarea';
  maxLength?: number;
};

export type EmailField = FieldCommon & {
  type: 'email';
};

export type PasswordField = FieldCommon & {
  type: 'password';
  /** Hook name used to hash the value; defaults to the configured auth adapter. */
  hashWith?: string;
};

export type NumberFormat = 'int' | 'float' | 'decimal';

export type NumberField = FieldCommon & {
  type: 'number';
  format?: NumberFormat;
  min?: number;
  max?: number;
  precision?: number;
  scale?: number;
};

export type CheckboxField = FieldCommon & {
  type: 'checkbox';
};

export type DateField = FieldCommon & {
  type: 'date';
  withTime?: boolean;
};

export type SelectField<Options extends readonly SelectOption[] = readonly SelectOption[]> =
  FieldCommon & {
    type: 'select';
    hasMany?: boolean;
    options: Options;
  };

export type RadioField<Options extends readonly SelectOption[] = readonly SelectOption[]> =
  FieldCommon & {
    type: 'radio';
    options: Options;
  };

export type JsonField = FieldCommon & {
  type: 'json';
};

export type CodeField = FieldCommon & {
  type: 'code';
  language?: string;
};

export type SlugField = FieldCommon & {
  type: 'slug';
  /** Field used to derive the slug when the value is empty. */
  from?: string;
};

export type RichTextField = FieldCommon & {
  type: 'richText';
  /** Editor id; defaults to the configured `RichTextEditor`. */
  editor?: string;
};

export type RelationField = FieldCommon & {
  type: 'relation';
  relationTo: string | readonly string[];
  hasMany?: boolean;
};

export type UploadField = FieldCommon & {
  type: 'upload';
  relationTo: string;
  /** Restrict accepted MIME types, e.g. `['image/*']`. */
  mimeTypes?: readonly string[];
};

export type ArrayField = FieldCommon & {
  type: 'array';
  fields: readonly FieldConfig[];
  minRows?: number;
  maxRows?: number;
};

export type GroupField = FieldCommon & {
  type: 'group';
  fields: readonly FieldConfig[];
};

export type BlockDefinition = {
  slug: string;
  labels?: Labels;
  fields: readonly FieldConfig[];
  admin?: {
    icon?: string;
    description?: string;
  };
};

export type BlocksField = FieldCommon & {
  type: 'blocks';
  blocks: readonly BlockDefinition[];
  minRows?: number;
  maxRows?: number;
};

/** Structural fields: they only reorganize the admin form, never the database. */
export type TabsField = FieldCommon & {
  type: 'tabs';
  tabs: readonly {
    label: string;
    fields: readonly FieldConfig[];
  }[];
};

export type RowField = FieldCommon & {
  type: 'row';
  fields: readonly FieldConfig[];
};

export type CollapsibleField = FieldCommon & {
  type: 'collapsible';
  fields: readonly FieldConfig[];
};

export type FieldConfig =
  | TextField
  | TextareaField
  | EmailField
  | PasswordField
  | NumberField
  | CheckboxField
  | DateField
  | SelectField
  | RadioField
  | JsonField
  | CodeField
  | SlugField
  | RichTextField
  | RelationField
  | UploadField
  | ArrayField
  | GroupField
  | BlocksField
  | TabsField
  | RowField
  | CollapsibleField;

export type WhereConstraint =
  | { and: readonly WhereConstraint[] }
  | { or: readonly WhereConstraint[] }
  | { field: string; operator: string; value: unknown };

export type AccessArgs = {
  req: unknown;
  user: unknown;
  id?: string;
  data?: Record<string, unknown>;
  locale?: LocaleCode;
};

export type AccessFn = (args: AccessArgs) => boolean | WhereConstraint;

export type CollectionAccess = {
  read?: AccessFn;
  create?: AccessFn;
  update?: AccessFn;
  delete?: AccessFn;
};

export type ChangeHookArgs = {
  data: Record<string, unknown>;
  previousData?: Record<string, unknown>;
  operation: 'create' | 'update';
  req: unknown;
  user: unknown;
  locale?: LocaleCode;
};

export type ReadHookArgs = {
  doc: Record<string, unknown>;
  req: unknown;
  user: unknown;
  locale?: LocaleCode;
  depth: number;
};

export type DeleteHookArgs = {
  id: string;
  doc: Record<string, unknown>;
  req: unknown;
  user: unknown;
};

export type CollectionHooks = {
  beforeValidate?: readonly ((args: ChangeHookArgs) => unknown)[];
  beforeChange?: readonly ((args: ChangeHookArgs) => unknown)[];
  afterChange?: readonly ((args: ChangeHookArgs & { doc: Record<string, unknown> }) => unknown)[];
  beforeRead?: readonly ((args: ReadHookArgs) => unknown)[];
  afterRead?: readonly ((args: ReadHookArgs) => unknown)[];
  beforeDelete?: readonly ((args: DeleteHookArgs) => unknown)[];
  afterDelete?: readonly ((args: DeleteHookArgs) => unknown)[];
};

export type VersionsConfig = {
  drafts?: boolean;
  autosave?: false | { interval: number };
  /** `null` keeps full history. A number prunes per document, always keeping the last publish. */
  retention?: number | null;
};

export type CollectionAdmin = {
  useAsTitle?: string;
  defaultColumns?: readonly string[];
  group?: string;
  description?: string;
  icon?: string;
  livePreview?: {
    url?: string;
  };
};

export type CollectionConfigInput = {
  fields: readonly FieldConfig[];
  labels?: Labels;
  admin?: CollectionAdmin;
  access?: CollectionAccess;
  hooks?: CollectionHooks;
  versions?: VersionsConfig;
  timestamps?: boolean;
};

export type CollectionConfig = CollectionConfigInput & {
  slug: string;
};

export type GlobalConfigInput = {
  fields: readonly FieldConfig[];
  labels?: Labels;
  admin?: CollectionAdmin;
  access?: Omit<CollectionAccess, 'create' | 'delete'>;
  hooks?: CollectionHooks;
  versions?: VersionsConfig;
};

export type GlobalConfig = GlobalConfigInput & {
  slug: string;
};

export type SchemaMode = 'managed' | 'migrations' | 'manual';

export type DbConfig = {
  schema?: SchemaMode;
  tablePrefix?: string;
  id?: 'uuid' | 'increment';
  /** Allow dropping CMS tables/columns that are no longer in the config. */
  prune?: boolean;
  /** Explicit renames, keyed by `collection.field` or `collection.array.field`. */
  renames?: Record<string, string>;
};

export type AdminConfig = {
  path?: string;
  auth?: 'cms' | 'authkit' | 'custom';
  title?: string;
  livePreview?: {
    url?: string;
  };
};

export type LocalizationConfig = {
  locales: readonly LocaleCode[];
  defaultLocale: LocaleCode;
  fallback?: boolean;
  /** `default` = required only in the default locale; `all` = required everywhere. */
  localizedRequired?: 'default' | 'all';
};

export type IntegrationsConfig = {
  media?: boolean;
  authkit?: boolean;
  authz?: boolean;
  telescope?: boolean;
  durable?: boolean;
};

/** Context handed to the tenant resolver. Never used inside the compiler (which stays pure). */
export type TenantContext = {
  hostname: string;
  path: string;
  request: unknown;
};

export type TenantId = string;

export type TenantOverride = {
  /** Per-tenant admin branding/navigation. Columns are never affected in `row` mode. */
  admin?: AdminConfig;
  collections?: {
    /** Slugs visible to this tenant. Default: all collections. */
    only?: readonly string[];
    labels?: Record<string, Labels>;
  };
  globals?: {
    only?: readonly string[];
  };
};

export type TenancyConfig = {
  /**
   * `row`: one schema, every table carries `_tenant_id` and queries are scoped automatically.
   * `database`: one connection per tenant, resolved at request time; configs may differ.
   */
  strategy?: 'row' | 'database';
  /** Resolves the tenant for an HTTP request. Default: leftmost subdomain of the host. */
  resolve?: (context: TenantContext) => TenantId | null | Promise<TenantId | null>;
  /** Row strategy: refuse documents without a tenant (default `true`). */
  required?: boolean;
  /** Row strategy: per-tenant admin/label overrides. Cannot add or remove columns. */
  overrides?: Record<TenantId, TenantOverride>;
  /** Database strategy: Lucid connection name for a tenant. */
  connection?: (tenantId: TenantId) => string;
};

export type ResolvedTenancy = {
  strategy: 'single' | 'row' | 'database';
  required: boolean;
  column: string | null;
  resolve: (context: TenantContext) => TenantId | null | Promise<TenantId | null>;
  overrides: Record<TenantId, TenantOverride>;
  connection: ((tenantId: TenantId) => string) | null;
};

export type RestConfig = {
  enabled?: boolean;
  /** Base path for the generated routes. Defaults to `/api/cms`. */
  prefix?: string;
};

export type CmsConfigInput = {
  collections?: readonly CollectionConfig[];
  rest?: RestConfig;
  globals?: readonly GlobalConfig[];
  db?: DbConfig;
  admin?: AdminConfig;
  localization?: LocalizationConfig;
  versions?: VersionsConfig;
  integrations?: IntegrationsConfig;
  tenancy?: TenancyConfig;
  /** Custom field types, registered by `defineField`. */
  fieldTypes?: readonly string[];
};

export type CmsConfig = CmsConfigInput;

export type ResolvedDbConfig = {
  schema: SchemaMode;
  tablePrefix: string;
  id: 'uuid' | 'increment';
  prune: boolean;
  renames: Record<string, string>;
};

export type ResolvedLocalization = {
  locales: readonly LocaleCode[];
  defaultLocale: LocaleCode;
  fallback: boolean;
  localizedRequired: 'default' | 'all';
};

/** Applies defaults without mutating the user config. */
export function resolveDbConfig(config: CmsConfig): ResolvedDbConfig {
  return {
    schema: config.db?.schema ?? 'managed',
    tablePrefix: config.db?.tablePrefix ?? 'cms_',
    id: config.db?.id ?? 'uuid',
    prune: config.db?.prune ?? false,
    renames: config.db?.renames ?? {},
  };
}

export function resolveLocalization(config: CmsConfig): ResolvedLocalization {
  return {
    locales: config.localization?.locales ?? [],
    defaultLocale: config.localization?.defaultLocale ?? 'en',
    fallback: config.localization?.fallback ?? true,
    localizedRequired: config.localization?.localizedRequired ?? 'default',
  };
}

/** Default resolver: `acme.example.com` → `acme`; `example.com` → `null`. */
export function hostnameTenant(context: TenantContext): TenantId | null {
  const host = context.hostname.split(':')[0] ?? '';
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 3) return null;
  const candidate = parts[0] ?? '';
  if (candidate === 'www' || candidate === 'admin') return null;
  return candidate;
}

export function resolveTenancy(config: CmsConfig): ResolvedTenancy {
  const configured = config.tenancy;
  const strategy = configured?.strategy ?? 'single';

  if (strategy === 'single') {
    return {
      strategy: 'single',
      required: false,
      column: null,
      resolve: () => null,
      overrides: {},
      connection: null,
    };
  }

  if (strategy === 'row') {
    return {
      strategy: 'row',
      required: configured?.required ?? true,
      column: '_tenant_id',
      resolve: configured?.resolve ?? hostnameTenant,
      overrides: configured?.overrides ?? {},
      connection: null,
    };
  }

  return {
    strategy: 'database',
    required: false,
    column: null,
    resolve: configured?.resolve ?? hostnameTenant,
    overrides: configured?.overrides ?? {},
    connection: configured?.connection ?? null,
  };
}
