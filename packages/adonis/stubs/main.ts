import { fileURLToPath } from 'node:url';

let cached: string | undefined;

/**
 * Absolute path to the published stubs directory (`dist/stubs/`).
 *
 * Computed lazily on first call — never at module import — and memoized, so importing the
 * package under a non-`file:` `import.meta.url` (test runners, bundlers) cannot throw.
 */
export function stubsRoot(): string {
  if (cached === undefined) {
    cached = fileURLToPath(new URL('./', import.meta.url));
  }
  return cached;
}
