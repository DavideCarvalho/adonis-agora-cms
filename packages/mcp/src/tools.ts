import type {
  Cms,
  CmsConfig,
  CmsCreateInput,
  CmsUpdateInput,
  FindQuery,
  OperationOptions,
} from '@adonis-agora/cms';
import { z } from 'zod';

export type CmsToolOptions = {
  /** The instance the MCP server talks to — the same one the admin and REST use. */
  cms: Cms<CmsConfig>;
  /** When false, write tools refuse with a clear message (read-only agent session). */
  allowWrite?: boolean;
};

export type CmsToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  readOnly: boolean;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

const where = z
  .record(z.string(), z.unknown())
  .optional()
  .describe('field → value, or field → { equals, in, like, greater_than, … }');
const collection = z.string().describe('collection slug (see cms_schema)');
const id = z.string().describe('document id');

/**
 * The CMS surface as MCP tools.
 *
 * Same Local API the REST routes and the admin use, so hooks, access, versions and tenancy apply —
 * an agent can do exactly what a human editor can, and no more.
 */
export function createCmsTools({ cms, allowWrite = true }: CmsToolOptions): CmsToolDefinition[] {
  const assertWritable = () => {
    if (!allowWrite) throw new Error('this MCP session is read-only');
  };

  const tools: CmsToolDefinition[] = [
    {
      name: 'cms_schema',
      title: 'CMS schema',
      description:
        'Collections, their fields and types, locales, tenancy and whether drafts/versions are on. Call this before writing.',
      inputSchema: {},
      readOnly: true,
      handler: async () => {
        const config = cms.config;
        return {
          locales: config.localization?.locales ?? [],
          defaultLocale: config.localization?.defaultLocale ?? 'en',
          tenancy: config.tenancy?.strategy ?? 'single',
          collections: (config.collections ?? []).map((item) => ({
            slug: item.slug,
            labels: item.labels,
            versioned: Boolean(item.versions) || Boolean(config.versions),
            drafts: Boolean(item.versions?.drafts ?? config.versions?.drafts),
            softDelete: Boolean(item.softDelete),
            fields: describeFields(item.fields),
          })),
          globals: (config.globals ?? []).map((item) => ({
            slug: item.slug,
            fields: describeFields(item.fields),
          })),
        };
      },
    },
    {
      name: 'cms_list',
      title: 'List documents',
      description:
        'List documents of a collection with filters, sorting and pagination. Drafts are only returned with `draft: true`.',
      inputSchema: {
        collection,
        where,
        sort: z.string().optional().describe('e.g. -createdAt or title'),
        limit: z.number().int().min(1).max(100).optional(),
        page: z.number().int().min(1).optional(),
        draft: z.boolean().optional(),
        depth: z.number().int().min(0).max(3).optional(),
        locale: z.string().optional(),
      },
      readOnly: true,
      handler: async (input) =>
        client(input).find(
          query(input, ['where', 'sort', 'limit', 'page', 'draft', 'depth', 'locale']),
        ),
    },
    {
      name: 'cms_get',
      title: 'Get a document',
      description: 'Read one document by id, or the first match of a `where` filter.',
      inputSchema: {
        collection,
        id: id.optional(),
        where,
        draft: z.boolean().optional(),
        locale: z.string().optional(),
      },
      readOnly: true,
      handler: async (input) => {
        const options = query(input, ['draft', 'locale']);

        if (input.id) {
          const doc = await client(input).findByID(String(input.id), options);
          if (!doc) throw new Error(`document ${input.id} not found in "${input.collection}"`);
          return doc;
        }

        if (!input.where) throw new Error('pass either `id` or `where`');
        const doc = await client(input).findOne(
          { where: input.where as Record<string, unknown> },
          options,
        );
        if (!doc) throw new Error('no document matches the filter');
        return doc;
      },
    },
    {
      name: 'cms_create',
      title: 'Create a document',
      description:
        'Create a document. Field names must match the schema; create it as a draft first when the collection versions drafts.',
      inputSchema: {
        collection,
        data: z.record(z.string(), z.unknown()).describe('field values'),
        draft: z.boolean().optional(),
        status: z.enum(['draft', 'published']).optional(),
        locale: z.string().optional(),
      },
      readOnly: false,
      handler: async (input) => {
        assertWritable();
        return client(input).create(
          input.data as CmsCreateInput<CmsConfig, string>,
          query(input, ['draft', 'status', 'locale']),
        );
      },
    },
    {
      name: 'cms_update',
      title: 'Update a document',
      description: 'Update fields of a document by id. Unlisted fields are kept.',
      inputSchema: {
        collection,
        id,
        data: z.record(z.string(), z.unknown()).describe('fields to change'),
        locale: z.string().optional(),
      },
      readOnly: false,
      handler: async (input) => {
        assertWritable();
        return client(input).update(
          String(input.id),
          input.data as CmsUpdateInput<CmsConfig, string>,
          query(input, ['locale']),
        );
      },
    },
    {
      name: 'cms_delete',
      title: 'Delete a document',
      description:
        'Delete a document. Collections with soft delete move it to the trash unless `force`.',
      inputSchema: { collection, id, force: z.boolean().optional() },
      readOnly: false,
      handler: async (input) => {
        assertWritable();
        await client(input).delete(String(input.id), query(input, ['force']));
        return { deleted: input.id };
      },
    },
    {
      name: 'cms_publish',
      title: 'Publish a document',
      description: 'Publish a draft.',
      inputSchema: { collection, id },
      readOnly: false,
      handler: async (input) => {
        assertWritable();
        return client(input).publish(String(input.id));
      },
    },
    {
      name: 'cms_unpublish',
      title: 'Unpublish a document',
      description: 'Move a published document back to draft.',
      inputSchema: { collection, id },
      readOnly: false,
      handler: async (input) => {
        assertWritable();
        return client(input).unpublish(String(input.id));
      },
    },
    {
      name: 'cms_versions',
      title: 'List versions',
      description: 'Version history of a document, newest first.',
      inputSchema: { collection, id, limit: z.number().int().min(1).max(50).optional() },
      readOnly: true,
      handler: async (input) => {
        return client(input).versions(
          String(input.id),
          query(input, ['limit']) as { limit?: number },
        );
      },
    },
    {
      name: 'cms_restore_version',
      title: 'Restore a version',
      description: 'Restore a document to a previous version.',
      inputSchema: { collection, id, version: z.number().int().min(1) },
      readOnly: false,
      handler: async (input) => {
        assertWritable();
        return client(input).restoreVersion(String(input.id), Number(input.version));
      },
    },
    {
      name: 'cms_global_get',
      title: 'Read a global',
      description: 'Read a global (single-row document).',
      inputSchema: { slug: z.string().describe('global slug') },
      readOnly: true,
      handler: async (input) => {
        const doc = await cms.global(String(input.slug)).get();
        if (!doc) throw new Error(`global "${input.slug}" has no document yet`);
        return doc;
      },
    },
    {
      name: 'cms_global_update',
      title: 'Update a global',
      description: 'Update a global (single-row document).',
      inputSchema: {
        slug: z.string().describe('global slug'),
        data: z.record(z.string(), z.unknown()),
      },
      readOnly: false,
      handler: async (input) => {
        assertWritable();
        return cms
          .global(String(input.slug))
          .update(input.data as CmsUpdateInput<CmsConfig, string>);
      },
    },
  ];

  // `client` resolves the collection lazily: `cms.collection` is typed by slug, and the slug only
  // exists at call time.
  function client(input: Record<string, unknown>) {
    const slug = String(input.collection ?? '');
    if (!slug) throw new Error('`collection` is required');
    return cms.collection(slug);
  }

  /** Drops `undefined` keys: the core uses `exactOptionalPropertyTypes`, so absent ≠ undefined. */
  function query(
    input: Record<string, unknown>,
    keys: readonly string[],
  ): FindQuery & OperationOptions {
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      if (input[key] !== undefined) output[key] = input[key];
    }
    return output as FindQuery & OperationOptions;
  }

  return tools;
}

type FieldLike = {
  name: string;
  type: string;
  required?: boolean;
  localized?: boolean;
  relationTo?: string | readonly string[];
  options?: readonly { label?: unknown; value: string }[];
  fields?: readonly FieldLike[];
  blocks?: readonly { slug: string; fields: readonly FieldLike[] }[];
};

function describeFields(fields: readonly FieldLike[]): unknown[] {
  return fields.map((field) => ({
    name: field.name,
    type: field.type,
    ...(field.required ? { required: true } : {}),
    ...(field.localized ? { localized: true } : {}),
    ...(field.relationTo ? { relationTo: field.relationTo } : {}),
    ...(field.options ? { options: field.options.map((option) => option.value) } : {}),
    ...(field.fields ? { fields: describeFields(field.fields) } : {}),
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
