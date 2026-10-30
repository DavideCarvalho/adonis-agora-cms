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

/** Access function that only requires an authenticated principal. */
export const requiresUser: AccessFn = ({ user }) => Boolean(user);

/** Access function that requires one of the given roles (`user.role`). */
export function requiresRole(...roles: readonly string[]): AccessFn {
  return ({ user }) => {
    if (!user || typeof user !== 'object') return false;
    const role = (user as { role?: unknown }).role;
    return typeof role === 'string' && roles.includes(role);
  };
}
