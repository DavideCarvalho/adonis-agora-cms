import type { CmsConfig } from '../config/types.js';
import { CmsNotFoundError } from '../errors.js';
import type { Cms } from '../local_api/index.js';
import { toRestError } from './errors.js';
import { parseFindQuery } from './parse.js';

export type RestRequest = {
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: Record<string, unknown> | undefined;
};

export type RestResponse = {
  status: number;
  body: unknown;
};

const NO_CONTENT = 204;

/**
 * HTTP-shaped handlers with no framework types.
 *
 * The Adonis routes are a thin translation layer over these, which keeps the whole REST
 * surface testable without booting a server.
 */
export async function handleCollectionFind(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const result = await cms.collection(slug).find(parseFindQuery(request.query));
    return { status: 200, body: result };
  });
}

export async function handleCollectionFindOne(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    const doc = await cms.collection(slug).findByID(id, parseFindQuery(request.query));
    if (!doc) {
      return {
        status: 404,
        body: { error: { code: 'CMS_NOT_FOUND', message: `"${slug}" ${id} not found` } },
      };
    }
    return { status: 200, body: doc };
  });
}

export async function handleCollectionCreate(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const doc = await cms.collection(slug).create((request.body ?? {}) as never);
    return { status: 201, body: doc };
  });
}

export async function handleCollectionUpdate(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    const doc = await cms.collection(slug).update(id, (request.body ?? {}) as never);
    return { status: 200, body: doc };
  });
}

export async function handleCollectionDelete(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    await cms.collection(slug).delete(id);
    return { status: NO_CONTENT, body: null };
  });
}

export async function handleGlobalGet(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const doc = await cms.global(slug).get(parseFindQuery(request.query));
    if (!doc) {
      return {
        status: 404,
        body: { error: { code: 'CMS_NOT_FOUND', message: `global "${slug}" has no document yet` } },
      };
    }
    return { status: 200, body: doc };
  });
}

export async function handleGlobalUpdate(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const doc = await cms.global(slug).update((request.body ?? {}) as never);
    return { status: 200, body: doc };
  });
}

async function run(callback: () => Promise<RestResponse>): Promise<RestResponse> {
  try {
    return await callback();
  } catch (error) {
    return toRestError(error);
  }
}

function requireParam(value: string | undefined, name: string): string {
  if (!value) throw new CmsNotFoundError(`missing "${name}" parameter`);
  return value;
}

export async function handleCollectionPublish(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    const doc = await cms.collection(slug).publish(id);
    return { status: 200, body: doc };
  });
}

export async function handleCollectionUnpublish(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    const doc = await cms.collection(slug).unpublish(id);
    return { status: 200, body: doc };
  });
}

export async function handleCollectionVersions(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    const query = request.query;
    const options: { locale?: string | null; limit?: number; page?: number } = {};
    if (typeof query.locale === 'string') options.locale = query.locale;
    if (typeof query.limit === 'string') options.limit = Number(query.limit);
    if (typeof query.page === 'string') options.page = Number(query.page);

    const result = await cms.collection(slug).versions(id, options);
    return { status: 200, body: result };
  });
}

export async function handleCollectionVersion(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    const version = Number(requireParam(request.params.version, 'version'));
    const result = await cms.collection(slug).versions(id, { limit: 100 });
    const record = result.docs.find((item) => item.version === version);

    if (!record) {
      return {
        status: 404,
        body: { error: { code: 'CMS_NOT_FOUND', message: `version ${version} not found` } },
      };
    }

    return { status: 200, body: record };
  });
}

export async function handleCollectionRestoreVersion(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    const version = Number(requireParam(request.params.version, 'version'));
    const doc = await cms.collection(slug).restoreVersion(id, version);
    return { status: 200, body: doc };
  });
}

export async function handleCollectionLock(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    const ttl = typeof request.body?.ttlSeconds === 'number' ? request.body.ttlSeconds : undefined;
    const lock = await cms.collection(slug).lock(id, ttl);
    return { status: 200, body: lock };
  });
}

export async function handleCollectionUnlock(
  cms: Cms<CmsConfig>,
  request: RestRequest,
): Promise<RestResponse> {
  return run(async () => {
    const slug = requireParam(request.params.slug, 'slug');
    const id = requireParam(request.params.id, 'id');
    await cms.collection(slug).unlock(id);
    return { status: NO_CONTENT, body: null };
  });
}
