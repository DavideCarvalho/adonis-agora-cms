import { describe, expect, test } from 'vitest';
import { requiresRole } from '../../src/integrations/authkit.js';

const check = (user: unknown, ...roles: string[]) => requiresRole(...roles)({ req: null, user });

describe('requiresRole', () => {
  test('reads `user.role`', () => {
    expect(check({ role: 'admin' }, 'admin')).toBe(true);
    expect(check({ role: 'editor' }, 'admin')).toBe(false);
  });

  test('reads authkit `globalRoles` (the authkit identity user)', () => {
    const identity = { userId: 'u1', email: 'a@b.c', globalRoles: ['ADMIN', 'SUPPORT'] };
    expect(check(identity, 'ADMIN')).toBe(true);
    expect(check(identity, 'admin', 'SUPPORT')).toBe(true);
    expect(check(identity, 'EDITOR')).toBe(false);
  });

  test('reads a `roles` array', () => {
    expect(check({ roles: ['editor', 'admin'] }, 'admin')).toBe(true);
    expect(check({ roles: [] }, 'admin')).toBe(false);
  });

  test('any source grants the role', () => {
    expect(check({ role: 'editor', globalRoles: ['admin'] }, 'admin')).toBe(true);
  });

  test('refuses guests and malformed role fields', () => {
    expect(check(null, 'admin')).toBe(false);
    expect(check('admin', 'admin')).toBe(false);
    expect(check({ globalRoles: 'admin' }, 'admin')).toBe(false);
    expect(check({ roles: [1, null, { name: 'admin' }] }, 'admin')).toBe(false);
  });
});
