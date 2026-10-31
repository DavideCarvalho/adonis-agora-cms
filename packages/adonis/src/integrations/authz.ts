import type { AccessFn, CollectionAccess } from '../config/types.js';

export type CanCheck = (
  user: unknown,
  ability: string,
  resource?: unknown,
) => boolean | Promise<boolean>;

export function authzAccess(ability: string, can: CanCheck): AccessFn {
  return ({ user, id, data }) => can(user, ability, { id, ...data });
}

export function authzCollectionAccess(prefix: string, can: CanCheck): Required<CollectionAccess> {
  return {
    read: authzAccess(`${prefix}.read`, can),
    create: authzAccess(`${prefix}.create`, can),
    update: authzAccess(`${prefix}.update`, can),
    delete: authzAccess(`${prefix}.delete`, can),
  };
}
