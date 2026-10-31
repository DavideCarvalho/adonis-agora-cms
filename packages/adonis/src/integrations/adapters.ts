import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { CmsMail } from '../auth/builtin.js';
import type { AccessFn, CmsUploadHandler } from '../config/types.js';
import { CmsConfigError } from '../errors.js';
import type { CmsAuthAdapter } from './authkit.js';
import type { MediaAdapter } from './media.js';
import type { CmsObserver } from './telescope.js';
import type { CmsJobs, DeliverWebhookInput } from './webhooks.js';

/*
 * Each port has an Agora adapter and an official AdonisJS one, or takes a plain function. All of them
 * are structural: the host passes its own instance, so the CMS imports none of these libraries, none
 * is a dependency, and two copies of a package in `node_modules` cannot break a class lookup.
 */

/* ---------------------------------------------------------------- jobs */

/**
 * `@adonis-agora/durable`. Export `CmsDeliverWebhook` from `app/workflows`. The engine comes from a
 * function because it does not exist yet when the config file loads.
 */
export function durableJobs(
  engine: () =>
    | { start(workflow: string, input: unknown, runId: string): Promise<unknown> }
    | Promise<{ start(workflow: string, input: unknown, runId: string): Promise<unknown> }>,
): CmsJobs {
  return {
    async deliverWebhook(input) {
      return (await engine()).start('cms.deliver-webhook', input, randomUUID());
    },
  };
}

/**
 * `@adonisjs/queue`, or any other queue: pass how to enqueue, and have the job call
 * `runWebhookDelivery(payload)`. The job comes from a dynamic import: it needs the booted app.
 */
export function queueJobs(options: {
  deliverWebhook: (input: DeliverWebhookInput) => unknown;
}): CmsJobs {
  return {
    async deliverWebhook(input) {
      return options.deliverWebhook(input);
    },
  };
}

/* ---------------------------------------------------------------- auth */

type AdonisGuard = { check(): Promise<boolean>; user?: unknown };
type AdonisAuth = { use(guard?: string): AdonisGuard };

/**
 * `@adonisjs/auth`: checks the guard itself, so the CMS routes need no `silentAuth` middleware. A
 * request without a session is anonymous, never an error.
 */
export function adonisAuth(options: { guard?: string } = {}): CmsAuthAdapter {
  return {
    async resolveUser(context) {
      const auth = (context as { auth?: AdonisAuth }).auth;
      if (!auth) return null;
      try {
        const guard = auth.use(options.guard);
        return (await guard.check()) ? (guard.user ?? null) : null;
      } catch {
        return null;
      }
    },
  };
}

/* --------------------------------------------------------------- access */

type BouncerAbility = {
  allowGuest?: boolean;
  original: (user: never, ...args: never[]) => unknown;
};

/** `@adonisjs/bouncer`: one of your abilities as a CMS access function, sync or async. */
export function bouncerAccess(ability: BouncerAbility): AccessFn {
  return async ({ user, id, data, doc }) => {
    if (!user && !ability.allowGuest) return false;
    const answer = await (ability.original as (user: unknown, resource: unknown) => unknown)(user, {
      id,
      ...doc,
      ...data,
    });
    if (typeof answer === 'boolean') return answer;
    // Bouncer's `AuthorizationResponse.deny()` carries the verdict in `authorized`.
    return (answer as { authorized?: boolean } | null)?.authorized === true;
  };
}

/* -------------------------------------------------------------- storage */

type DriveDisk = {
  put(
    key: string,
    contents: Uint8Array | string,
    options?: { contentType?: string },
  ): Promise<void>;
  getUrl(key: string): Promise<string>;
  getSignedUrl?(key: string, options?: { expiresIn?: string | number }): Promise<string>;
};

/** A disk from `drive.use()`, usually behind a function: the service only exists after boot. */
type DiskSource = DriveDisk | (() => DriveDisk | Promise<DriveDisk>);

const resolveDisk = async (disk: DiskSource) => (typeof disk === 'function' ? disk() : disk);

type UrlOptions = {
  /** For a private disk: a plain URL there answers 403. */
  signed?: boolean;
  /** Lifetime of a signed URL. Default `1h`. */
  expiresIn?: string | number;
};

function urlOf(disk: DriveDisk, key: string, options: UrlOptions): Promise<string> {
  if (!options.signed) return disk.getUrl(key);
  if (!disk.getSignedUrl) {
    throw new CmsConfigError('uploads', 'this disk cannot sign URLs');
  }
  return disk.getSignedUrl(key, { expiresIn: options.expiresIn ?? '1h' });
}

/** The `upload` column holds this many characters. */
const MAX_KEY_LENGTH = 64;

/**
 * `@adonisjs/drive` for `uploads.handler`. The key is generated: a client file name never becomes a
 * path. Pair it with `driveMedia`, which turns the stored key back into a URL on read.
 */
export function driveUploads(
  disk: DiskSource,
  options: { prefix?: string } & UrlOptions = {},
): CmsUploadHandler {
  return async (file) => {
    const target = await resolveDisk(disk);
    const extension = extname(file.filename)
      .replace(/[^.a-zA-Z0-9]/g, '')
      .slice(0, 12);
    const key = `${options.prefix ?? 'cms'}/${randomUUID()}${extension}`;
    if (key.length > MAX_KEY_LENGTH) {
      throw new CmsConfigError(
        'uploads',
        `driveUploads prefix is too long for a ${MAX_KEY_LENGTH} character key`,
      );
    }
    await target.put(key, file.contents, { contentType: file.mimeType });
    return {
      id: key,
      filename: file.filename,
      url: await urlOf(target, key, options),
      mime: file.mimeType,
    };
  };
}

export function driveMedia(disk: DiskSource, options: UrlOptions = {}): MediaAdapter {
  return {
    async resolveMany(ids) {
      const target = await resolveDisk(disk);
      const unique = [...new Set(ids)].filter(Boolean);
      const urls = await Promise.all(unique.map((id) => urlOf(target, id, options)));
      return new Map(unique.map((id, index) => [id, { id, url: urls[index] as string }]));
    },
  };
}

/* ----------------------------------------------------------------- mail */

type AdonisMailer = {
  send(callback: (message: never) => unknown): Promise<unknown>;
};
type AdonisMessage = {
  to(address: string): AdonisMessage;
  subject(subject: string): AdonisMessage;
  text(content: string): AdonisMessage;
};

/** `@adonisjs/mail` for `cmsAuth`. The service only exists after boot, hence the function. */
export function adonisMail(mailer: () => AdonisMailer | Promise<AdonisMailer>): CmsMail {
  return {
    async send({ to, subject, text }) {
      const target = await mailer();
      return target.send(((message: AdonisMessage) =>
        message.to(to).subject(subject).text(text)) as (message: never) => unknown);
    },
  };
}

/* -------------------------------------------------------- observability */

/** The AdonisJS logger. For `@adonis-agora/telescope`, use `telescopeWatcher`. */
export function loggerObserver(logger: {
  info(data: unknown, message: string): void;
  error(data: unknown, message: string): void;
}): CmsObserver {
  return (observation) => {
    if (observation.ok) logger.info(observation, 'cms write');
    else logger.error(observation, 'cms write failed');
  };
}
