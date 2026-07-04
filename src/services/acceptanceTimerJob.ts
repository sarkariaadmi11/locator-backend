import {logger} from '../config/logger';
import {requestRepository} from '../repositories/requestRepository';
import {creatorLockKey, creatorLockService} from './creatorLockService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {assertTransition} from './requestStateMachine';

/**
 * Acceptance-timer expiry sweep (PRD §5.5). A Creator has `ACCEPTANCE_TIMER_MINUTES` from
 * acceptance to start recording; chat opens automatically right after acceptance (state ->
 * `TEMPORARY_CHAT`, PRD §5.4), so that's the state this window is actually observed in. If
 * the window lapses with no progress (state is still `TEMPORARY_CHAT`, never advanced to
 * `RECORDING`), the Redis lock has already expired on its own TTL — this job is what actually
 * unwinds the Postgres side: release the lock (idempotent no-op if Redis already evicted it),
 * republish the request (`TEMPORARY_CHAT` -> `PUBLISHED`), and notify the Requester.
 */
export const acceptanceTimerJob = {
  async runSweep() {
    const candidates = await requestRepository.findAcceptanceTimerExpired(new Date());
    let released = 0;

    for (const request of candidates) {
      if (!assertTransitionSafe('TEMPORARY_CHAT', 'PUBLISHED')) continue;

      const result = await requestRepository.updateStatusIfCurrently(request.id, 'TEMPORARY_CHAT', {
        status: 'PUBLISHED',
        creatorId: null,
        acceptedAt: null,
        acceptanceTimerExpiresAt: null,
        // `lastAssignedCreatorId` is deliberately NOT cleared here (Trust Profile, backend
        // Phase 10) — it's the only remaining record of who abandoned this request, paired
        // with `creatorTimedOut` below.
        creatorTimedOut: true,
      });

      if (result.count === 0) continue;

      // Redis's own TTL already evicted this key in the common case; forceRelease covers the
      // edge case where the lock's TTL outlives the DB window (e.g. clock drift) — this job
      // has independently confirmed via the DB row that the lock must not survive regardless.
      await creatorLockService.forceRelease(creatorLockKey(request.id));

      await notificationService.notifyUser(
        request.requesterId,
        NotificationType.CREATOR_TIMED_OUT,
        'Still searching for a Creator',
        "Your creator was unable to start in time — we're re-broadcasting your request to nearby creators.",
        {requestId: request.id, screen: 'RequestDetail'},
      );

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
