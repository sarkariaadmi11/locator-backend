import {Prisma} from '@prisma/client';

import {BETA_ECONOMY_DEFAULTS} from '../config/betaEconomy';
import {env} from '../config/env';
import {matchingWindowResponseRepository} from '../repositories/matchingWindowResponseRepository';
import {ratingRepository} from '../repositories/ratingRepository';
import {requestRepository} from '../repositories/requestRepository';
import {userRepository} from '../repositories/userRepository';
import {haversineMeters} from '../utils/geo';
import {HttpError} from '../utils/httpError';
import {ledgerService} from './ledgerService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {notifyEligibleCreatorsOfNewRequest} from './requestService';
import {assertTransition} from './requestStateMachine';
import {SettingsKey, settingsService} from './settingsService';

// Bayesian-adjusted rating (PRD_TRD_SUMMARY.md §5.6/§7.4 item 5) — pulls a Creator with very few
// ratings toward the platform-wide prior instead of letting a single 5-star (or 1-star) rating
// dominate the window's outcome. PRIOR_WEIGHT mirrors "3 ratings" worth of confidence, matching
// the plain-language PRD description ("Bayesian-adjusted if <3 ratings").
const PRIOR_MEAN = 3.5;
const PRIOR_WEIGHT = 3;

function bayesianScore(avg: number | null, count: number): number {
  const sum = (avg ?? 0) * count;
  return (PRIOR_WEIGHT * PRIOR_MEAN + sum) / (PRIOR_WEIGHT + count);
}

/**
 * Highest Rated acceptance mode (PRD_TRD_SUMMARY.md §5.6, §5.7, §7.4 item 5; backend Phase 4
 * item 4). A `HIGHEST_RATED` request opens a `MATCHING_WINDOW` on publish (see
 * `requestService.create`) instead of going straight to the First Accepted race. Creators
 * `respond` (recorded, not locked — no Connect deduction yet) until the window's
 * `matchingWindowClosesAt` elapses; `matchingWindowJob`'s sweep then picks the winner and
 * deducts exactly one Connect from them, same as the First Accepted flow does at `accept()`.
 */
export const matchingWindowService = {
  /** `POST /requests/:id/respond` — a Creator's response during an open matching window. */
  async respond(creatorId: string, requestId: string, creatorLocation: {latitude: number; longitude: number}) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    if (request.requesterId === creatorId) {
      throw new HttpError(403, 'You cannot respond to your own request.');
    }

    if (request.status !== 'MATCHING_WINDOW') {
      throw new HttpError(409, 'This request is not currently accepting responses.');
    }

    if (!request.matchingWindowClosesAt || request.matchingWindowClosesAt.getTime() <= Date.now()) {
      throw new HttpError(409, 'The response window for this request has closed.');
    }

    const creator = await userRepository.findById(creatorId);
    if (!creator || creator.availabilityStatus !== 'ONLINE') {
      throw new HttpError(403, 'You must be Online to respond to requests.');
    }

    if (creator.acceptanceBlockedUntil && creator.acceptanceBlockedUntil.getTime() > Date.now()) {
      throw new HttpError(
        403,
        `You've missed the recording window too many times recently. You can respond to requests again after ${creator.acceptanceBlockedUntil.toISOString()}.`,
      );
    }

    if (request.currencyMode === 'CREDIT') {
      const acceptCost = await settingsService.getNumber(
        SettingsKey.ACCEPT_REQUEST_CONNECTS,
        BETA_ECONOMY_DEFAULTS.ACCEPT_REQUEST_CONNECTS,
      );
      if (creator.creatorConnects < acceptCost) {
        throw new HttpError(
          402,
          `You need ${acceptCost} Connect(s) to respond. You have ${creator.creatorConnects}.`,
        );
      }
    }

    const distanceMeters = haversineMeters(
      creatorLocation.latitude,
      creatorLocation.longitude,
      request.latitude,
      request.longitude,
    );
    if (distanceMeters > request.radiusMeters) {
      throw new HttpError(
        403,
        `You must be within ${request.radiusMeters} metres of the requested location to respond.`,
      );
    }

    try {
      await matchingWindowResponseRepository.create({
        requestId,
        creatorId,
        distanceMetres: Math.round(distanceMeters),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Already responded — idempotent no-op, not an error (matches accept()'s own
        // idempotent-retry convention for the same class of "already did this" race).
        return {responded: true};
      }
      throw err;
    }

    return {responded: true};
  },

  /**
   * Called only by `matchingWindowJob`'s sweep — never directly from a route. Picks the
   * Bayesian-adjusted-highest-rated respondent (tie-break: rating count, then distance, then
   * earliest response), spends their Connect, and assigns the request; falls back to
   * `PUBLISHED`/`FIRST_ACCEPTED` if nobody responded, or if every respondent's Connect balance
   * turned out insufficient by the time the window closed.
   */
  async closeWindow(requestId: string) {
    const request = await requestRepository.findById(requestId);
    if (!request || request.status !== 'MATCHING_WINDOW') {
      return; // already handled (e.g. cancelled, or a previous sweep tick already closed it)
    }

    const responses = await matchingWindowResponseRepository.findManyForRequest(requestId);

    if (responses.length === 0) {
      await this.fallbackToFirstAccepted(requestId, request.requesterId);
      return;
    }

    const scored = await Promise.all(
      responses.map(async r => {
        const agg = await ratingRepository.aggregateForUserRole(r.creatorId, 'REQUESTER_RATES_CREATOR');
        return {
          response: r,
          score: bayesianScore(agg._avg.stars, agg._count.stars ?? 0),
          numRatings: agg._count.stars ?? 0,
        };
      }),
    );

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.numRatings !== a.numRatings) return b.numRatings - a.numRatings;
      const aDist = a.response.distanceMetres ?? Number.MAX_SAFE_INTEGER;
      const bDist = b.response.distanceMetres ?? Number.MAX_SAFE_INTEGER;
      if (aDist !== bDist) return aDist - bDist;
      return a.response.respondedAt.getTime() - b.response.respondedAt.getTime();
    });

    const acceptCost =
      request.currencyMode === 'CREDIT'
        ? await settingsService.getNumber(SettingsKey.ACCEPT_REQUEST_CONNECTS, BETA_ECONOMY_DEFAULTS.ACCEPT_REQUEST_CONNECTS)
        : 0;

    for (const candidate of scored) {
      const winnerId = candidate.response.creatorId;
      try {
        if (acceptCost > 0) {
          await ledgerService.debitConnects(winnerId, acceptCost, 'ACCEPT_SPEND', {requestId});
        }
      } catch {
        // This candidate's balance changed since they responded — try the next-best candidate.
        continue;
      }

      const now = new Date();
      const ttlMs = env.ACCEPTANCE_TIMER_MINUTES * 60 * 1000;
      assertTransition('MATCHING_WINDOW', 'CREATOR_ASSIGNED');
      const result = await requestRepository.updateStatusIfCurrently(requestId, 'MATCHING_WINDOW', {
        status: 'CREATOR_ASSIGNED',
        creatorId: winnerId,
        lastAssignedCreatorId: winnerId,
        acceptedAt: now,
        acceptanceTimerExpiresAt: new Date(now.getTime() + ttlMs),
        matchingWindowClosesAt: null,
      });

      if (result.count === 0) {
        // Concurrently handled by another process — refund the Connect we just spent and stop.
        if (acceptCost > 0) {
          await ledgerService.creditConnects(winnerId, acceptCost, 'ACCEPT_REFUND', {requestId}).catch(() => {});
        }
        return;
      }

      await matchingWindowResponseRepository.updateStatus(candidate.response.id, 'SPENT');
      for (const other of scored) {
        if (other.response.id !== candidate.response.id) {
          await matchingWindowResponseRepository.updateStatus(other.response.id, 'RELEASED');
        }
      }

      await notificationService.notifyUser(
        request.requesterId,
        NotificationType.CREATOR_ACCEPTED,
        'Creator found!',
        'A Creator has accepted your request and is on the way.',
        {requestId, screen: 'RequestDetail'},
      );

      for (const other of scored) {
        if (other.response.creatorId !== winnerId) {
          await notificationService.notifyUser(
            other.response.creatorId,
            NotificationType.MATCHING_WINDOW_LOST,
            "Didn't win this one",
            'Another Creator was selected for this request. Your Connect reservation has been released.',
            {requestId, screen: 'CreatorRequestDetail'},
          );
        }
      }

      return;
    }

    // Every candidate's Connect balance failed at debit time — treat as if nobody responded.
    await this.fallbackToFirstAccepted(requestId, request.requesterId);
  },

  async fallbackToFirstAccepted(requestId: string, requesterId: string) {
    assertTransition('MATCHING_WINDOW', 'PUBLISHED');
    const result = await requestRepository.updateStatusIfCurrently(requestId, 'MATCHING_WINDOW', {
      status: 'PUBLISHED',
      matchingWindowClosesAt: null,
      acceptanceMode: 'FIRST_ACCEPTED',
    });
    if (result.count === 0) return;

    const republished = await requestRepository.findById(requestId);
    await notifyEligibleCreatorsOfNewRequest(republished);

    await notificationService.notifyUser(
      requesterId,
      NotificationType.MATCHING_WINDOW_FALLBACK,
      'Still searching for a Creator',
      "No Creator responded in time — we've switched your request to First Accepted and re-broadcast it nearby.",
      {requestId, screen: 'RequestDetail'},
    );
  },
};
