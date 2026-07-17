import {logger} from '../config/logger';
import {prisma} from '../prisma/client';
import {adminAlertRepository} from '../repositories/adminAlertRepository';
import {requestRepository} from '../repositories/requestRepository';
import {creatorLockKey, creatorLockService} from './creatorLockService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {assertTransition} from './requestStateMachine';

/** PRD_TRD_SUMMARY.md §5.8 `abandonment_guard_evaluation` — 3rd expiry in a rolling 30 days trips a 24h accept-block. */
const ABANDONMENT_WINDOW_DAYS = 30;
const ABANDONMENT_THRESHOLD = 3;
const ABANDONMENT_BLOCK_HOURS = 24;

async function evaluateAbandonmentGuard(creatorId: string, requestId: string) {
  await prisma.abandonmentEvent.create({data: {creatorId, requestId}});

  const windowStart = new Date(Date.now() - ABANDONMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentCount = await prisma.abandonmentEvent.count({
    where: {creatorId, createdAt: {gte: windowStart}},
  });

  if (recentCount >= ABANDONMENT_THRESHOLD) {
    const blockedUntil = new Date(Date.now() + ABANDONMENT_BLOCK_HOURS * 60 * 60 * 1000);
    await prisma.user.update({where: {id: creatorId}, data: {acceptanceBlockedUntil: blockedUntil}});
    logger.warn(`[acceptanceTimerJob] Creator ${creatorId} hit ${recentCount} abandonments in ${ABANDONMENT_WINDOW_DAYS}d — blocked from accepting until ${blockedUntil.toISOString()}.`);
    await notificationService.notifyUser(
      creatorId,
      NotificationType.CREATOR_TIMED_OUT,
      'Accepting temporarily paused',
      `You've missed the recording window ${recentCount} times recently. You can accept new requests again in ${ABANDONMENT_BLOCK_HOURS} hours.`,
      {screen: 'CreatorDashboard'},
    );
    // Live Monitoring alert feed (PRD §5.14.2 "repeated abandonment").
    await adminAlertRepository.create({
      type: 'REPEATED_ABANDONMENT',
      message: `Creator ${creatorId} hit ${recentCount} acceptance-timer expiries in ${ABANDONMENT_WINDOW_DAYS} days — blocked from accepting until ${blockedUntil.toISOString()}.`,
      metadata: {recentCount, blockedUntil: blockedUntil.toISOString()},
      userId: creatorId,
      requestId,
    });
  }
}

/**
 * Acceptance-timer expiry sweep (PRD §5.5). A Creator has `ACCEPTANCE_TIMER_MINUTES` from
 * acceptance to start recording — `CREATOR_ASSIGNED` is the v2.1 resting state observed during
 * this window (backend Phase 4 item 2 retired the old `TEMPORARY_CHAT` interstitial from the
 * accept flow; `TEMPORARY_CHAT` is still swept too so any pre-existing row resolves). If the
 * window lapses with no progress, the Redis lock has already expired on its own TTL — this job
 * is what actually unwinds the Postgres side: release the lock (idempotent no-op if Redis
 * already evicted it), republish the request, and notify the Requester.
 */
export const acceptanceTimerJob = {
  async runSweep() {
    const candidates = await requestRepository.findAcceptanceTimerExpired(new Date());
    let released = 0;

    for (const request of candidates) {
      const fromStatus = request.status;
      if (!assertTransitionSafe(fromStatus, 'PUBLISHED')) continue;

      const result = await requestRepository.updateStatusIfCurrently(request.id, fromStatus, {
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

      // Abandonment guard (backend Phase 8 item 3) — best-effort, must never block the sweep
      // from processing the rest of the batch.
      if (request.creatorId) {
        await evaluateAbandonmentGuard(request.creatorId, request.id).catch(err => {
          logger.error(`[acceptanceTimerJob] Abandonment guard evaluation failed: ${(err as Error).message}`);
        });
      }

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
