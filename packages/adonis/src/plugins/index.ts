import { collection } from '../config/collection.js';
import { fields } from '../config/fields.js';
import type { CmsConfigInput, CollectionConfig } from '../config/types.js';

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
