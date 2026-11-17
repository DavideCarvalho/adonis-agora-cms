import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Lists keep their filters in the URL hash (`#/collections/posts?status=draft`). The test
// environment keeps one `location` per file, so reset it after each test: a filter left by one test
// must not open the next one filtered. (Node-environment specs have no `window`.) This config has
// no vitest globals, so testing-library's automatic unmount does not run: do it here too.
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
  if (typeof window !== 'undefined') window.history.replaceState(null, '', '/');
});
