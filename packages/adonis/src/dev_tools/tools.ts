import type { CmsConfig } from '../config/types.js';
import { resolveLocalization, resolveTenancy } from '../config/types.js';
import type { Cms } from '../local_api/index.js';
import { toRestError } from '../rest/errors.js';
import {
  handleCollectionFind,
  handleCollectionFindOne,
  handleCollectionVersion,
  handleCollectionVersions,
  handleGlobalGet,
  type RestRequest,
  type RestResponse,
} from '../rest/handlers.js';
import { listableFields } from '../rest/list.js';
import {
  type RegisterCmsRoutesOptions,
  type RouteContext,
  scopeCmsRequest,
  type WriteOperation,
} from '../rest/routes.js';
import {
  DEV_TOOLS_BINDING,
  type DevTool,
  type DevToolCall,
  type DevToolInputProperty,
  type DevToolsContainer,
  type DevToolsHub,
} from './contract.js';

/** What {@link cmsDevTools} needs: the app's CMS and the options its REST routes run with. */
export interface CmsDevToolsOptions {
  /** The app's CMS instance (unscoped: each call scopes it to the MCP request's principal). */
  cms: Cms<CmsConfig>;
  /**
   * How a request picks its principal, tenant and locale: the same options the REST routes get, so
   * a tool sees exactly what `GET /api/cms/...` would for that request.
   */
  request: Pick<
    RegisterCmsRoutesOptions,
    'requireUserForWrites' | 'resolveToken' | 'resolveContext' | 'resolveLocale'
  >;
}

/** List tools default to this many rows. */
const DEFAULT_LIMIT = 20;
/** List tools return at most this many rows. */
const MAX_LIMIT = 100;

/** Thrown from a tool to answer an MCP error result (the hub turns it into `isError`). */
class CmsDevToolError extends Error {}

const COLLECTION: DevToolInputProperty = {
  type: 'string',
  description: 'Collection slug (see cms_list_collections).',
};
const ID: DevToolInputProperty = { type: 'string', description: 'Document id.' };
const LOCALE: DevToolInputProperty = {
  type: 'string',
  description:
    'Locale of the returned content (default: the request locale; none returns localized fields as locale maps).',
};
const DRAFT: DevToolInputProperty = {
  type: 'boolean',
  description: 'Read the latest draft instead of the published version (needs draft access).',
};
const DEPTH: DevToolInputProperty = {
  type: 'integer',
  minimum: 0,
  maximum: 3,
  description: 'How deep relationships are populated (default 0).',
};
const SELECT: DevToolInputProperty = {
  type: 'array',
  items: { type: 'string' },
  description: 'Only these fields.',
};
const PAGE: DevToolInputProperty = {
  type: 'integer',
  minimum: 1,
  description: '1-based page (default 1).',
};
const LIMIT: DevToolInputProperty = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_LIMIT,
  description: `Rows (default ${DEFAULT_LIMIT}).`,
};
const DATA: DevToolInputProperty = {
  type: 'string',
  description:
    'Field values as a JSON object, e.g. {"title":"Hello"}; a localized field takes a locale map, {"title":{"en":"Hi","pt-BR":"Oi"}}. Field names follow cms_get_collection.',
};

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function required(input: Record<string, unknown>, key: string): string {
  const value = str(input, key);
  if (value === undefined) throw new CmsDevToolError(`${key} is required`);
  return value;
}

function limitOf(input: Record<string, unknown>, call: DevToolCall): number {
  const raw = input.limit;
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : DEFAULT_LIMIT;
  const cap = Math.min(MAX_LIMIT, call.limits.maxRows > 0 ? call.limits.maxRows : MAX_LIMIT);
  return Math.min(Math.max(n, 1), cap);
}

function pageOf(input: Record<string, unknown>): number {
  return typeof input.page === 'number' && input.page >= 1 ? Math.trunc(input.page) : 1;
}

/** Parse a JSON-object input (`data`, `filter`). */
function jsonObject(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const raw = str(input, key);
  if (raw === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new CmsDevToolError(`${key} must be valid JSON`);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CmsDevToolError(`${key} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** A REST error body as the tool's error message: code, message and the invalid fields. */
function describe(body: unknown, status: number): string {
  const error = (body as { error?: { code?: unknown; message?: unknown; fields?: unknown } } | null)
    ?.error;
  const message = typeof error?.message === 'string' ? error.message : `HTTP ${status}`;
  const code = typeof error?.code === 'string' ? `${error.code}: ` : '';
  const fields =
    error?.fields && typeof error.fields === 'object'
      ? ` (${Object.entries(error.fields as Record<string, unknown>)
          .map(([field, problem]) => `${field}: ${String(problem)}`)
          .join(', ')})`
      : '';
  return `${code}${message}${fields}`;
}

function unwrap(response: RestResponse): unknown {
  if (response.status >= 200 && response.status < 300) return response.body;
  throw new CmsDevToolError(describe(response.body, response.status));
}

/** Run a Local API write; CMS errors (validation, access, not found) become tool errors. */
async function write<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const response = toRestError(error);
    throw new CmsDevToolError(describe(response.body, response.status));
  }
}

/** The `{ data, meta }` page a REST list handler answers. */
interface ListPage {
  data: unknown[];
  meta: { total: number; currentPage: number; lastPage: number };
}

function listResult(body: ListPage) {
  return {
    items: body.data,
    next: body.meta.currentPage < body.meta.lastPage ? body.meta.currentPage + 1 : null,
    total: body.meta.total,
  };
}

type FieldLike = {
  name?: string;
  type: string;
  required?: boolean;
  localized?: boolean;
  relationTo?: string | readonly string[];
  options?: readonly ({ value: string } | string)[];
  fields?: readonly FieldLike[];
  tabs?: readonly { fields: readonly FieldLike[] }[];
  blocks?: readonly { slug: string; fields: readonly FieldLike[] }[];
};

function describeFields(fields: readonly FieldLike[]): unknown[] {
  return fields.map((field) => ({
    ...(field.name ? { name: field.name } : {}),
    type: field.type,
    ...(field.required ? { required: true } : {}),
    ...(field.localized ? { localized: true } : {}),
    ...(field.type !== 'password' && field.relationTo ? { relationTo: field.relationTo } : {}),
    ...(field.options
      ? {
          options: field.options.map((option) =>
            typeof option === 'string' ? option : option.value,
          ),
        }
      : {}),
    ...(field.fields ? { fields: describeFields(field.fields) } : {}),
    ...(field.tabs ? { tabs: field.tabs.map((tab) => describeFields(tab.fields)) } : {}),
    ...(field.blocks
      ? {
          blocks: field.blocks.map((block) => ({
            slug: block.slug,
            fields: describeFields(block.fields),
          })),
        }
      : {}),
  }));
}

/**
 * The CMS's developer tools for the agora MCP hub (`/mcp/agora`), under `cms_*` names. Every call
 * scopes the CMS to the MCP request exactly like a REST call (`Authorization: Bearer` CMS API token,
 * else the app's signed-in user and tenant), so the collections' `access` rules, drafts, locales,
 * hooks and versions apply. Reads are listed by default; writes are `action` tools the app opts into.
 */
export function cmsDevTools(options: CmsDevToolsOptions): DevTool[] {
  const { cms } = options;

  /** The CMS this request acts as, or a tool error with the REST refusal. */
  async function scoped(
    call: DevToolCall,
    request: { write: boolean; slug?: string; operation?: WriteOperation },
  ): Promise<Cms<CmsConfig>> {
    const result = await scopeCmsRequest(cms, call.ctx as RouteContext, options.request, {
      write: request.write,
      slug: request.slug,
      operation: request.operation ?? 'update',
    });
    if (!result.ok) throw new CmsDevToolError(describe(result.body, result.status));
    return result.cms;
  }

  function localeOf(input: Record<string, unknown>, call: DevToolCall): string | undefined {
    const explicit = str(input, 'locale');
    if (explicit !== undefined) return explicit;
    try {
      return options.request.resolveLocale?.(call.ctx as RouteContext);
    } catch {
      return undefined;
    }
  }

  /** The read options a REST query string carries (`locale`, `draft`, `depth`, `select`). */
  function readQuery(input: Record<string, unknown>, call: DevToolCall): Record<string, unknown> {
    const query: Record<string, unknown> = {};
    const locale = localeOf(input, call);
    if (locale !== undefined) query.locale = locale;
    if (input.draft === true) query.draft = 'true';
    if (typeof input.depth === 'number') query.depth = String(input.depth);
    if (Array.isArray(input.select) && input.select.length > 0) query.select = input.select;
    return query;
  }

  function target(slug: string) {
    const config = cms.config;
    const item =
      config.collections?.find((entry) => entry.slug === slug) ??
      config.globals?.find((entry) => entry.slug === slug);
    if (!item) throw new CmsDevToolError(`CMS_NOT_FOUND: unknown collection or global "${slug}"`);
    return item;
  }

  return [
    {
      name: 'cms_list_collections',
      kind: 'read',
      description:
        'The content model: every collection and global with its slug, labels and whether it has drafts, versions and soft delete; plus the locales and the tenancy strategy. Call it first. Returns { items, next, locales, defaultLocale, tenancy }.',
      input: { type: 'object', properties: {} },
      run: async () => {
        const config = cms.config;
        const localization = resolveLocalization(config);
        const items = [
          ...(config.collections ?? []).map((item) => ({
            slug: item.slug,
            kind: 'collection' as const,
            labels: item.labels,
            versioned: Boolean(item.versions) || Boolean(config.versions),
            drafts: Boolean(
              (item.versions as { drafts?: unknown } | undefined)?.drafts ??
                (config.versions as { drafts?: unknown } | undefined)?.drafts,
            ),
            softDelete: Boolean(item.softDelete),
          })),
          ...(config.globals ?? []).map((item) => ({
            slug: item.slug,
            kind: 'global' as const,
            labels: item.labels,
          })),
        ];
        return {
          items,
          next: null,
          locales: localization.locales,
          defaultLocale: localization.defaultLocale,
          tenancy: resolveTenancy(config).strategy,
        };
      },
    },
    {
      name: 'cms_get_collection',
      kind: 'read',
      description:
        "One collection's (or global's) fields: name, type, required, localized, options, relations, nested fields and blocks; for a collection also the fields `cms_list_documents` can filter and sort by.",
      input: {
        type: 'object',
        properties: { slug: { type: 'string', description: 'Collection or global slug.' } },
        required: ['slug'],
      },
      run: async (input) => {
        const slug = required(input, 'slug');
        const item = target(slug);
        const isCollection = cms.config.collections?.some((entry) => entry.slug === slug) ?? false;
        let listing: { filterable: string[]; sortable: readonly string[] } | undefined;
        if (isCollection) {
          try {
            const fields = listableFields(cms.spec, cms.config, slug);
            listing = { filterable: [...fields.filterable], sortable: fields.sortable };
          } catch {
            listing = undefined;
          }
        }
        return {
          slug,
          kind: isCollection ? 'collection' : 'global',
          fields: describeFields(item.fields as readonly FieldLike[]),
          ...(listing ?? {}),
        };
      },
    },
    {
      name: 'cms_list_documents',
      kind: 'read',
      description:
        'List documents of a collection, as `GET /api/cms/collections/:slug` answers for this caller (access rules apply; drafts only with `draft: true` and draft access). `filter` is a JSON object: {"title":{"contains":"news"},"_status":"published"} (operators: equals, notEquals, gt, gte, lt, lte, contains, iContains, startsWith, endsWith, in, notIn, isNull, isNotNull, between). Paged: pass `next` back as `page`. Returns { items, next, total }.',
      input: {
        type: 'object',
        properties: {
          collection: COLLECTION,
          filter: { type: 'string', description: 'Filters as a JSON object (see description).' },
          sort: { type: 'string', description: 'e.g. `-createdAt` or `title,-updatedAt`.' },
          page: PAGE,
          limit: LIMIT,
          draft: DRAFT,
          locale: LOCALE,
          depth: DEPTH,
          select: SELECT,
          deleted: { type: 'boolean', description: 'Include soft-deleted documents.' },
        },
        required: ['collection'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const filter = jsonObject(input, 'filter');
        const query: Record<string, unknown> = {
          ...readQuery(input, call),
          ...(Object.keys(filter).length > 0 ? { filter } : {}),
          page: String(pageOf(input)),
          size: String(limitOf(input, call)),
        };
        const sort = str(input, 'sort');
        if (sort !== undefined) query.sort = sort;
        if (input.deleted === true) query.deleted = 'true';
        const body = unwrap(
          await handleCollectionFind(await scoped(call, { write: false, slug }), {
            params: { slug },
            query,
            body: undefined,
          } satisfies RestRequest),
        ) as ListPage;
        return listResult(body);
      },
    },
    {
      name: 'cms_get_document',
      kind: 'read',
      description:
        'One document by id, as `GET /api/cms/collections/:slug/:id` answers for this caller. `draft: true` reads the latest draft.',
      input: {
        type: 'object',
        properties: {
          collection: COLLECTION,
          id: ID,
          draft: DRAFT,
          locale: LOCALE,
          depth: DEPTH,
          select: SELECT,
        },
        required: ['collection', 'id'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const id = required(input, 'id');
        return unwrap(
          await handleCollectionFindOne(await scoped(call, { write: false, slug }), {
            params: { slug, id },
            query: readQuery(input, call),
            body: undefined,
          }),
        );
      },
    },
    {
      name: 'cms_list_versions',
      kind: 'read',
      description:
        "A document's version history, newest first: version number, status, locale, author and time (no content; use cms_get_version). Paged: pass `next` back as `page`. Returns { items, next, total }.",
      input: {
        type: 'object',
        properties: {
          collection: COLLECTION,
          id: ID,
          locale: { type: 'string', description: 'Only versions of this locale.' },
          page: PAGE,
          limit: LIMIT,
        },
        required: ['collection', 'id'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const id = required(input, 'id');
        const locale = str(input, 'locale');
        const body = unwrap(
          await handleCollectionVersions(await scoped(call, { write: false, slug }), {
            params: { slug, id },
            query: {
              ...(locale !== undefined ? { filter: { locale } } : {}),
              page: String(pageOf(input)),
              size: String(limitOf(input, call)),
            },
            body: undefined,
          }),
        ) as ListPage;
        return listResult(body);
      },
    },
    {
      name: 'cms_get_version',
      kind: 'read',
      description:
        "One version of a document. `snapshot: true` adds the version's full content (it can hold draft content, so it needs draft access).",
      input: {
        type: 'object',
        properties: {
          collection: COLLECTION,
          id: ID,
          version: { type: 'integer', minimum: 1, description: 'Version number.' },
          snapshot: { type: 'boolean', description: 'Include the full content.' },
        },
        required: ['collection', 'id', 'version'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const id = required(input, 'id');
        const version = Number(input.version);
        if (!Number.isInteger(version) || version < 1) {
          throw new CmsDevToolError('version must be a positive integer');
        }
        return unwrap(
          await handleCollectionVersion(await scoped(call, { write: false, slug }), {
            params: { slug, id, version: String(version) },
            query: input.snapshot === true ? { snapshot: 'true' } : {},
            body: undefined,
          }),
        );
      },
    },
    {
      name: 'cms_get_global',
      kind: 'read',
      description:
        'A global (single-row document), as `GET /api/cms/globals/:slug` answers for this caller.',
      input: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Global slug.' },
          draft: DRAFT,
          locale: LOCALE,
          depth: DEPTH,
          select: SELECT,
        },
        required: ['slug'],
      },
      run: async (input, call) => {
        const slug = required(input, 'slug');
        return unwrap(
          await handleGlobalGet(await scoped(call, { write: false, slug }), {
            params: { slug },
            query: readQuery(input, call),
            body: undefined,
          }),
        );
      },
    },
    {
      name: 'cms_create_document',
      kind: 'action',
      description:
        'Create a document (hooks, validation and `access.create` apply). On a collection with drafts, `draft: true` creates it unpublished. Returns the document; a validation error names the fields.',
      input: {
        type: 'object',
        properties: { collection: COLLECTION, data: DATA, draft: DRAFT, locale: LOCALE },
        required: ['collection', 'data'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const data = jsonObject(input, 'data');
        const scope = await scoped(call, { write: true, slug, operation: 'create' });
        const locale = localeOf(input, call);
        return write(() =>
          scope.collection(slug).create(data as never, {
            ...(input.draft === true ? { draft: true } : {}),
            ...(locale !== undefined ? { locale } : {}),
          }),
        );
      },
    },
    {
      name: 'cms_update_document',
      kind: 'action',
      description:
        'Update fields of a document (unlisted fields are kept; `access.update` applies). On a published document with drafts, `draft: true` saves the edit as a pending draft and leaves what is live untouched. Returns the document.',
      input: {
        type: 'object',
        properties: {
          collection: COLLECTION,
          id: ID,
          data: DATA,
          draft: {
            type: 'boolean',
            description: 'Keep the edit as a draft instead of changing the live version.',
          },
          locale: LOCALE,
        },
        required: ['collection', 'id', 'data'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const id = required(input, 'id');
        const data = jsonObject(input, 'data');
        const scope = await scoped(call, { write: true, slug, operation: 'update' });
        const locale = localeOf(input, call);
        return write(() =>
          scope.collection(slug).update(id, data as never, {
            ...(input.draft === true ? { asDraft: true } : {}),
            ...(locale !== undefined ? { locale } : {}),
          }),
        );
      },
    },
    {
      name: 'cms_publish_document',
      kind: 'action',
      description: "Publish a document's latest draft. Returns the published document.",
      input: {
        type: 'object',
        properties: { collection: COLLECTION, id: ID },
        required: ['collection', 'id'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const id = required(input, 'id');
        const scope = await scoped(call, { write: true, slug, operation: 'update' });
        return write(() => scope.collection(slug).publish(id));
      },
    },
    {
      name: 'cms_unpublish_document',
      kind: 'action',
      description:
        'Take a published document offline (it goes back to draft). Returns the document.',
      input: {
        type: 'object',
        properties: { collection: COLLECTION, id: ID },
        required: ['collection', 'id'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const id = required(input, 'id');
        const scope = await scoped(call, { write: true, slug, operation: 'update' });
        return write(() => scope.collection(slug).unpublish(id));
      },
    },
    {
      name: 'cms_delete_document',
      kind: 'action',
      destructive: true,
      description:
        'Delete a document (`access.delete` applies). A collection with soft delete moves it to the trash; `force: true` removes it for good. Returns { deleted }.',
      input: {
        type: 'object',
        properties: {
          collection: COLLECTION,
          id: ID,
          force: { type: 'boolean', description: 'Remove for good instead of trashing.' },
        },
        required: ['collection', 'id'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const id = required(input, 'id');
        const scope = await scoped(call, { write: true, slug, operation: 'delete' });
        await write(() =>
          scope.collection(slug).delete(id, input.force === true ? { force: true } : undefined),
        );
        return { deleted: id };
      },
    },
    {
      name: 'cms_restore_version',
      kind: 'action',
      description:
        "Replace a document's content with one of its versions (the current content stays in the history). Returns the document.",
      input: {
        type: 'object',
        properties: {
          collection: COLLECTION,
          id: ID,
          version: { type: 'integer', minimum: 1, description: 'Version number to restore.' },
        },
        required: ['collection', 'id', 'version'],
      },
      run: async (input, call) => {
        const slug = required(input, 'collection');
        const id = required(input, 'id');
        const version = Number(input.version);
        if (!Number.isInteger(version) || version < 1) {
          throw new CmsDevToolError('version must be a positive integer');
        }
        const scope = await scoped(call, { write: true, slug, operation: 'update' });
        return write(() => scope.collection(slug).restoreVersion(id, version));
      },
    },
    {
      name: 'cms_update_global',
      kind: 'action',
      description:
        'Update fields of a global (unlisted fields are kept; `access.update` applies). Returns the global.',
      input: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Global slug.' },
          data: DATA,
          locale: LOCALE,
        },
        required: ['slug', 'data'],
      },
      run: async (input, call) => {
        const slug = required(input, 'slug');
        const data = jsonObject(input, 'data');
        const scope = await scoped(call, { write: true, slug, operation: 'update' });
        const locale = localeOf(input, call);
        return write(() =>
          scope.global(slug).update(data as never, locale !== undefined ? { locale } : undefined),
        );
      },
    },
  ];
}

/**
 * Register the CMS tools into the app's dev-tools hub, when `@adonis-agora/agent/mcp_provider` bound
 * one and it can gate a lib without a console (`supports('endpoint-authorize')`). Never throws:
 * returns why it did not register.
 */
export async function registerCmsDevTools(
  container: DevToolsContainer,
  options: CmsDevToolsOptions,
): Promise<'registered' | 'no-hub' | 'unsupported' | 'failed'> {
  if (!container.hasBinding(DEV_TOOLS_BINDING)) return 'no-hub';
  try {
    const hub = (await container.make(DEV_TOOLS_BINDING)) as Partial<DevToolsHub> | undefined;
    if (hub?.version !== 1 || typeof hub.register !== 'function') return 'unsupported';
    if (typeof hub.supports !== 'function' || !hub.supports('endpoint-authorize')) {
      return 'unsupported';
    }
    hub.register({ lib: 'cms', title: 'CMS content', tools: cmsDevTools(options) });
    return 'registered';
  } catch {
    return 'failed';
  }
}
