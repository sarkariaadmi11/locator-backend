import crypto from 'crypto';

import {redis} from '../config/redis';

/**
 * Redis-backed Creator mutex lock (PRD §5.5 — "Redis, not Postgres", see
 * backend/docs/CLAUDE.md §2 `CreatorLock`). Used by `POST /requests/:id/accept` to guarantee
 * exactly one Creator can win a race to accept the same Request, and by the acceptance-timer
 * job to auto-release a Creator who never starts recording in time.
 *
 * `acquire` is a single atomic `SET key value NX PX ttl` — Redis guarantees this is race-free
 * across processes/instances, which a DB-row-with-unique-constraint approach can't give the
 * TTL-based auto-expiry the PRD requires without a separate expiry sweep racing the DB write.
 *
 * `release` uses a compare-and-delete Lua script (atomic GET+DEL) keyed on a random token
 * generated at `acquire` time, so a process can only release a lock it currently holds — a
 * stale/expired lock that Redis already evicted and someone else re-acquired is never
 * accidentally deleted by the original holder's late `release` call.
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

export const creatorLockKey = (requestId: string): string => `request:${requestId}:creator-lock`;

export const creatorLockService: CreatorLockService = new RedisLockService();
