import type { AccessFn } from '../config/types.js';

/** Principal resolution contract — implemented by each auth integration. */
export type CmsAuthAdapter = {
  resolveUser(context: unknown): Promise<unknown | null>;
};

/**
 * Adapts `@adonis-agora/authkit` sessions without importing it.
 *
 * The host passes a function that reads its own session (`ctx.auth.user`, a guard, a JWT), so
 * the CMS never assumes an auth implementation.
 */
export function authkitAdapter(options: {
  resolveUser: (context: unknown) => unknown | Promise<unknown>;
}): CmsAuthAdapter {
  return {
    async resolveUser(context) {
      const user = await options.resolveUser(context);
      return user ?? null;
    },
  };
}

type AuthkitContext = { auth?: { check?(): Promise<unknown>; user?: unknown } };

/**
 * `@adonis-agora/authkit` through `ctx.auth` (the `authkitClientGuard`, or any `@adonisjs/auth`
 * guard): checks the session itself, so the CMS routes need no `silentAuth`. A failed check is
 * anonymous, never an error.
 */
export function authkitAuth(): CmsAuthAdapter {
  return {
    async resolveUser(context) {
      const auth = (context as AuthkitContext).auth;
      if (!auth) return null;
      try {
        await auth.check?.();
        return auth.user ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** Access function that only requires an authenticated principal. */
export const requiresUser: AccessFn = ({ user }) => Boolean(user);

type RoleBearer = { role?: unknown; roles?: unknown; globalRoles?: unknown };

function rolesOf(user: RoleBearer): string[] {
  const found: string[] = [];
  if (typeof user.role === 'string') found.push(user.role);
  for (const list of [user.roles, user.globalRoles]) {
    if (!Array.isArray(list)) continue;
    for (const role of list) if (typeof role === 'string') found.push(role);
  }
  return found;
}

/**
 * Access function that requires one of the given roles. It reads `user.role`, a `user.roles` array
 * and authkit's `user.globalRoles`, so it works with your own user model and with an authkit
 * identity user alike.
 */
export function requiresRole(...roles: readonly string[]): AccessFn {
  return ({ user }) => {
    if (!user || typeof user !== 'object') return false;
    return rolesOf(user as RoleBearer).some((role) => roles.includes(role));
  };
}
