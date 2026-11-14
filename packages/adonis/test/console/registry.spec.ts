import { describe, expect, it, vi } from 'vitest';
import {
  AGORA_CONSOLES_BINDING,
  type AgoraConsoleEntry,
  type AgoraConsoleRegistry,
  type HttpContext,
  listVisibleConsoles,
  otherConsoles,
  registerAgoraConsole,
  searchConsoles,
} from '../../src/console/registry.js';

function fakeContainer() {
  const values = new Map<string, unknown>();
  return {
    values,
    hasBinding: (key: string) => values.has(key),
    bindValue: (key: string, value: unknown) => void values.set(key, value),
    make: async (key: string) => values.get(key),
  };
}

const allow = async () => ({ allowed: true });
const deny = async () => ({ allowed: false, reason: 'forbidden' });

function entry(over: Partial<AgoraConsoleEntry> & { id: string }): AgoraConsoleEntry {
  return {
    title: over.id,
    icon: 'generic',
    path: `/${over.id}`,
    order: 50,
    authorize: allow,
    ...over,
  };
}

const ctx = {} as HttpContext;

describe('registerAgoraConsole', () => {
  it('creates the registry when absent and reuses it when present', async () => {
    const container = fakeContainer();
    expect(await registerAgoraConsole(container, entry({ id: 'durable' }))).toBe(true);
    // A second lib's copy of the helper appends to the same value.
    expect(await registerAgoraConsole(container, entry({ id: 'payments' }))).toBe(true);
    const registry = container.values.get(AGORA_CONSOLES_BINDING) as AgoraConsoleRegistry;
    expect(registry.version).toBe(1);
    expect(registry.entries.map((e) => e.id)).toEqual(['durable', 'payments']);
  });

  it('skips a registry of another version', async () => {
    const container = fakeContainer();
    container.bindValue(AGORA_CONSOLES_BINDING, { version: 2, entries: [] });
    expect(await registerAgoraConsole(container, entry({ id: 'durable' }))).toBe(false);
  });

  it('warns on a duplicate id', async () => {
    const container = fakeContainer();
    const warn = vi.fn();
    await registerAgoraConsole(container, entry({ id: 'durable' }), { warn });
    expect(await registerAgoraConsole(container, entry({ id: 'durable' }), { warn })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"durable" already registered'));
  });

  it('rejects a bad id or path', async () => {
    const container = fakeContainer();
    await expect(registerAgoraConsole(container, entry({ id: 'Bad Id' }))).rejects.toThrow();
    await expect(
      registerAgoraConsole(container, entry({ id: 'x', path: '//evil.example' })),
    ).rejects.toThrow();
    await expect(
      registerAgoraConsole(container, entry({ id: 'y', path: 'https://evil.example' })),
    ).rejects.toThrow();
  });
});

describe('listVisibleConsoles', () => {
  it('lists the allowed others, sorted, without self, never a reason', async () => {
    const registry: AgoraConsoleRegistry = {
      version: 1,
      entries: [
        entry({ id: 'durable', order: 10 }),
        entry({ id: 'media', order: 50, icon: 'media' }),
        entry({ id: 'payments', order: 40, authorize: deny }),
        entry({ id: 'telescope', order: 20, package: '@adonis-agora/telescope' }),
        entry({
          id: 'agent',
          order: 30,
          authorize: async () => ({ allowed: false, redirectTo: '/login' }),
        }),
        entry({ id: 'odd', order: 60, icon: 'weird' as never }),
        entry({ id: 'broken', order: 70, authorize: async () => Promise.reject(new Error('x')) }),
      ],
    };
    const out = await listVisibleConsoles(registry, 'durable', ctx);
    expect(out).toEqual({
      version: 1,
      current: 'durable',
      consoles: [
        {
          id: 'telescope',
          title: 'telescope',
          package: '@adonis-agora/telescope',
          icon: 'generic',
          href: '/telescope',
        },
        { id: 'media', title: 'media', icon: 'media', href: '/media' },
        { id: 'odd', title: 'odd', icon: 'generic', href: '/odd' },
      ],
    });
  });

  it('runs the gates in parallel and hides a slow one after 300 ms', async () => {
    vi.useFakeTimers();
    try {
      const slow = () =>
        new Promise<{ allowed: boolean }>((r) => setTimeout(() => r({ allowed: true }), 1000));
      const fine = () =>
        new Promise<{ allowed: boolean }>((r) => setTimeout(() => r({ allowed: true }), 200));
      const registry: AgoraConsoleRegistry = {
        version: 1,
        entries: [
          entry({ id: 'a', authorize: fine }),
          entry({ id: 'b', authorize: fine }),
          entry({ id: 'c', authorize: slow }),
        ],
      };
      const pending = listVisibleConsoles(registry, 'self', ctx);
      await vi.advanceTimersByTimeAsync(301);
      const out = await pending;
      // a + b each take 200 ms: run one after the other they would miss the 300 ms total.
      expect(out.consoles.map((c) => c.id)).toEqual(['a', 'b']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks ctx as a probe while the others decide', async () => {
    const seen: unknown[] = [];
    const probeCtx = {} as HttpContext & { agoraProbe?: boolean };
    const registry: AgoraConsoleRegistry = {
      version: 1,
      entries: [
        entry({
          id: 'x',
          authorize: async (c) => {
            seen.push((c as typeof probeCtx).agoraProbe);
            return { allowed: true };
          },
        }),
      ],
    };
    await listVisibleConsoles(registry, 'self', probeCtx);
    expect(seen).toEqual([true]);
    expect(probeCtx.agoraProbe).toBeUndefined();
  });

  it('is empty without a registry', async () => {
    expect((await listVisibleConsoles(undefined, 'durable', ctx)).consoles).toEqual([]);
    expect(otherConsoles(undefined, 'durable')).toBe(0);
  });
});

describe('searchConsoles', () => {
  it('searches self and the allowed others, 5 safe hits each', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ title: `p${i}`, href: `/payments#${i}` }));
    const registry: AgoraConsoleRegistry = {
      version: 1,
      entries: [
        entry({
          id: 'durable',
          order: 10,
          search: async () => [{ title: 'run-1', href: '/durable#/run/run-1' }],
        }),
        entry({ id: 'payments', order: 40, search: async () => many }),
        entry({
          id: 'media',
          order: 50,
          authorize: deny,
          search: async () => [{ title: 'm', href: '/m' }],
        }),
        entry({
          id: 'evil',
          order: 60,
          search: async () => [
            { title: 'x', href: 'https://evil.example' },
            { title: 'y', href: '//evil.example' },
          ],
        }),
        entry({ id: 'nosearch', order: 70 }),
      ],
    };
    const out = await searchConsoles(registry, 'durable', ctx, '  run  ');
    expect(out.q).toBe('run');
    expect(out.results.map((r) => r.id)).toEqual(['durable', 'payments']);
    expect(out.results[1]?.hits).toHaveLength(5);
  });

  it('answers nothing for a blank query', async () => {
    const registry: AgoraConsoleRegistry = {
      version: 1,
      entries: [entry({ id: 'a', search: async () => [{ title: 't', href: '/t' }] })],
    };
    expect((await searchConsoles(registry, 'a', ctx, '   ')).results).toEqual([]);
  });
});
