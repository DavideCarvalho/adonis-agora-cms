/**
 * Where failed logins are counted. In memory by default (per process); a shared store makes the
 * limits hold across every process of the app.
 */
export type LoginAttemptStore = {
  /**
   * Failures recorded for `key` that have not expired yet. 0 when there are none. `windowMs` is the
   * same on every call; stores that keep one counter per window need it.
   */
  count(key: string, windowMs: number): Promise<number>;
  /** Records one failure and returns the new count. It expires `windowMs` after the last one. */
  increment(key: string, windowMs: number): Promise<number>;
  /** Forgets every failure for `key`. */
  clear(key: string, windowMs: number): Promise<void>;
};

/** Most keys the in-memory store keeps; the least recently failed go first. */
const MAX_TRACKED = 10_000;

/**
 * The in-memory store. Expired keys are dropped as it goes and it never holds more than
 * `capacity` keys, so a flood of addresses or e-mails cannot grow it without bound.
 */
export class MemoryAttemptStore implements LoginAttemptStore {
  readonly #buckets = new Map<string, { count: number; until: number }>();
  #nextSweep = 0;

  constructor(
    readonly capacity = MAX_TRACKED,
    readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.#buckets.size;
  }

  async count(key: string): Promise<number> {
    const bucket = this.#buckets.get(key);
    return bucket && bucket.until > this.now() ? bucket.count : 0;
  }

  async increment(key: string, windowMs: number): Promise<number> {
    const now = this.now();
    this.#sweep(now, windowMs);
    const bucket = this.#buckets.get(key);
    const count = bucket && bucket.until > now ? bucket.count + 1 : 1;
    // Re-inserted, so the map's order is the eviction order.
    this.#buckets.delete(key);
    this.#buckets.set(key, { count, until: now + windowMs });
    while (this.#buckets.size > this.capacity) {
      const oldest = this.#buckets.keys().next().value;
      if (oldest === undefined) break;
      this.#buckets.delete(oldest);
    }
    return count;
  }

  async clear(key: string): Promise<void> {
    this.#buckets.delete(key);
  }

  #sweep(now: number, windowMs: number): void {
    if (now < this.#nextSweep) return;
    this.#nextSweep = now + Math.min(windowMs, 60_000);
    for (const [key, bucket] of this.#buckets) {
      if (bucket.until <= now) this.#buckets.delete(key);
    }
  }
}

/** The part of an `@adonisjs/redis` connection the store uses. */
type RedisLike = {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

/** Counts in Redis (`@adonisjs/redis`): `INCR` plus a `PEXPIRE` refreshed on every failure. */
export function redisAttemptStore(
  redis: RedisLike,
  prefix = 'cms:login-attempts:',
): LoginAttemptStore {
  return {
    async count(key) {
      return Number((await redis.get(prefix + key)) ?? 0);
    },
    async increment(key, windowMs) {
      const count = await redis.incr(prefix + key);
      await redis.pexpire(prefix + key, windowMs);
      return count;
    },
    async clear(key) {
      await redis.del(prefix + key);
    },
  };
}

/** The part of `@adonisjs/limiter`'s manager (and the limiter it hands out) the store uses. */
type LimiterManagerLike = {
  use(options: { requests: number; duration: number }): {
    get(key: string): Promise<{ consumed: number } | null>;
    increment(key: string): Promise<{ consumed: number }>;
    delete(key: string): Promise<unknown>;
  };
};

/**
 * Counts with `@adonisjs/limiter` (v2 or v3), on whatever store the app configured for it (Redis,
 * database…). The limiter never blocks by itself: the CMS compares the count with its own limits.
 */
export function limiterAttemptStore(
  manager: LimiterManagerLike,
  prefix = 'cms:login-attempts:',
): LoginAttemptStore {
  const limiters = new Map<number, ReturnType<LimiterManagerLike['use']>>();
  const limiter = (windowMs: number) => {
    let found = limiters.get(windowMs);
    if (!found) {
      found = manager.use({
        requests: Number.MAX_SAFE_INTEGER,
        duration: Math.max(1, Math.ceil(windowMs / 1000)),
      });
      limiters.set(windowMs, found);
    }
    return found;
  };
  return {
    async count(key, windowMs) {
      return (await limiter(windowMs).get(prefix + key))?.consumed ?? 0;
    },
    async increment(key, windowMs) {
      return (await limiter(windowMs).increment(prefix + key)).consumed;
    },
    async clear(key, windowMs) {
      await limiter(windowMs).delete(prefix + key);
    },
  };
}

export function isAttemptStore(value: unknown): value is LoginAttemptStore {
  const store = value as Partial<LoginAttemptStore> | null;
  return (
    typeof store === 'object' &&
    store !== null &&
    typeof store.count === 'function' &&
    typeof store.increment === 'function' &&
    typeof store.clear === 'function'
  );
}

type ContainerLike = { hasBinding(name: string): boolean; make(name: string): Promise<unknown> };

/**
 * A shared store the app already has, with no configuration: `@adonisjs/limiter` first (it already
 * knows which backend to use), then `@adonisjs/redis`. `null` when there is neither.
 */
export async function detectAttemptStore(
  container: ContainerLike,
): Promise<{ store: LoginAttemptStore; source: string } | null> {
  if (container.hasBinding('limiter.manager')) {
    const manager = await container.make('limiter.manager');
    if (typeof (manager as { use?: unknown })?.use === 'function') {
      return {
        store: limiterAttemptStore(manager as LimiterManagerLike),
        source: '@adonisjs/limiter',
      };
    }
  }
  if (container.hasBinding('redis')) {
    const redis = (await container.make('redis')) as Partial<RedisLike> | null;
    if (
      typeof redis?.incr === 'function' &&
      typeof redis.pexpire === 'function' &&
      typeof redis.get === 'function' &&
      typeof redis.del === 'function'
    ) {
      return { store: redisAttemptStore(redis as RedisLike), source: '@adonisjs/redis' };
    }
  }
  return null;
}

/**
 * Wraps a shared store so an outage never locks everyone out or lets everyone through: while it
 * fails, counting falls back to this process's memory, and the error is logged once a minute.
 */
export function withFallback(
  store: LoginAttemptStore,
  onError: (error: unknown) => void,
  fallback: LoginAttemptStore = new MemoryAttemptStore(),
): LoginAttemptStore {
  let lastReport = 0;
  const guard = async <T>(shared: () => Promise<T>, local: () => Promise<T>): Promise<T> => {
    try {
      return await shared();
    } catch (error) {
      if (Date.now() - lastReport > 60_000) {
        lastReport = Date.now();
        onError(error);
      }
      return local();
    }
  };
  return {
    count: (key, windowMs) =>
      guard(
        () => store.count(key, windowMs),
        () => fallback.count(key, windowMs),
      ),
    increment: (key, windowMs) =>
      guard(
        () => store.increment(key, windowMs),
        () => fallback.increment(key, windowMs),
      ),
    clear: (key, windowMs) =>
      guard(
        () => store.clear(key, windowMs),
        () => fallback.clear(key, windowMs),
      ),
  };
}
