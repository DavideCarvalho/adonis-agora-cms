import type { CmsConfig, CmsConfigInput } from './types.js';

/**
 * Declares the CMS configuration.
 *
 * `defineConfig` is intentionally an identity function: validation is a separate, pure step so
 * that the compiler and the diff can run on a config that was never booted. Keeping literal
 * types is the whole point, hence the `const` type parameter.
 */
export function defineConfig<const C extends CmsConfigInput>(config: C): C {
  return config;
}

export type { CmsConfig };
