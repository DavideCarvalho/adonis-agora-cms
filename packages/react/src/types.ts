export type AdminField = {
  type: string;
  name: string;
  label?: unknown;
  required?: boolean;
  unique?: boolean;
  localized?: boolean;
  hidden?: boolean;
  defaultValue?: unknown;
  admin?: {
    position?: 'main' | 'sidebar';
    description?: string;
    component?: string;
    isSortable?: boolean;
    hiddenInList?: boolean;
    visibleWhen?: { field: string; equals: unknown };
  };
  options?: readonly { label: string; value: string }[];
  relationTo?: string | readonly string[];
  mimeTypes?: readonly string[];
  hasMany?: boolean;
  minRows?: number;
  maxRows?: number;
  fields?: AdminField[];
  blocks?: { slug: string; labels?: unknown; fields: AdminField[] }[];
  tabs?: { label: string; fields: AdminField[] }[];
  restricted?: boolean;
};

export type AdminCollection = {
  slug: string;
  kind: 'collection' | 'global';
  labels?: { singular: string; plural: string };
  admin?: {
    useAsTitle?: string;
    defaultColumns?: readonly string[];
    group?: string;
    visualEditor?: boolean;
  };
  versioned: boolean;
  drafts: boolean;
  softDelete?: boolean;
  autosave?: false | { interval: number };
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
  admin: {
    title: string;
    path: string;
    theme?: { accent?: string; logoUrl?: string };
    auth?: { builtin: boolean; collection: string };
  };
  locales: readonly string[];
  defaultLocale: string;
  tenancy: { strategy: string; required: boolean };
  collections: AdminCollection[];
  globals: AdminCollection[];
  user: unknown;
  permissions: Record<string, AdminPermission>;
};

/** An asset returned by the upload endpoint (matches the core `CmsUpload`). */
export type CmsUpload = {
  id: string;
  filename?: string;
  url?: string;
  mime?: string;
  width?: number;
  height?: number;
};

export type AdminDocument = Record<string, unknown> & {
  id?: string;
  _status?: 'draft' | 'published';
  /** Published, with an edit that is not live yet. */
  _hasDraft?: boolean;
};

export type ListResult = {
  docs: AdminDocument[];
  totalDocs: number;
  limit: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

export type ListQuery = {
  where?: Record<string, unknown>;
  sort?: string;
  limit?: number;
  page?: number;
  depth?: number;
  locale?: string;
  draft?: boolean;
  deleted?: boolean;
};

export type VersionRecord = {
  id: number;
  version: number;
  status: string;
  autosave: boolean;
  locale: string | null;
  createdBy: string | null;
  createdAt: string;
  isLatest: boolean;
  snapshot?: { doc?: AdminDocument };
};

export type DocumentSchedule = { action: 'publish' | 'unpublish'; at: string };
