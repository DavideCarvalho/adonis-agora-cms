import type { AccessFn } from '../config/types.js';

export type CanCheck = (user: unknown, ability: string, resource?: unknown) => boolean;

/**
 * Bridges an `@adonis-agora/authz` ability into a CMS access function.
 *
 * Structural on purpose: pass `(user, ability, resource) => authz.can(user, ability, resource)`
 * and the CMS keeps owning the document-level semantics.
 */
export function authzAccess(ability: string, can: CanCheck): AccessFn {
  return ({ user, id, data }) => can(user, ability, { id, ...data });
}

/** Convenience for the four collection operations. */
export function authzCollectionAccess(
  prefix: string,
  can: CanCheck,
): { read: AccessFn; create: AccessFn; update: AccessFn; delete: AccessFn } {
  return {
    read: authzAccess(`${prefix}.read`, can),
    create: authzAccess(`${prefix}.create`, can),
    update: authzAccess(`${prefix}.update`, can),
    delete: authzAccess(`${prefix}.delete`, can),
  };
}
