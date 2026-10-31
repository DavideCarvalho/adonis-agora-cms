import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CmsConfigError } from '../errors.js';

/** The part of the AdonisJS application an adapter needs, handed over by the provider at boot. */
export type CmsApp = {
  appRoot: URL;
  container: {
    make(binding: never): Promise<unknown>;
    hasBinding(binding: never): boolean;
  };
};

/**
 * A port the provider builds at boot. The config file loads before the app exists, so `jobs.durable()`
 * only records what to build, and a library that is missing fails the boot rather than the first write.
 */
export type CmsAdapter<T> = {
  cmsAdapter: true;
  create(app: CmsApp): T | Promise<T>;
};

export function adapter<T>(create: CmsAdapter<T>['create']): CmsAdapter<T> {
  return { cmsAdapter: true, create };
}

export function isAdapter<T>(value: unknown): value is CmsAdapter<T> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    (value as { cmsAdapter?: unknown }).cmsAdapter === true
  );
}

/** Checked now, made on first use: a service may not be ready while providers are still booting. */
function lazily<T>(app: CmsApp, binding: unknown, missing: string): () => Promise<T> {
  if (!app.container.hasBinding(binding as never)) {
    throw new CmsConfigError('integrations', missing);
  }
  return async () => (await app.container.make(binding as never)) as T;
}

/** A service the official packages bind under a string, like `drive.manager`. */
export function boundService<T>(
  app: CmsApp,
  binding: string,
  packageName: string,
): () => Promise<T> {
  return lazily(
    app,
    binding,
    `"${binding}" is not bound: install ${packageName} and register its provider`,
  );
}

/**
 * A service the Agora packages bind under a class. Imported from the app, never from here: another copy
 * of the library has another class, which the container does not know.
 */
export async function classService<T>(
  app: CmsApp,
  packageName: string,
  className: string,
): Promise<() => Promise<T>> {
  let resolved: string;
  try {
    resolved = createRequire(new URL('package.json', app.appRoot)).resolve(packageName);
  } catch {
    throw new CmsConfigError('integrations', `${packageName} is not installed in this app`);
  }
  const library = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
  return lazily(
    app,
    library[className],
    `${className} is not bound: register the ${packageName} provider`,
  );
}
