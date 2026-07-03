import Redis from 'ioredis';

import {env} from './env';
import {logger} from './logger';

/**
 * Single shared Redis connection (PRD §5.5 — Creator mutex lock; also the backbone for any
 * future cross-process cache/session need). `lazyConnect: false` so the client starts
 * connecting immediately at import time; `retryStrategy` gives ioredis's built-in
 * exponential-backoff reconnect instead of the default (which gives up after 20 attempts).
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(attempt: number) {
    const delayMs = Math.min(attempt * 200, 5000);
    return delayMs;
  },
  reconnectOnError() {
    return true;
  },
});

redis.on('connect', () => {
  logger.info('[redis] Connected.');
});

redis.on('ready', () => {
  logger.info('[redis] Ready.');
});

redis.on('reconnecting', (delay: number) => {
  logger.warn(`[redis] Reconnecting in ${delay}ms...`);
});

redis.on('error', err => {
  logger.error(`[redis] Connection error: ${(err as Error).message}`);
});

export async function checkRedisConnectivity(): Promise<{ok: boolean; reason?: string}> {
  try {
    await redis.ping();
    return {ok: true};
  } catch (err) {
    return {ok: false, reason: (err as Error).message};
  }
}

export async function disconnectRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
