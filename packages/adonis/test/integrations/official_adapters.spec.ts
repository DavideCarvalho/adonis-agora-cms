import { Bouncer } from '@adonisjs/bouncer';
import { describe, expect, test, vi } from 'vitest';
import { adonisAuth, bouncerAccess, driveMedia, driveUploads } from '../../src/index.js';

/* The queue and Drive adapters run for real in `examples/blog`, through the official providers. */

describe('driveUploads', () => {
  const file = {
    filename: '../../etc/passwd.png',
    mimeType: 'image/png',
    size: 3,
    contents: Buffer.from('abc'),
  } as never;
  const context = { field: 'banner', collection: '' };

  test('generates the key, and accepts a disk that only exists after boot', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const disk = { put, getUrl: async (key: string) => `/files/${key}` };

    const asset = await driveUploads(async () => disk)(file, context);

    expect(asset.id).toMatch(/^cms\/[0-9a-f-]{36}\.png$/);
    expect(put.mock.calls[0]?.[0]).toBe(asset.id);
    expect((await driveMedia(disk).resolveMany([asset.id])).get(asset.id)?.url).toBe(
      `/files/${asset.id}`,
    );
  });

  test('refuses a prefix that would not fit the column', async () => {
    const disk = { put: vi.fn(), getUrl: async () => '' };
    await expect(driveUploads(disk, { prefix: 'x'.repeat(40) })(file, context)).rejects.toThrow(
      /too long/,
    );
    expect(disk.put).not.toHaveBeenCalled();
  });
});

describe('@adonisjs/bouncer', () => {
  const args = { req: null, tenant: null };

  test('an ability decides, and a guest is refused unless it allows guests', async () => {
    const edit = Bouncer.ability((user: { id: number }, post: { owner?: number }) => {
      return post.owner === user.id;
    });
    const access = bouncerAccess(edit as never);

    await expect(access({ ...args, user: { id: 1 }, doc: { owner: 1 } } as never)).resolves.toBe(
      true,
    );
    await expect(access({ ...args, user: { id: 2 }, doc: { owner: 1 } } as never)).resolves.toBe(
      false,
    );
    await expect(access({ ...args, user: null, doc: { owner: 1 } } as never)).resolves.toBe(false);

    const open = Bouncer.ability({ allowGuest: true }, () => true);
    await expect(bouncerAccess(open as never)({ ...args, user: null } as never)).resolves.toBe(
      true,
    );
  });

  test('an async ability that denies really denies', async () => {
    const edit = Bouncer.ability(async () => false);
    await expect(bouncerAccess(edit as never)({ ...args, user: { id: 1 } } as never)).resolves.toBe(
      false,
    );
  });
});

describe('@adonisjs/auth', () => {
  const user = { id: 1 };

  test('reads the guard, and an unauthenticated or missing guard is anonymous', async () => {
    const use = vi.fn().mockReturnValue({ check: async () => true, user });
    await expect(adonisAuth({ guard: 'web' }).resolveUser({ auth: { use } })).resolves.toBe(user);
    expect(use).toHaveBeenCalledWith('web');

    const out = { use: () => ({ check: async () => false }) };
    await expect(adonisAuth().resolveUser({ auth: out })).resolves.toBeNull();
    await expect(adonisAuth().resolveUser({})).resolves.toBeNull();
  });
});
