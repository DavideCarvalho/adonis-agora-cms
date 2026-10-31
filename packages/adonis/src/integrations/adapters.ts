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
 * The ports themselves, built by the factories in `factories.ts` once the app exists. They only know the
 * shape of each library, so the CMS imports none of them and none is a dependency.
 */

/* ---------------------------------------------------------------- jobs */

export type DurableEngine = {
  start(workflow: string, input: unknown, runId: string): Promise<unknown>;
};

export function durableJobs(engine: () => Promise<DurableEngine>): CmsJobs {
  return {
    async deliverWebhook(input) {
      return (await engine()).start('cms.deliver-webhook', input, randomUUID());
    },
  };
}

type WebhookJobModule = {
  default: { dispatch(input: DeliverWebhookInput): unknown };
};

/**
 * `@adonisjs/queue`: `queueJobs(() => import('#jobs/deliver_cms_webhook'))`, where the job calls
 * `runWebhookDelivery(this.payload)`. For any other queue, pass `{ deliverWebhook }`.
 */
export function queueJobs(
  source:
    | (() => Promise<WebhookJobModule>)
    | { deliverWebhook: (input: DeliverWebhookInput) => unknown },
): CmsJobs {
  return {
    async deliverWebhook(input) {
      if (typeof source !== 'function') return source.deliverWebhook(input);
      return (await source()).default.dispatch(input);
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

export type DriveDisk = {
  put(
    key: string,
    contents: Uint8Array | string,
    options?: { contentType?: string },
  ): Promise<void>;
  getUrl(key: string): Promise<string>;
  getSignedUrl?(key: string, options?: { expiresIn?: string | number }): Promise<string>;
};

export type DriveManager = { use(name?: string): DriveDisk };

type DiskSource = () => DriveDisk | Promise<DriveDisk>;

export type UrlOptions = {
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
    const target = await disk();
    const extension = extname(file.filename)
      .replace(/[^.a-zA-Z0-9]/g, '')
      .slice(0, 12);
    const key = `${options.prefix ?? 'cms'}/${randomUUID()}${extension}`;
    if (key.length > MAX_KEY_LENGTH) {
      throw new CmsConfigError(
        'uploads',
        `uploads.drive prefix is too long for a ${MAX_KEY_LENGTH} character key`,
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
      const target = await disk();
      const unique = [...new Set(ids)].filter(Boolean);
      const urls = await Promise.all(unique.map((id) => urlOf(target, id, options)));
      return new Map(unique.map((id, index) => [id, { id, url: urls[index] as string }]));
    },
  };
}

/* ----------------------------------------------------------------- mail */

export type AdonisMailer = {
  send(callback: (message: never) => unknown): Promise<unknown>;
};
type AdonisMessage = {
  to(address: string): AdonisMessage;
  subject(subject: string): AdonisMessage;
  text(content: string): AdonisMessage;
};

export type AdonisMailManager = AdonisMailer & { use(name: string): AdonisMailer };

export function adonisMail(mailer: () => Promise<AdonisMailer>): CmsMail {
  return {
    async send({ to, subject, text }) {
      return (await mailer()).send(((message: AdonisMessage) =>
        message.to(to).subject(subject).text(text)) as (message: never) => unknown);
    },
  };
}

/* -------------------------------------------------------- observability */

export type AdonisLogger = {
  info(data: unknown, message: string): void;
  error(data: unknown, message: string): void;
};

export function loggerObserver(logger: () => Promise<AdonisLogger>): CmsObserver {
  return (observation) => {
    // An observer must never fail the write it is reporting on.
    logger()
      .then((target) => {
        if (observation.ok) target.info(observation, 'cms write');
        else target.error(observation, 'cms write failed');
      })
      .catch((error: unknown) => console.error('[cms] observer failed', error));
  };
}
