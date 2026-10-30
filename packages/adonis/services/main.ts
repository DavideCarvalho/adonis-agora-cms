import type { Cms } from '../src/local_api/index.js';

let cms: Cms | undefined;

/**
 * Called by the provider once the instance exists.
 *
 * The service deliberately does not import `@adonisjs/core/services/app`: in a monorepo (or any
 * setup where the package keeps its own copy of core) that resolves to a second instance of the
 * app singleton and `booted()` never fires. The provider runs inside the app, so it hands the
 * instance over instead.
 */
export function setCms(instance: Cms): void {
  cms = instance;
}

export function getCms(): Cms {
  if (!cms) {
    throw new Error('Cannot access the CMS service before the app is booted');
  }
  return cms;
}

/**
 * Typed singleton: `import cms from '@adonis-agora/cms/services/main'` and then
 * `cms.collection('pages').find(…)`, the same shape as `@adonisjs/lucid/services/db`.
 */
const service = new Proxy({} as Cms, {
  get(_target, property) {
    return Reflect.get(getCms(), property);
  },
});

export default service;
