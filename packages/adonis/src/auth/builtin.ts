import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { collection } from '../config/collection.js';
import { fields } from '../config/fields.js';
import type { AccessFn, CmsConfigInput, CollectionConfig } from '../config/types.js';
import { CmsConfigError } from '../errors.js';
import type { CmsAuthAdapter } from '../integrations/authkit.js';
import type { Cms } from '../local_api/index.js';
import type { RepoContext } from '../repository/document.js';
import { exec, ident, selectOne, sqlTimestamp } from '../repository/sql.js';
import type { CmsRouter } from '../rest/routes.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  length: number,
) => Promise<Buffer>;

const COOKIE = 'cms_session';
const MIN_PASSWORD = 8;
const RESET_TTL_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export type CmsMail = {
  send(message: { to: string; subject: string; text: string }): Promise<unknown>;
};

export type BuiltinAuthOptions = {
  /** Signs sessions and reset links. At least 32 characters; keep it out of the repository. */
  secret: string;
  /** The collection holding the users. Add it with `usersPlugin`. Default `users`. */
  collection?: string;
  /** Session lifetime in seconds. Default 7 days. */
  ttlSeconds?: number;
  /** Delivers password reset links. Without it, the panel offers no reset. */
  mail?: CmsMail;
};

export type BuiltinAuth = CmsAuthAdapter & {
  builtin: Required<Pick<BuiltinAuthOptions, 'secret' | 'collection' | 'ttlSeconds'>> & {
    mail: CmsMail | undefined;
  };
};

/* --------------------------------------------------------------- passwords */

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Unknown e-mails spend the same time as known ones, so a login cannot be used to find users.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

/* ------------------------------------------------------------------ tokens */

type TokenPayload = { sub: string; ver: number; exp: number; use: 'session' | 'reset' };

function sign(payload: TokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token: string, secret: string, use: TokenPayload['use']): TokenPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const received = Buffer.from(mac);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    return payload.use === use && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- credentials */

const table = (ctx: RepoContext) => ident(`${ctx.spec.tablePrefix}auth_credentials`, ctx.engine);

async function readCredential(ctx: RepoContext, userId: string) {
  return selectOne(
    ctx.client,
    `select * from ${table(ctx)} where ${ident('user_id', ctx.engine)} = ?`,
    [userId],
  ) as Promise<{ password_hash: string; version: number } | null>;
}

/** Bumps the version: every session and reset link issued before stops working. */
async function writeCredential(
  ctx: RepoContext,
  userId: string,
  password: string,
): Promise<number> {
  const hash = await hashPassword(password);
  const now = sqlTimestamp(new Date(), ctx.engine);
  const current = await readCredential(ctx, userId);
  if (current) {
    const version = Number(current.version) + 1;
    await exec(
      ctx.client,
      `update ${table(ctx)} set ${ident('password_hash', ctx.engine)} = ?, ${ident('version', ctx.engine)} = ?, ${ident('updated_at', ctx.engine)} = ? where ${ident('user_id', ctx.engine)} = ?`,
      [hash, version, now, userId],
    );
    return version;
  }
  await exec(
    ctx.client,
    `insert into ${table(ctx)} (${['user_id', 'password_hash', 'version', 'updated_at'].map((c) => ident(c, ctx.engine)).join(', ')}) values (?, ?, ?, ?)`,
    [userId, hash, 1, now],
  );
  return 1;
}

async function hasAnyCredential(ctx: RepoContext): Promise<boolean> {
  const row = await selectOne(ctx.client, `select count(*) as total from ${table(ctx)}`, []);
  return Number(row?.total ?? 0) > 0;
}

/* ----------------------------------------------------------------- adapter */

type CookieContext = {
  request: { header?(name: string): string | undefined; headers?(): Record<string, string> };
};

function readCookie(context: unknown): string | null {
  const request = (context as CookieContext).request;
  const raw = request.header?.('cookie') ?? request.headers?.().cookie ?? '';
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(raw);
  return match?.[1] ?? null;
}

/**
 * The CMS's own login, for an app that has none: a `users` collection, a signed session cookie and a
 * login screen in the panel. The other side of the same port as `adonisAuth` and `authkitAuth`.
 */
export function cmsAuth(options: BuiltinAuthOptions): BuiltinAuth {
  if (!options.secret || options.secret.length < 32) {
    throw new CmsConfigError(
      'integrations.auth',
      'cmsAuth needs a secret of at least 32 characters',
    );
  }
  const settings = {
    secret: options.secret,
    collection: options.collection ?? 'users',
    ttlSeconds: options.ttlSeconds ?? 7 * 24 * 60 * 60,
    mail: options.mail,
  };

  return {
    builtin: settings,
    async resolveUser(context) {
      const token = readCookie(context);
      const payload = token ? verify(token, settings.secret, 'session') : null;
      if (!payload) return null;
      const cms = activeCms;
      if (!cms) return null;
      const ctx = cms.repoContext();
      const credential = await readCredential(ctx, payload.sub);
      if (!credential || Number(credential.version) !== payload.ver) return null;
      return cms
        .collection(settings.collection as never)
        .findByID(payload.sub as never, { overrideAccess: true, depth: 0 } as never);
    },
  };
}

// The adapter is created in the config file, before the instance exists.
let activeCms: Cms | undefined;

/* ------------------------------------------------------------------ plugin */

const isAdmin = (user: unknown) => (user as { role?: unknown } | null)?.role === 'admin';
const requiresAdmin: AccessFn = ({ user }) => isAdmin(user);
const signedIn: AccessFn = ({ user }) => Boolean(user);

/** Adds the collection `cmsAuth` signs people into. Only an admin can change who is an admin. */
export function usersPlugin(options: { slug?: string } = {}) {
  return (config: CmsConfigInput): CmsConfigInput => ({
    ...config,
    collections: [
      ...(config.collections ?? []),
      collection(options.slug ?? 'users', {
        labels: { singular: 'User', plural: 'Users' },
        admin: { useAsTitle: 'email', defaultColumns: ['email', 'name', 'role'] },
        versions: { drafts: false },
        access: { read: signedIn, create: requiresAdmin, update: signedIn, delete: requiresAdmin },
        fields: [
          fields.email('email', { required: true, unique: true }),
          fields.text('name'),
          fields.select('role', {
            required: true,
            defaultValue: 'editor',
            access: { update: requiresAdmin },
            options: [
              { label: 'Admin', value: 'admin' },
              { label: 'Editor', value: 'editor' },
            ],
          }),
        ],
      }) as CollectionConfig,
    ],
  });
}

/* ------------------------------------------------------------------ routes */

type AuthContext = {
  params: Record<string, string>;
  request: {
    body(): unknown;
    protocol?(): string;
    ip?(): string;
    header?(name: string): string | undefined;
    headers?(): Record<string, string>;
    secure?(): boolean;
  };
  response: {
    header(name: string, value: string): unknown;
    status(code: number): { json(payload: unknown): unknown };
  };
};

const failure = (ctx: AuthContext, status: number, code: string, message: string) =>
  ctx.response.status(status).json({ error: { code, message } });

export function registerAuthRoutes(
  router: CmsRouter,
  cms: Cms,
  auth: BuiltinAuth,
  options: { prefix: string; adminPath: string },
): void {
  activeCms = cms;
  const { secret, collection: slug, ttlSeconds, mail } = auth.builtin;
  const repo = () => cms.repoContext();
  const users = () =>
    cms.collection(slug as never) as unknown as {
      find(query: unknown, options?: unknown): Promise<{ docs: Record<string, unknown>[] }>;
      create(data: unknown, options?: unknown): Promise<Record<string, unknown>>;
    };
  const attempts = new Map<string, { count: number; until: number }>();

  const startSession = (ctx: AuthContext, userId: string, version: number) => {
    const token = sign(
      { sub: userId, ver: version, exp: Date.now() + ttlSeconds * 1000, use: 'session' },
      secret,
    );
    const secure = ctx.request.secure?.() ? '; Secure' : '';
    ctx.response.header(
      'Set-Cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}${secure}`,
    );
  };

  const findByEmail = async (email: string) => {
    const { docs } = await users().find(
      { where: { email: { equals: email.trim().toLowerCase() } }, limit: 1, depth: 0 },
      { overrideAccess: true },
    );
    return docs[0] ?? null;
  };

  const body = (ctx: AuthContext) => (ctx.request.body() ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');

  router.get(`${options.prefix}/auth/status`, async (context) => {
    const ctx = context as AuthContext;
    ctx.response.status(200).json({
      needsFirstUser: !(await hasAnyCredential(repo())),
      canReset: Boolean(mail),
    });
  });

  router.post(`${options.prefix}/auth/first-user`, async (context) => {
    const ctx = context as AuthContext;
    if (await hasAnyCredential(repo())) {
      return failure(ctx, 403, 'CMS_FORBIDDEN', 'the first user already exists');
    }
    const { email, password, name } = body(ctx);
    if (text(password).length < MIN_PASSWORD) {
      return failure(ctx, 422, 'CMS_VALIDATION', `password needs ${MIN_PASSWORD} characters`);
    }
    const user = await users().create(
      { email: text(email).trim().toLowerCase(), name: text(name), role: 'admin' },
      { overrideAccess: true },
    );
    const version = await writeCredential(repo(), String(user.id), text(password));
    startSession(ctx, String(user.id), version);
    return ctx.response.status(201).json({ user });
  });

  router.post(`${options.prefix}/auth/login`, async (context) => {
    const ctx = context as AuthContext;
    const email = text(body(ctx).email).trim().toLowerCase();
    const password = text(body(ctx).password);

    const key = `${ctx.request.ip?.() ?? ''}|${email}`;
    const seen = attempts.get(key);
    if (seen && seen.until > Date.now() && seen.count >= MAX_ATTEMPTS) {
      return failure(ctx, 429, 'CMS_RATE_LIMITED', 'too many attempts, try again later');
    }

    const user = await findByEmail(email);
    const credential = user ? await readCredential(repo(), String(user.id)) : null;
    const valid = await verifyPassword(password, credential?.password_hash ?? (await DUMMY_HASH));
    if (!user || !credential || !valid) {
      attempts.set(key, {
        count: seen && seen.until > Date.now() ? seen.count + 1 : 1,
        until: Date.now() + ATTEMPT_WINDOW_MS,
      });
      return failure(ctx, 401, 'CMS_INVALID_LOGIN', 'wrong e-mail or password');
    }

    attempts.delete(key);
    startSession(ctx, String(user.id), Number(credential.version));
    return ctx.response.status(200).json({ user });
  });

  router.post(`${options.prefix}/auth/logout`, async (context) => {
    const ctx = context as AuthContext;
    ctx.response.header('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return ctx.response.status(200).json({ ok: true });
  });

  router.post(`${options.prefix}/auth/forgot`, async (context) => {
    const ctx = context as AuthContext;
    // Always the same answer: the form must not reveal who has an account.
    const answer = () => ctx.response.status(200).json({ ok: true });
    if (!mail) return answer();

    const email = text(body(ctx).email).trim().toLowerCase();
    const user = await findByEmail(email);
    const credential = user ? await readCredential(repo(), String(user.id)) : null;
    if (!user || !credential) return answer();

    const token = sign(
      {
        sub: String(user.id),
        ver: Number(credential.version),
        exp: Date.now() + RESET_TTL_MS,
        use: 'reset',
      },
      secret,
    );
    const origin = ctx.request.header?.('origin') ?? ctx.request.headers?.().origin ?? '';
    await mail
      .send({
        to: email,
        subject: 'Reset your password',
        text: `Open this link within an hour to choose a new password:\n\n${origin}${options.adminPath}#/reset/${token}\n\nIf you did not ask for it, ignore this message.`,
      })
      .catch((error: unknown) => console.error('[cms] reset e-mail failed', error));
    return answer();
  });

  router.post(`${options.prefix}/auth/reset`, async (context) => {
    const ctx = context as AuthContext;
    const payload = verify(text(body(ctx).token), secret, 'reset');
    const credential = payload ? await readCredential(repo(), payload.sub) : null;
    // The version makes the link single use: changing the password invalidates it.
    if (!payload || !credential || Number(credential.version) !== payload.ver) {
      return failure(ctx, 400, 'CMS_INVALID_TOKEN', 'this link is no longer valid');
    }
    const password = text(body(ctx).password);
    if (password.length < MIN_PASSWORD) {
      return failure(ctx, 422, 'CMS_VALIDATION', `password needs ${MIN_PASSWORD} characters`);
    }
    const version = await writeCredential(repo(), payload.sub, password);
    startSession(ctx, payload.sub, version);
    return ctx.response.status(200).json({ ok: true });
  });

  router.post(`${options.prefix}/auth/password`, async (context) => {
    const ctx = context as AuthContext;
    const actor = (await auth.resolveUser(context)) as { id?: unknown; role?: unknown } | null;
    if (!actor) return failure(ctx, 401, 'CMS_UNAUTHORIZED', 'sign in first');

    const target = text(body(ctx).userId) || String(actor.id);
    const own = target === String(actor.id);
    if (!own && !isAdmin(actor)) {
      return failure(ctx, 403, 'CMS_FORBIDDEN', 'only an admin can set another password');
    }
    const password = text(body(ctx).password);
    if (password.length < MIN_PASSWORD) {
      return failure(ctx, 422, 'CMS_VALIDATION', `password needs ${MIN_PASSWORD} characters`);
    }
    const version = await writeCredential(repo(), target, password);
    // Changing your own password signs out everywhere else, but not here.
    if (own) startSession(ctx, target, version);
    return ctx.response.status(200).json({ ok: true });
  });
}
