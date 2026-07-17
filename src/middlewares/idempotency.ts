import {NextFunction, Response} from 'express';

import {redis} from '../config/redis';
import {logger} from '../config/logger';
import {AuthenticatedRequest} from './authMiddleware';

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60; // 24h — long enough to cover realistic client retry windows (app restart, network blip), short enough not to accumulate forever.
const KEY_PREFIX = 'idempotency:';

/**
 * Generic `Idempotency-Key` middleware (TRD 8.3, backend Phase 8 item 1) — generalizes the
 * pattern already proven for the Razorpay webhook path (order_id-keyed, DB-level) to every
 * wallet/request-state-mutating route. A client sends a self-generated UUID in the
 * `Idempotency-Key` header; a retried request with the same key (same user, same route) replays
 * the original response instead of re-executing the handler, making network-retry-driven
 * double-submission safe (e.g. a Connect debit that appeared to fail client-side but actually
 * succeeded server-side).
 *
 * Best-effort: if Redis is unreachable, the request proceeds unprotected rather than failing
 * outright — same fail-open-on-cache-unavailable posture `settingsService.ts` uses, since this
 * is a safety net for retries, not a correctness dependency for the request itself.
 *
 * The header is optional — omitting it just means no replay protection for that call, which
 * matches how idempotency keys work everywhere else (opt-in per request, not mandatory).
 */
export function idempotency(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const key = req.header('Idempotency-Key');
  if (!key) {
    next();
    return;
  }

  const cacheKey = `${KEY_PREFIX}${req.method}:${req.baseUrl}${req.path}:${req.user?.id ?? 'anon'}:${key}`;

  (async () => {
    if (redis.status !== 'ready') {
      next();
      return;
    }

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const {status, body} = JSON.parse(cached) as {status: number; body: unknown};
        res.status(status).json(body);
        return;
      }
    } catch (err) {
      logger.warn(`[idempotency] Redis read failed, proceeding unprotected: ${(err as Error).message}`);
      next();
      return;
    }

    // Wrap res.json to capture the response body once the handler actually responds, so only a
    // request that truly completed gets cached — an error mid-handler is never replayed as if
    // it were the original (successful) response.
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 500) {
        redis
          .set(cacheKey, JSON.stringify({status: res.statusCode, body}), 'EX', IDEMPOTENCY_TTL_SECONDS)
          .catch(err => logger.warn(`[idempotency] Redis write failed (response still sent): ${(err as Error).message}`));
      }
      return originalJson(body);
    };

    next();
  })();
}
