import crypto from 'crypto';

import {redis} from '../config/redis';

/**
 * Redis-backed Creator mutex lock (PRD §5.5 — "Redis, not Postgres", see
 * backend/docs/CLAUDE.md §2 `CreatorLock`). Used by `POST /requests/:id/accept` to guarantee
 * exactly one Creator can win a race to accept the same Request, and by the acceptance-timer
 * job to auto-release a Creator who never starts recording in time.
 *
 * When Redis is unavailable (e.g. free Render tier without Redis), falls back to an in-process
 * in-memory lock. This works correctly for single-instance deployments; multi-instance
 * deployments need a shared Redis instance.
 */
export type CreatorLockService = {
  /** Atomically acquire `key` for `ttlMs`. Returns a release token, or null if already held. */
  acquire(key: string, ttlMs: number): Promise<string | null>;
  /** Release a lock this process holds (token must match what `acquire` returned). No-op otherwise. */
  release(key: string, token: string): Promise<void>;
  /**
   * Unconditionally clear `key` regardless of token — for use only by a process that has
   * independently confirmed (e.g. via the DB row) that this lock is stale and must not
   * survive, such as the acceptance-timer sweep. Never call this from the accept path itself.
   */
  forceRelease(key: string): Promise<void>;
  /** True if `key` is currently held (not expired). */
  isLocked(key: string): Promise<boolean>;
};

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

class InMemoryLockService implements CreatorLockService {
  private locks = new Map<string, {token: string; expiresAt: number}>();

  private isExpired(entry: {token: string; expiresAt: number}): boolean {
    return Date.now() >= entry.expiresAt;
  }

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const existing = this.locks.get(key);
    if (existing && !this.isExpired(existing)) {
      return null;
    }
    const token = crypto.randomUUID();
    this.locks.set(key, {token, expiresAt: Date.now() + ttlMs});
    return token;
  }

  async release(key: string, token: string): Promise<void> {
    const existing = this.locks.get(key);
    if (existing && existing.token === token) {
      this.locks.delete(key);
    }
  }

  async forceRelease(key: string): Promise<void> {
    this.locks.delete(key);
  }

  async isLocked(key: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (!existing) return false;
    if (this.isExpired(existing)) {
      this.locks.delete(key);
      return false;
    }
    return true;
  }
}

class RedisLockService implements CreatorLockService {
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = crypto.randomUUID();
    const result = await redis.set(key, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await redis.eval(RELEASE_SCRIPT, 1, key, token);
  }

  async forceRelease(key: string): Promise<void> {
    await redis.del(key);
  }

  async isLocked(key: string): Promise<boolean> {
    const value = await redis.get(key);
    return value !== null;
  }
}

function tryRedis(): boolean {
  try {
    return redis.status === 'ready';
  } catch {
    return false;
  }
}

class FallbackLockService implements CreatorLockService {
  private redisService = new RedisLockService();
  private memoryService = new InMemoryLockService();

  private useRedis(): boolean {
    return tryRedis();
  }

  private delegate(): CreatorLockService {
    return this.useRedis() ? this.redisService : this.memoryService;
  }

  acquire(key: string, ttlMs: number): Promise<string | null> {
    return this.delegate().acquire(key, ttlMs);
  }

  release(key: string, token: string): Promise<void> {
    return this.delegate().release(key, token);
  }

  forceRelease(key: string): Promise<void> {
    return this.delegate().forceRelease(key);
  }

  isLocked(key: string): Promise<boolean> {
    return this.delegate().isLocked(key);
  }
}

export const creatorLockKey = (requestId: string): string => `request:${requestId}:creator-lock`;

export const creatorLockService: CreatorLockService = new FallbackLockService();
