import type { CmsConfig } from '../config/types.js';
import { resolveLocalization, resolveVersions } from '../config/types.js';
import { detectEngine } from '../db/sync.js';
import type { CmsKnex } from '../db/types.js';
import type { CmsEventBus } from '../integrations/durable.js';
import type { MediaAdapter } from '../integrations/media.js';
import type { CmsObservation } from '../integrations/telescope.js';
import {
  createDocument,
  deleteDocument,
  type FindQuery,
  findDocumentByID,
  findDocuments,
  type OperationOptions,
  restoreDocument,
  updateDocument,
} from '../repository/crud.js';
import type { RepoContext } from '../repository/document.js';
import { compileSchema } from '../schema/compile.js';
import type { Engine, SchemaSpec } from '../schema/types.js';
import type { CmsCreateInput, CmsDocument, CmsUpdateInput } from '../types/document.js';
import {
  type DocumentLock,
  lockDocument,
  publishDocument,
  readVersion,
  readVersions,
  restoreVersion,
  unlockDocument,
  unpublishDocument,
} from '../versions/actions.js';
import {
  cancelSchedule,
  type DocumentSchedule,
  readSchedule,
  runDueSchedules,
  scheduleDocument,
} from '../versions/schedule.js';
import type { VersionRecord } from '../versions/store.js';

export type CreateCmsOptions = {
  config: CmsConfig;
  /** Knex instance (usually `db.connection().getWriteClient()`). */
  client: CmsKnex;
  engine?: Engine;
  user?: unknown;
  tenant?: string | null;
  req?: unknown;
  locale?: string;
  /** Resolves `upload` ids into `{ id, url, … }` on read. */
  media?: MediaAdapter;
  /** Called after every committed write (telescope wiring). */
  observer?: (observation: CmsObservation) => void;
  /** Post-commit events (durable wiring). */
  events?: CmsEventBus;
};

export type CmsCollectionApi<C, S extends string> = {
  create(data: CmsCreateInput<C, S>, options?: OperationOptions): Promise<CmsDocument<C, S>>;
  find(
    query?: FindQuery,
    options?: OperationOptions,
  ): Promise<{
    docs: CmsDocument<C, S>[];
    totalDocs: number;
    limit: number;
    page: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  }>;
  /** First document matching the query, or `null` — the common "page by slug" case. */
  findOne(query?: FindQuery, options?: OperationOptions): Promise<CmsDocument<C, S> | null>;
  findByID(id: string, options?: OperationOptions): Promise<CmsDocument<C, S> | null>;
  update(
    id: string,
    data: CmsUpdateInput<C, S>,
    options?: OperationOptions,
  ): Promise<CmsDocument<C, S>>;
  delete(id: string, options?: OperationOptions): Promise<void>;
  restore(id: string, options?: OperationOptions): Promise<CmsDocument<C, S>>;
  count(query?: FindQuery): Promise<number>;
  publish(id: string, options?: OperationOptions): Promise<CmsDocument<C, S>>;
  unpublish(id: string, options?: OperationOptions): Promise<CmsDocument<C, S>>;
  versions(
    id: string,
    options?: { locale?: string | null; limit?: number; page?: number },
  ): Promise<{ docs: VersionRecord[]; totalDocs: number }>;
  version(id: string, version: number): Promise<VersionRecord | null>;
  schedule(
    id: string,
    schedule: DocumentSchedule,
    options?: OperationOptions,
  ): Promise<DocumentSchedule>;
  unschedule(id: string, options?: OperationOptions): Promise<void>;
  scheduled(id: string): Promise<DocumentSchedule | null>;
  restoreVersion(
    id: string,
    version: number,
    options?: OperationOptions,
  ): Promise<CmsDocument<C, S>>;
  lock(id: string, ttlSeconds?: number): Promise<DocumentLock>;
  unlock(id: string, options?: { overrideAccess?: boolean }): Promise<void>;
};

export type CmsGlobalApi<C, S extends string> = {
  get(options?: OperationOptions): Promise<CmsDocument<C, S> | null>;
  update(data: CmsUpdateInput<C, S>, options?: OperationOptions): Promise<CmsDocument<C, S>>;
};

export type Cms<C extends CmsConfig = CmsConfig> = {
  readonly spec: SchemaSpec;
  readonly config: C;
  readonly user: unknown;
  readonly tenant: string | null;
  collection<S extends string>(slug: S): CmsCollectionApi<C, S>;
  global<S extends string>(slug: S): CmsGlobalApi<C, S>;
  /** A scoped instance sharing the same schema and connection. */
  forTenant(tenant: string | null): Cms<C>;
  /** A scoped instance with a different request user. */
  as(user: unknown): Cms<C>;
  /** Recompiles the config (dev tooling / `cms.refresh()`). */
  refresh(): Promise<SchemaSpec>;
  /** Internal repository context, for token management and ops tooling. */
  repoContext(): RepoContext;
  /** Post-commit events: `cms.events?.on(listener)`. Set when the host wires a bus. */
  readonly events: CmsEventBus | undefined;
  /** Applies scheduled publishes that are due; returns how many ran. */
  runDueSchedules(now?: Date): Promise<number>;
};

type Overrides = Partial<
  Pick<CreateCmsOptions, 'client' | 'engine' | 'tenant' | 'user' | 'req' | 'locale'>
>;

/**
 * Local API — the server-side entry point.
 *
 * No HTTP: hooks, access and tenancy run exactly as they do over REST, so a script, a job or a
 * server component all get the same rules.
 */
export function createCms<C extends CmsConfig>(options: CreateCmsOptions): Cms<C> {
  const engine = options.engine ?? detectEngine(options.client);
  const localization = resolveLocalization(options.config);
  const defaultLocale = options.locale ?? localization.defaultLocale;

  let spec = compileSchema(options.config, { engine });

  function context(overrides: Overrides = {}): RepoContext {
    return {
      spec,
      config: options.config,
      client: overrides.client ?? options.client,
      engine: overrides.engine ?? engine,
      tenant: overrides.tenant !== undefined ? overrides.tenant : (options.tenant ?? null),
      user: overrides.user !== undefined ? overrides.user : options.user,
      req: overrides.req ?? options.req ?? null,
      locale: overrides.locale ?? defaultLocale,
      media: options.media,
      observer: options.observer,
      events: options.events,
    };
  }

  function instance(overrides: Overrides = {}): Cms<C> {
    const ctx = context(overrides);

    return {
      get spec() {
        return spec;
      },

      get config() {
        return ctx.config as C;
      },

      get user() {
        return ctx.user;
      },

      get tenant() {
        return ctx.tenant;
      },

      collection<S extends string>(slug: S): CmsCollectionApi<C, S> {
        return {
          async create(data, operation) {
            return (await createDocument(
              ctx,
              slug,
              data as Record<string, unknown>,
              operation,
            )) as CmsDocument<C, S>;
          },

          async find(query, operation) {
            const result = await findDocuments(ctx, slug, query, operation);
            return result as unknown as Awaited<ReturnType<CmsCollectionApi<C, S>['find']>>;
          },

          async findOne(query, operation) {
            const result = await findDocuments(ctx, slug, { ...query, limit: 1 }, operation);
            return (result.docs[0] as CmsDocument<C, S> | undefined) ?? null;
          },

          async findByID(id, operation) {
            return (await findDocumentByID(ctx, slug, id, operation)) as CmsDocument<C, S> | null;
          },

          async update(id, data, operation) {
            return (await updateDocument(
              ctx,
              slug,
              id,
              data as Record<string, unknown>,
              operation,
            )) as CmsDocument<C, S>;
          },

          async delete(id, operation) {
            await deleteDocument(ctx, slug, id, operation);
          },

          async restore(id, operation) {
            return (await restoreDocument(ctx, slug, id, operation)) as CmsDocument<C, S>;
          },

          async count(query) {
            const result = await findDocuments(ctx, slug, { ...query, limit: 1 });
            return result.totalDocs;
          },

          async publish(id, operation) {
            return (await publishDocument(ctx, slug, id, operation)) as CmsDocument<C, S>;
          },

          async unpublish(id, operation) {
            return (await unpublishDocument(ctx, slug, id, operation)) as CmsDocument<C, S>;
          },

          async versions(id, options) {
            return readVersions(ctx, slug, id, options);
          },

          async version(id, version) {
            return readVersion(ctx, slug, id, version);
          },

          async schedule(id, schedule, operation) {
            return scheduleDocument(ctx, slug, id, schedule, operation);
          },

          async unschedule(id, operation) {
            await cancelSchedule(ctx, slug, id, operation);
          },

          async scheduled(id) {
            return readSchedule(ctx, slug, id);
          },

          async restoreVersion(id, version, operation) {
            return (await restoreVersion(ctx, slug, id, version, operation)) as CmsDocument<C, S>;
          },

          async lock(id, ttlSeconds) {
            const { lockTtl } = resolveVersions(ctx.config);
            return lockDocument(ctx, slug, id, ttlSeconds ?? lockTtl);
          },

          async unlock(id, options) {
            await unlockDocument(ctx, slug, id, options);
          },
        };
      },

      global<S extends string>(slug: S): CmsGlobalApi<C, S> {
        return {
          async get(operation) {
            const result = await findDocuments(ctx, slug, { limit: 1 }, operation);
            return (result.docs[0] as CmsDocument<C, S> | undefined) ?? null;
          },

          async update(data, operation) {
            const existing = await findDocuments(ctx, slug, { limit: 1 }, { overrideAccess: true });
            const row = existing.docs[0];

            if (row) {
              return (await updateDocument(
                ctx,
                slug,
                String(row.id),
                data as Record<string, unknown>,
                operation,
              )) as CmsDocument<C, S>;
            }

            return (await createDocument(
              ctx,
              slug,
              data as Record<string, unknown>,
              operation,
            )) as CmsDocument<C, S>;
          },
        };
      },

      forTenant(tenant) {
        return instance({ ...overrides, tenant });
      },

      as(user) {
        return instance({ ...overrides, user });
      },

      async refresh() {
        spec = compileSchema(ctx.config, { engine: ctx.engine });
        return spec;
      },

      runDueSchedules(now) {
        return runDueSchedules(ctx, now);
      },

      events: options.events,

      repoContext() {
        return ctx;
      },
    };
  }

  return instance();
}
