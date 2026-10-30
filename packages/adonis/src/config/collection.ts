import type {
  CollectionConfig,
  CollectionConfigInput,
  GlobalConfig,
  GlobalConfigInput,
  Labels,
} from './types.js';

/**
 * Declares a collection. The slug is part of the identity: it names the table, the REST route
 * and the local API handle, so it is validated against `^[a-z][a-z0-9_]*$`.
 */
export function collection<const S extends string, const C extends CollectionConfigInput>(
  slug: S,
  config: C,
): { slug: S } & C {
  return { slug, ...config };
}

/**
 * Declares a global — a single-row document (site settings, navigation, theme). It compiles
 * through the same pipeline as a collection, so every field type works identically.
 */
export function global<const S extends string, const C extends GlobalConfigInput>(
  slug: S,
  config: C,
): { slug: S } & C {
  return { slug, ...config };
}

/** Labels helper: derives `{"Post", "Posts"}` from a singular and an optional plural. */
export function labels(singular: string, plural?: string): Labels {
  return {
    singular,
    plural: plural ?? (singular.endsWith('s') ? singular : `${singular}s`),
  };
}

export type { CollectionConfig, GlobalConfig };
