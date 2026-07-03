import {logger} from '../config/logger';
import {requestRepository} from '../repositories/requestRepository';
import {creatorLockKey, creatorLockService} from './creatorLockService';
import {fcmService} from './fcmService';
import {assertTransition} from './requestStateMachine';

/**
 * Acceptance-timer expiry sweep (PRD §5.5). A Creator has `ACCEPTANCE_TIMER_MINUTES` from
 * acceptance to start recording; if that window lapses with no progress (state is still
 * `CREATOR_ASSIGNED`, never advanced to `TEMPORARY_CHAT`/`RECORDING`), the Redis lock has
 * already expired on its own TTL — this job is what actually unwinds the Postgres side:
 * release the lock (idempotent no-op if Redis already evicted it), republish the request
 * (`CREATOR_ASSIGNED` -> `PUBLISHED`), and notify the Requester.
 */
export const acceptanceTimerJob = {
  async runSweep() {
    const candidates = await requestRepository.findAcceptanceTimerExpired(new Date());
    let released = 0;

    for (const request of candidates) {
      if (!assertTransitionSafe('CREATOR_ASSIGNED', 'PUBLISHED')) continue;

      const result = await requestRepository.updateStatusIfCurrently(request.id, 'CREATOR_ASSIGNED', {
        status: 'PUBLISHED',
        creatorId: null,
        acceptedAt: null,
        acceptanceTimerExpiresAt: null,
      });

      if (result.count === 0) continue;

      // Redis's own TTL already evicted this key in the common case; forceRelease covers the
      // edge case where the lock's TTL outlives the DB window (e.g. clock drift) — this job
      // has independently confirmed via the DB row that the lock must not survive regardless.
      await creatorLockService.forceRelease(creatorLockKey(request.id));

      await fcmService.sendToUser(request.requesterId, {
        title: 'Still searching for a Creator',
        body: 'Your creator was unable to start in time — we\'re re-broadcasting your request to nearby creators.',
        data: {type: 'ACCEPTANCE_EXPIRED', requestId: request.id},
      });

      released += 1;
    }

    if (released > 0) {
      logger.info(`[acceptanceTimerJob] Released ${released} expired acceptance(s).`);
    }
    return released;
  },
};

function assertTransitionSafe(from: Parameters<typeof assertTransition>[0], to: Parameters<typeof assertTransition>[1]) {
  try {
    assertTransition(from, to);
    return true;
  } catch {
    return false;
  }
}
