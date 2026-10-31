import { collection } from '../config/collection.js';
import { fields } from '../config/fields.js';
import type { AccessFn, CmsConfigInput, CollectionConfig } from '../config/types.js';
import { CmsValidationError } from '../errors.js';

/** A plugin is a function from config to config: it adds collections, fields, hooks. */
export type CmsPlugin = (config: CmsConfigInput) => CmsConfigInput;

/**
 * `export default withPlugins(defineConfig({ ... }), [seoPlugin({ collections: ['pages'] })])`
 *
 * Separate from `defineConfig`, which stays an identity function so literal types survive.
 */
export function withPlugins<const C extends CmsConfigInput>(
  config: C,
  plugins: readonly CmsPlugin[],
): C {
  return plugins.reduce<CmsConfigInput>((current, plugin) => plugin(current), config) as C;
}

/**
 * Adds `folder` and `focalPoint` to the given media collections: the library browses by folder, and
 * `focalPoint` is `{ x, y }` from 0 to 1, for `object-position` when a front end crops the image.
 */
export function mediaPlugin(options: { collections: readonly string[] }): CmsPlugin {
  return (config) => ({
    ...config,
    collections: (config.collections ?? []).map((item) =>
      options.collections.includes(item.slug)
        ? ({
            ...item,
            fields: [
              ...item.fields,
              fields.text('folder'),
              fields.json('focalPoint', { admin: { component: 'focal-point' } }),
            ],
          } as CollectionConfig)
        : item,
    ),
  });
}

/** Adds a `seo` group (title, description, noindex) to the given collections. */
export function seoPlugin(options: { collections: readonly string[] }): CmsPlugin {
  return (config) => ({
    ...config,
    collections: (config.collections ?? []).map((item) =>
      options.collections.includes(item.slug)
        ? ({
            ...item,
            fields: [
              ...item.fields,
              fields.group('seo', {
                label: 'SEO',
                fields: [
                  fields.text('metaTitle', { label: 'Meta title' }),
                  fields.textarea('metaDescription', { label: 'Meta description' }),
                  fields.checkbox('noIndex', { label: 'Hide from search engines' }),
                ],
              }),
            ],
          } as CollectionConfig)
        : item,
    ),
  });
}

export const REDIRECTS_SLUG = 'redirects';

/** Adds a `redirects` collection the site reads with `findRedirect`. */
export function redirectsPlugin(): CmsPlugin {
  return (config) => ({
    ...config,
    collections: [
      ...(config.collections ?? []),
      collection(REDIRECTS_SLUG, {
        labels: { singular: 'Redirect', plural: 'Redirects' },
        admin: { useAsTitle: 'from', defaultColumns: ['from', 'to', 'permanent'] },
        versions: { drafts: false },
        fields: [
          fields.text('from', { required: true, unique: true }),
          fields.text('to', { required: true }),
          fields.checkbox('permanent', { defaultValue: true }),
        ],
      }) as CollectionConfig,
    ],
  });
}

type RedirectReader = {
  collection(slug: string): {
    find(query: {
      where: Record<string, unknown>;
      limit: number;
    }): Promise<{ docs: readonly unknown[] }>;
  };
};

/** The redirect for a request path, or null. Call it from a middleware before routing. */
export async function findRedirect(
  cms: RedirectReader,
  path: string,
): Promise<{ to: string; status: 301 | 302 } | null> {
  const { docs } = await cms
    .collection(REDIRECTS_SLUG)
    .find({ where: { from: { equals: path } }, limit: 1 });
  const hit = docs[0] as { to?: string; permanent?: boolean } | undefined;
  if (!hit?.to) return null;
  return { to: hit.to, status: hit.permanent === false ? 302 : 301 };
}

/* ------------------------------------------------------------------- search */

export const SEARCH_SLUG = 'search';

type SearchSource = {
  /** Field shown as the result's title. */
  title: string;
  /** Plain text fields to match against. */
  text?: readonly string[];
};

/**
 * A `search` collection kept in step with the given ones after each commit. Only published documents
 * go in, so it can be read publicly: `find({ where: { text: { icontains: term } } })`.
 */
export function searchPlugin(options: { collections: Record<string, SearchSource> }): CmsPlugin {
  return (config) => ({
    ...config,
    collections: [
      ...(config.collections ?? []),
      collection(SEARCH_SLUG, {
        labels: { singular: 'Search result', plural: 'Search results' },
        admin: { useAsTitle: 'title', defaultColumns: ['title', 'sourceCollection'] },
        versions: { drafts: false },
        access: { create: () => false, update: () => false, delete: () => false },
        fields: [
          fields.text('title'),
          fields.textarea('text'),
          fields.text('sourceCollection'),
          fields.text('sourceId'),
        ],
      }) as CollectionConfig,
    ],
    listeners: [
      ...(config.listeners ?? []),
      async (event, cms) => {
        const source = options.collections[event.collection];
        if (!source) return;
        await syncSearchEntry(cms as SearchCms, event, source);
      },
    ],
  });
}

type SearchCms = {
  collection(slug: string): {
    find(query: unknown, options?: unknown): Promise<{ docs: { id: string }[] }>;
    create(data: unknown, options?: unknown): Promise<unknown>;
    update(id: string, data: unknown, options?: unknown): Promise<unknown>;
    delete(id: string, options?: unknown): Promise<unknown>;
  };
};

async function syncSearchEntry(
  cms: SearchCms,
  event: {
    collection: string;
    operation: string;
    documentId: string;
    doc?: Record<string, unknown>;
  },
  source: SearchSource,
): Promise<void> {
  // `silent`: an index entry is bookkeeping, not a change anyone subscribed to.
  const internal = { overrideAccess: true, silent: true };
  const entries = cms.collection(SEARCH_SLUG);
  const { docs } = await entries.find(
    {
      where: {
        sourceCollection: { equals: event.collection },
        sourceId: { equals: event.documentId },
      },
      limit: 1,
      depth: 0,
    },
    internal,
  );
  const existing = docs[0];

  const live = event.operation !== 'delete' && event.doc && event.doc._status !== 'draft';
  if (!live) {
    if (existing) await entries.delete(existing.id, { ...internal, force: true });
    return;
  }

  const doc = event.doc as Record<string, unknown>;
  const data = {
    title: String(doc[source.title] ?? ''),
    text: [source.title, ...(source.text ?? [])]
      .map((name) => doc[name])
      .filter((value) => typeof value === 'string')
      .join(' '),
    sourceCollection: event.collection,
    sourceId: event.documentId,
  };
  if (existing) await entries.update(existing.id, data, internal);
  else await entries.create(data, internal);
}

/* -------------------------------------------------------------- nested docs */

const MAX_DEPTH = 32;

/**
 * Pages inside pages: a `parent` relation and `breadcrumbs` worked out on save. A document cannot end
 * up under itself. Moving a parent does not rewrite its children until they are saved again.
 */
export function nestedDocsPlugin(options: {
  collections: readonly string[];
  /** Field used in a crumb. Default `title`. */
  titleField?: string;
}): CmsPlugin {
  const titleField = options.titleField ?? 'title';

  return (config) => ({
    ...config,
    collections: (config.collections ?? []).map((item) => {
      if (!options.collections.includes(item.slug)) return item;
      const slug = item.slug;
      return {
        ...item,
        fields: [
          ...item.fields,
          fields.relation('parent', { relationTo: slug }),
          fields.json('breadcrumbs', { admin: { hiddenInList: true } }),
        ],
        hooks: {
          ...item.hooks,
          beforeChange: [
            ...(item.hooks?.beforeChange ?? []),
            async ({
              data,
              previousData,
            }: {
              data: Record<string, unknown>;
              previousData?: Record<string, unknown>;
            }) => {
              const id = previousData?.id as string | undefined;
              const read = (await import('../../services/main.js')).getCms();
              const parentId = relationId(data.parent);
              const crumbs: { id: string; title: string }[] = [];
              const seen = new Set<string>(id ? [id] : []);

              for (let next = parentId; next; ) {
                if (seen.has(next) || crumbs.length >= MAX_DEPTH) {
                  throw new CmsValidationError({ parent: 'a page cannot be inside itself' });
                }
                seen.add(next);
                const parent = (await read
                  .collection(slug as never)
                  .findByID(next as never, { depth: 0, overrideAccess: true } as never)) as Record<
                  string,
                  unknown
                > | null;
                if (!parent) break;
                crumbs.unshift({ id: next, title: String(parent[titleField] ?? '') });
                next = relationId(parent.parent);
              }
              return { ...data, breadcrumbs: crumbs };
            },
          ],
        },
      } as CollectionConfig;
    }),
  });
}

function relationId(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  const id = (value as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' ? id : undefined;
}

/* -------------------------------------------------------------------- forms */

const FORM_FIELD_TYPES = [
  { label: 'Text', value: 'text' },
  { label: 'E-mail', value: 'email' },
  { label: 'Long text', value: 'textarea' },
  { label: 'Checkbox', value: 'checkbox' },
] as const;

/**
 * Forms editors build in the panel, and the answers they collect. The site posts to the submissions
 * collection; each answer is checked against its form. Anyone can submit, so put a rate limit or a
 * captcha in front of it on a public site.
 */
export function formsPlugin(options: { canRead?: AccessFn } = {}): CmsPlugin {
  const canRead: AccessFn = options.canRead ?? (({ user }) => Boolean(user));

  return (config) => ({
    ...config,
    collections: [
      ...(config.collections ?? []),
      collection('forms', {
        labels: { singular: 'Form', plural: 'Forms' },
        admin: { useAsTitle: 'title', defaultColumns: ['title'] },
        versions: { drafts: false },
        fields: [
          fields.text('title', { required: true }),
          fields.array('fields', {
            fields: [
              fields.text('name', { required: true }),
              fields.text('label'),
              fields.select('type', { options: FORM_FIELD_TYPES, defaultValue: 'text' }),
              fields.checkbox('required'),
            ],
          }),
          fields.textarea('confirmation'),
        ],
      }) as CollectionConfig,
      collection('form_submissions', {
        labels: { singular: 'Submission', plural: 'Submissions' },
        admin: { defaultColumns: ['form'] },
        versions: { drafts: false },
        access: { read: canRead, update: () => false, delete: canRead },
        fields: [
          fields.relation('form', { relationTo: 'forms', required: true }),
          fields.json('answers', { required: true }),
        ],
        hooks: {
          beforeValidate: [
            async ({ data }: { data: Record<string, unknown> }) => {
              const read = (await import('../../services/main.js')).getCms();
              const formId = relationId(data.form);
              const form = formId
                ? ((await read
                    .collection('forms' as never)
                    .findByID(formId as never, { depth: 0, overrideAccess: true } as never)) as {
                    fields?: { name: string; required?: boolean; type?: string }[];
                  } | null)
                : null;
              if (!form) throw new CmsValidationError({ form: 'unknown form' });

              const answers = (data.answers ?? {}) as Record<string, unknown>;
              const errors: Record<string, string> = {};
              const clean: Record<string, unknown> = {};
              for (const field of form.fields ?? []) {
                const value = answers[field.name];
                const empty = value === undefined || value === null || value === '';
                if (field.required && empty) errors[`answers.${field.name}`] = 'required';
                else if (
                  field.type === 'email' &&
                  !empty &&
                  !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value))
                ) {
                  errors[`answers.${field.name}`] = 'invalid e-mail';
                }
                // Only what the form asks for is kept: a public endpoint must not store anything else.
                if (!empty) clean[field.name] = value;
              }
              if (Object.keys(errors).length > 0) throw new CmsValidationError(errors);
              return { ...data, answers: clean };
            },
          ],
        },
      }) as CollectionConfig,
    ],
  });
}
