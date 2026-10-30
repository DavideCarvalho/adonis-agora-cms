import type { CmsConfig } from '../config/types.js';
import type { Cms } from '../local_api/index.js';
import {
  handleAdminSchema,
  handleCollectionCreate,
  handleCollectionDelete,
  handleCollectionFind,
  handleCollectionFindOne,
  handleCollectionLock,
  handleCollectionPublish,
  handleCollectionRestoreVersion,
  handleCollectionUnlock,
  handleCollectionUnpublish,
  handleCollectionUpdate,
  handleCollectionVersion,
  handleCollectionVersions,
  handleGlobalGet,
  handleGlobalUpdate,
  type RestRequest,
  type RestResponse,
} from './handlers.js';

/**
 * Structural slice of the Adonis router — keeps `@adonisjs/core` a peer and lets tests pass a
 * fake router.
 */
export type CmsRouter = {
  get(path: string, handler: (context: unknown) => unknown): unknown;
  post(path: string, handler: (context: unknown) => unknown): unknown;
  patch(path: string, handler: (context: unknown) => unknown): unknown;
  delete(path: string, handler: (context: unknown) => unknown): unknown;
};

export type RouteContext = {
  params: Record<string, string>;
  request: {
    qs(): Record<string, unknown>;
    body(): unknown;
    hostname?(): string;
  };
  response: {
    status(code: number): {
      json(payload: unknown): unknown;
      noContent(): unknown;
    };
  };
};

export type RegisterCmsRoutesOptions = {
  prefix?: string;
  /**
   * Resolves the request principal. The tenant is what makes the same route serve
   * `acme.example.com` and `globex.example.com` without extra routing.
   */
  resolveContext?: (
    context: RouteContext,
  ) =>
    | { user?: unknown; tenant?: string | null }
    | Promise<{ user?: unknown; tenant?: string | null }>;
};

type Handler = (cms: Cms<CmsConfig>, request: RestRequest) => Promise<RestResponse>;

/**
 * Mounts the REST surface.
 *
 * Routes are thin: they build a `RestRequest`, pick the scoped CMS instance and write the
 * `RestResponse` back. All behaviour lives in the handlers.
 */
export function registerCmsRoutes(
  router: CmsRouter,
  cms: Cms<CmsConfig>,
  options: RegisterCmsRoutesOptions = {},
): void {
  const prefix = options.prefix ?? '/api/cms';
  const dispatch = (handler: Handler) => async (context: unknown) => {
    const ctx = context as RouteContext;
    const scoped = await scope(cms, ctx, options);
    const response = await handler(scoped, toRequest(ctx));

    const writer = ctx.response.status(response.status);
    if (response.status === 204) {
      writer.noContent();
      return;
    }
    writer.json(response.body);
  };

  router.get(
    `${prefix}/schema`,
    dispatch((cms) => handleAdminSchema(cms)),
  );
  router.get(`${prefix}/collections/:slug`, dispatch(handleCollectionFind));
  router.post(`${prefix}/collections/:slug`, dispatch(handleCollectionCreate));
  router.get(`${prefix}/collections/:slug/:id`, dispatch(handleCollectionFindOne));
  router.patch(`${prefix}/collections/:slug/:id`, dispatch(handleCollectionUpdate));
  router.delete(`${prefix}/collections/:slug/:id`, dispatch(handleCollectionDelete));
  router.post(`${prefix}/collections/:slug/:id/publish`, dispatch(handleCollectionPublish));
  router.post(`${prefix}/collections/:slug/:id/unpublish`, dispatch(handleCollectionUnpublish));
  router.get(`${prefix}/collections/:slug/:id/versions`, dispatch(handleCollectionVersions));
  router.get(
    `${prefix}/collections/:slug/:id/versions/:version`,
    dispatch(handleCollectionVersion),
  );
  router.post(
    `${prefix}/collections/:slug/:id/versions/:version/restore`,
    dispatch(handleCollectionRestoreVersion),
  );
  router.post(`${prefix}/collections/:slug/:id/lock`, dispatch(handleCollectionLock));
  router.delete(`${prefix}/collections/:slug/:id/lock`, dispatch(handleCollectionUnlock));
  router.get(`${prefix}/globals/:slug`, dispatch(handleGlobalGet));
  router.patch(`${prefix}/globals/:slug`, dispatch(handleGlobalUpdate));
}

async function scope(
  cms: Cms<CmsConfig>,
  ctx: RouteContext,
  options: RegisterCmsRoutesOptions,
): Promise<Cms<CmsConfig>> {
  const resolved = (await options.resolveContext?.(ctx)) ?? {};
  let instance = cms;
  if (resolved.tenant !== undefined) instance = instance.forTenant(resolved.tenant);
  if (resolved.user !== undefined) instance = instance.as(resolved.user);
  return instance;
}

function toRequest(ctx: RouteContext): RestRequest {
  return {
    params: ctx.params,
    query: safe(() => ctx.request.qs(), {}),
    body: toBody(safe(() => ctx.request.body(), {})),
  };
}

function toBody(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return value as Record<string, unknown>;
}

function safe<T>(callback: () => T, fallback: T): T {
  try {
    return callback();
  } catch {
    return fallback;
  }
}
