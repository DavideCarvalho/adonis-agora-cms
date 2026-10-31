import {
  type BuiltinAuth,
  type BuiltinAuthOptions,
  type CmsMail,
  cmsAuth,
} from '../auth/builtin.js';
import type { AccessFn, CmsConfig, CmsUploadHandler, CollectionAccess } from '../config/types.js';
import { CmsConfigError } from '../errors.js';
import {
  type AdonisLogger,
  type AdonisMailManager,
  adonisAuth,
  adonisMail,
  bouncerAccess,
  type DriveManager,
  type DurableEngine,
  driveMedia,
  driveUploads,
  durableJobs,
  loggerObserver,
  queueJobs,
  type UrlOptions,
} from './adapters.js';
import { authkitAuth, type CmsAuthAdapter } from './authkit.js';
import { authzCollectionAccess, type CanCheck } from './authz.js';
import {
  adapter,
  boundService,
  type CmsAdapter,
  type CmsApp,
  classService,
  isAdapter,
} from './container.js';
import {
  type MediaAdapter,
  type MediaUploadLibrary,
  mediaLibraryAdapter,
  mediaLibraryUploads,
  type ReadLibrary,
} from './media.js';
import { type CmsObserver, telescopeWatcher } from './telescope.js';
import type { CmsJobs } from './webhooks.js';

/*
 * One factory per library, grouped by port: trading Agora for an official package is one word. A port
 * also takes a plain object, for anything else.
 */

const diskOf = (app: CmsApp, name?: string) => {
  const drive = boundService<DriveManager>(app, 'drive.manager', '@adonisjs/drive');
  return async () => {
    const manager = await drive();
    return name ? manager.use(name) : manager.use();
  };
};

const libraryOf = async <T>(app: CmsApp) => {
  const manager = await classService<{ library: T }>(app, '@adonis-agora/media', 'MediaManager');
  return async () => (await manager()).library;
};

export const jobs = {
  /** `@adonis-agora/durable`. Export `CmsDeliverWebhook` from `app/workflows`. */
  durable(): CmsAdapter<CmsJobs> {
    return adapter(async (app) =>
      durableJobs(
        await classService<DurableEngine>(app, '@adonis-agora/durable', 'WorkflowEngine'),
      ),
    );
  },
  /**
   * `@adonisjs/queue`: `jobs.queue(() => import('#jobs/deliver_cms_webhook'))`, where the job calls
   * `runWebhookDelivery(this.payload)`. For another queue, pass `{ deliverWebhook }`.
   */
  queue: queueJobs,
};

export const auth = {
  /** `@adonisjs/auth`. Needs no `silentAuth` middleware on the CMS routes. */
  adonis: adonisAuth,
  /** `@adonis-agora/authkit`, with its `authkit_middleware` on the routes. */
  authkit: authkitAuth,
  /**
   * The CMS's own login, for an app that has none; pair it with `usersPlugin()`. `mail` sends reset
   * links through `@adonisjs/mail`: `true` for the default mailer, or a name from `config/mail.ts`.
   */
  builtin(
    options: Omit<BuiltinAuthOptions, 'mail'> & { mail?: boolean | string | CmsMail },
  ): CmsAdapter<BuiltinAuth> {
    return adapter((app) => {
      const { mail, ...rest } = options;
      if (!mail) return cmsAuth(rest);
      if (typeof mail === 'object') return cmsAuth({ ...rest, mail });
      const manager = boundService<AdonisMailManager>(app, 'mail.manager', '@adonisjs/mail');
      return cmsAuth({
        ...rest,
        mail: adonisMail(async () => {
          const target = await manager();
          return typeof mail === 'string' ? target.use(mail) : target;
        }),
      });
    });
  },
};

export const media = {
  /** `@adonisjs/drive`: the default disk, or a name from `config/drive.ts`. */
  drive(options: { disk?: string } & UrlOptions = {}): CmsAdapter<MediaAdapter> {
    const { disk, ...urls } = options;
    return adapter((app) => driveMedia(diskOf(app, disk), urls));
  },
  /** `@adonis-agora/media`. */
  library(): CmsAdapter<MediaAdapter> {
    return adapter(async (app) => mediaLibraryAdapter(await libraryOf<ReadLibrary>(app)));
  },
};

export const uploads = {
  /** `@adonisjs/drive`. Keys are generated and must fit 64 characters, so keep `prefix` short. */
  drive(
    options: { disk?: string; prefix?: string } & UrlOptions = {},
  ): CmsAdapter<CmsUploadHandler> {
    const { disk, ...rest } = options;
    return adapter((app) => driveUploads(diskOf(app, disk), rest));
  },
  /** `@adonis-agora/media`. `collection` is one of the library's media collections. */
  library(
    options: { ownerType?: string; ownerId?: string; collection?: string } = {},
  ): CmsAdapter<CmsUploadHandler> {
    return adapter(async (app) =>
      mediaLibraryUploads(await libraryOf<MediaUploadLibrary>(app), options),
    );
  },
};

/** A real function for the config types; the provider swaps it for the working rule at boot. */
function deferredRule(create: (app: CmsApp) => Promise<AccessFn>): AccessFn {
  const rule: AccessFn = () => {
    throw new CmsConfigError(
      'access',
      'access.authz only works on collections and globals of a booted app; pass a check elsewhere',
    );
  };
  return Object.assign(rule, adapter(create));
}

export const access = {
  /**
   * `@adonis-agora/authz`: `posts.read`, `posts.create`, `posts.update` and `posts.delete`. On a field
   * or in a test, pass the check: `access.authz('posts', (user, ability) => authz.can(user, ability))`.
   */
  authz(prefix: string, can?: CanCheck): Required<CollectionAccess> {
    if (can) return authzCollectionAccess(prefix, can);
    const rule = (operation: keyof CollectionAccess) =>
      deferredRule(async (app) => {
        const service = await classService<{
          can(user: unknown, ability: string): Promise<boolean>;
        }>(app, '@adonis-agora/authz', 'AuthzService');
        return async ({ user }) =>
          user ? (await service()).can(user, `${prefix}.${operation}`) : false;
      });
    return {
      read: rule('read'),
      create: rule('create'),
      update: rule('update'),
      delete: rule('delete'),
    };
  },
  /** `@adonisjs/bouncer`: one of your abilities as a rule. */
  bouncer: bouncerAccess,
};

export const observers = {
  /** The AdonisJS logger. */
  logger(): CmsAdapter<CmsObserver> {
    return adapter((app) =>
      loggerObserver(boundService<AdonisLogger>(app, 'logger', '@adonisjs/core')),
    );
  },
  /** `@adonis-agora/telescope`: pass how to record, like `(entry) => store.record(entry)`. */
  telescope: telescopeWatcher,
};

async function built<T>(value: T | CmsAdapter<T> | undefined, app: CmsApp) {
  return isAdapter<T>(value) ? value.create(app) : value;
}

async function builtAccess<T extends object | undefined>(rules: T, app: CmsApp): Promise<T> {
  if (!rules) return rules;
  const entries = await Promise.all(
    Object.entries(rules).map(async ([name, rule]) => [name, await built(rule, app)]),
  );
  return Object.fromEntries(entries) as T;
}

/** What `buildAdapters` leaves in `config.integrations`. */
export type BuiltIntegrations = {
  auth?: CmsAuthAdapter;
  jobs?: CmsJobs;
  media?: boolean | MediaAdapter;
  observer?: CmsObserver;
};

/** The config with every factory built. Everything past the provider sees plain ports. */
export async function buildAdapters(config: CmsConfig, app: CmsApp): Promise<CmsConfig> {
  const { integrations, uploads: fileUploads } = config;
  const [collections, globals] = await Promise.all([
    Promise.all(
      (config.collections ?? []).map(async (item) => ({
        ...item,
        access: await builtAccess(item.access, app),
      })),
    ),
    Promise.all(
      (config.globals ?? []).map(async (item) => ({
        ...item,
        access: await builtAccess(item.access, app),
      })),
    ),
  ]);
  return {
    ...config,
    collections,
    globals,
    ...(integrations
      ? {
          integrations: {
            ...integrations,
            ...(await builtField('auth', integrations.auth, app)),
            ...(await builtField('jobs', integrations.jobs, app)),
            ...(await builtField('media', integrations.media, app)),
            ...(await builtField('observer', integrations.observer, app)),
          },
        }
      : {}),
    ...(fileUploads
      ? { uploads: { ...fileUploads, handler: (await built(fileUploads.handler, app)) as never } }
      : {}),
  } as CmsConfig;
}

async function builtField(name: string, value: unknown, app: CmsApp) {
  return value === undefined ? {} : { [name]: await built(value, app) };
}
