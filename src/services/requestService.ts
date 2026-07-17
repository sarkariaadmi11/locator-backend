import {AcceptanceMode, RequestCategory, RequestStatus, RequestType} from '@prisma/client';

import {BETA_ECONOMY_DEFAULTS} from '../config/betaEconomy';
import {env} from '../config/env';
import {adminAlertRepository} from '../repositories/adminAlertRepository';
import {requestRepository} from '../repositories/requestRepository';
import {userRepository} from '../repositories/userRepository';
import {haversineMeters} from '../utils/geo';
import {HttpError} from '../utils/httpError';
import {presentRequest} from '../utils/requestPresenter';
import {consentService} from './consentService';
import {creatorLockKey, creatorLockService} from './creatorLockService';
import {creatorMatchingService, NearbyFilters} from './creatorMatchingService';
import {escrowService} from './escrowService';
import {gpsSpoofingService} from './gpsSpoofingService';
import {ledgerService} from './ledgerService';
import {locationCategoryService} from './locationCategoryService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {placesService} from './placesService';
import {queryService} from './queryService';
import {ratingService} from './ratingService';
import {SettingsKey, settingsService} from './settingsService';
import {trustScoreService} from './trustScoreService';
import {
  REQUEST_EXPIRY_HOURS,
  REQUEST_HIGH_VALUE_THRESHOLD,
} from '../validations/requestValidation';
import {assertTransition} from './requestStateMachine';

type CreateRequestInput = {
  type: RequestType;
  scheduledAt?: Date;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  description: string;
  durationMinutes: number;
  rewardAmount: number;
  category: RequestCategory;
  instructions?: string;
  // Highest Rated acceptance mode (PRD_TRD_SUMMARY.md §5.6, backend Phase 4 item 4) — optional,
  // defaults to FIRST_ACCEPTED (unchanged existing behaviour) when omitted.
  acceptanceMode?: AcceptanceMode;
};

type UpdateRequestInput = Partial<{
  description: string;
  durationMinutes: number;
  rewardAmount: number;
  category: RequestCategory;
  instructions: string;
}>;

/** Push-broadcast on publish (PRD §8.1 "New Request Near You") — best-effort, never blocks creation. */
export async function notifyEligibleCreatorsOfNewRequest(request: Awaited<ReturnType<typeof requestRepository.findById>>) {
  if (!request) return;
  try {
    const eligible = await creatorMatchingService.findEligibleCreatorsForRequest(request);
    if (eligible.length === 0) return;
    await notificationService.notifyMultiple(
      eligible.map(creator => creator.id),
      NotificationType.REQUEST_PUBLISHED,
      'New Request Near You',
      `₹${Number(request.rewardAmount)} · ${request.description.slice(0, 80)}`,
      {requestId: request.id, screen: 'CreatorRequestDetail'},
    );
    // "Nearby Creator Found" (PRD §8.1 Requests matrix) — reassures the Requester that
    // eligible creators actually exist nearby, distinct from the creator-facing broadcast above.
    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.NEARBY_CREATOR_FOUND,
      'Nearby creators found',
      `${eligible.length} creator${eligible.length === 1 ? '' : 's'} nearby can fulfil your request.`,
      {requestId: request.id, screen: 'RequestDetail'},
    );
  } catch {
    // Notification delivery must never block or fail request publication.
  }
}

/**
 * Shared publish path — DRAFT -> PUBLISHED (moderation OFF, called directly from `create`) or
 * PENDING_MODERATION -> PUBLISHED (moderation ON, called from `moderationService.approveRequest`
 * once a Moderator/Admin approves). Handles the Highest Rated matching-window branch and the
 * eligible-creator broadcast identically either way, so the two entry points can never drift.
 */
export async function publishFromDraft(
  requestId: string,
  fromStatus: RequestStatus,
  acceptanceMode: AcceptanceMode,
) {
  assertTransition(fromStatus, 'PUBLISHED');
  const published = await requestRepository.update(requestId, {status: 'PUBLISHED'});

  // Highest Rated acceptance mode (backend Phase 4 item 4) — the request's "searching" state
  // is MATCHING_WINDOW, not PUBLISHED itself; the window closes on its own via
  // matchingWindowJob's sweep (see matchingWindowService.closeWindow), which falls back to
  // FIRST_ACCEPTED/PUBLISHED if nobody responds in time.
  if (acceptanceMode === 'HIGHEST_RATED') {
    assertTransition('PUBLISHED', 'MATCHING_WINDOW');
    const windowSeconds = await settingsService.getNumber(
      SettingsKey.HIGHEST_RATED_WINDOW_SECONDS,
      BETA_ECONOMY_DEFAULTS.HIGHEST_RATED_WINDOW_SECONDS,
    );
    const inWindow = await requestRepository.update(requestId, {
      status: 'MATCHING_WINDOW',
      matchingWindowClosesAt: new Date(Date.now() + windowSeconds * 1000),
    });
    await notifyEligibleCreatorsOfNewRequest(inWindow);
    return presentRequest(inWindow);
  }

  await notifyEligibleCreatorsOfNewRequest(published);
  return presentRequest(published);
}

/**
 * Creator Discovery (nearby/available feeds) shows only the Requester's trust profile — these
 * lists are `PUBLISHED`-only (pre-acceptance, see creatorMatchingService/findAvailable), so
 * there's never a Creator side to show yet.
 */
async function attachRequesterTrustProfile<T extends object>(
  base: T,
  request: {requesterId: string},
) {
  // User-facing feed (Creator Discovery) — must use the trust-score-stripped variant (v2.1,
  // backend Phase 7). See trustScoreService.ts's stripTrustScoreForUser doc comment.
  const requesterTrustProfile = await trustScoreService.getUserFacingProfile(request.requesterId, 'requester');
  return {...base, requesterTrustProfile};
}

async function resolveFormattedAddress(
  latitude: number,
  longitude: number,
  fromClassification?: string,
): Promise<string | null> {
  if (fromClassification) return fromClassification;

  try {
    const geocode = await placesService.reverseGeocode({lat: latitude, lng: longitude});
    return geocode.formattedAddress;
  } catch {
    // Best-effort only — a missing address must never block request creation.
    return null;
  }
}

export const requestService = {
  async create(requesterId: string, input: CreateRequestInput) {
    const requester = await userRepository.findById(requesterId);
    if (!requester) {
      throw new HttpError(404, 'User not found.');
    }

    // v2.1 Beta Mode vs. real-money mode (PRD_TRD_SUMMARY.md §1, §5.3.1, backend Phase 2 item 5).
    // "Reward Amount and Request Cost are mutually exclusive" (PRD §5.3.1) — when real money is
    // disabled (the v2.1 default), the client-supplied `rewardAmount` is ignored entirely and
    // the fixed, admin-configurable Request Cost is used instead; the field is read-only in the
    // Beta UI. High-value manual review is explicitly "not applicable in Beta Mode — Request
    // Cost is fixed" (PRD §5.3.1), so it's skipped for CREDIT-mode requests below.
    const currencyMode: 'CREDIT' | 'INR' = env.ENABLE_REAL_MONEY ? 'INR' : 'CREDIT';
    const escrowAmount =
      currencyMode === 'CREDIT'
        ? await settingsService.getNumber(SettingsKey.REQUEST_COST_CREDITS, BETA_ECONOMY_DEFAULTS.REQUEST_COST_CREDITS)
        : input.rewardAmount;

    // Escrow reservation (backend Phase 8) debits the full amount up front, so a requester
    // without sufficient funds is blocked before a Request row (or its escrow) ever exists —
    // checked here, ahead of the atomic reserve, to avoid an orphaned Request on insufficient
    // balance (see escrowService.reserve for the actual debit).
    if (currencyMode === 'CREDIT') {
      const balances = await ledgerService.getBalances(requesterId);
      if (balances.videoCredits < escrowAmount) {
        throw new HttpError(
          402,
          `You need ${escrowAmount} Credits to post this request. You have ${balances.videoCredits}.`,
        );
      }
    } else if (Number(requester.walletBalance) < escrowAmount) {
      throw new HttpError(402, 'Insufficient wallet balance to reserve escrow for this request.');
    }

    const classification = await locationCategoryService.classify(input.latitude, input.longitude);

    if (classification.category === 'PROHIBITED') {
      throw new HttpError(
        422,
        'This location is prohibited for requests. Please choose a different location.',
      );
    }

    const formattedAddress = await resolveFormattedAddress(
      input.latitude,
      input.longitude,
      classification.reverseGeocode?.formattedAddress,
    );

    // High-value manual review is not applicable in Beta/CREDIT mode (PRD §5.3.1) — Request
    // Cost is fixed, so there's nothing "high-value" about it.
    const highValueReviewRequired = currencyMode === 'INR' && escrowAmount >= REQUEST_HIGH_VALUE_THRESHOLD;
    const now = new Date();

    // Scheduled requests stay searchable for REQUEST_EXPIRY_HOURS from the moment they're
    // actually published (at scheduledAt), not from creation time (PRD §4.3).
    const expiresAt = new Date(
      (input.type === 'SCHEDULED' && input.scheduledAt ? input.scheduledAt : now).getTime() +
        REQUEST_EXPIRY_HOURS * 60 * 60 * 1000,
    );

    const created = await requestRepository.create({
      requester: {connect: {id: requesterId}},
      type: input.type,
      scheduledAt: input.scheduledAt,
      latitude: input.latitude,
      longitude: input.longitude,
      formattedAddress,
      locationCategory: classification.category,
      radiusMeters: input.radiusMeters,
      description: input.description,
      durationMinutes: input.durationMinutes,
      rewardAmount: escrowAmount,
      currencyMode,
      acceptanceMode: input.acceptanceMode ?? 'FIRST_ACCEPTED',
      category: input.category,
      instructions: input.instructions,
      highValueReviewRequired,
      requesterDeclarationAt: now,
      expiresAt,
      status: 'DRAFT',
    });

    await escrowService.reserve(created.id, requesterId, escrowAmount, currencyMode);

    // Immutable consent audit row (PRD §9.1, §5.7.3, backend Phase 13) — additive alongside the
    // `requesterDeclarationAt` timestamp stamped above (Phase 2's interim substitute, unchanged).
    await consentService.recordDeclaration(requesterId, 'REQUESTER_DECLARATION', created.id);

    await notificationService.notifyUser(
      requesterId,
      NotificationType.REQUEST_CREATED,
      'Request created',
      `Your request for ${currencyMode === 'CREDIT' ? `${escrowAmount} Credits` : `₹${escrowAmount}`} has been created.`,
      {requestId: created.id, screen: 'RequestDetail'},
    );
    if (input.type === 'SCHEDULED' && input.scheduledAt) {
      await notificationService.notifyUser(
        requesterId,
        NotificationType.REQUEST_SCHEDULED,
        'Request scheduled',
        `Your request is scheduled for ${input.scheduledAt.toLocaleString()}.`,
        {requestId: created.id, screen: 'RequestDetail'},
      );
    }
    if (highValueReviewRequired) {
      const message = `A request worth ₹${input.rewardAmount} requires Admin review before publishing.`;
      await notificationService.notifyAdmins(
        NotificationType.HIGH_VALUE_ESCROW,
        'High-value request pending review',
        message,
        {requestId: created.id},
      );
      // Live Monitoring alert feed (PRD §5.14.2 "high-value requests").
      await adminAlertRepository.create({
        type: 'HIGH_VALUE_ESCROW',
        message,
        metadata: {rewardAmount: input.rewardAmount},
        requestId: created.id,
      });
    }

    // Immediate, non-high-value requests publish straight away when Moderation is OFF; when ON,
    // they wait in the Pending Requests queue (PRD §5.9.2/§5.14.7) for a Moderator/Admin to
    // approve first — `moderationService.approveRequest` calls `publishFromDraft` below, the
    // same publish path this takes when moderation is OFF. SCHEDULED and high-value requests
    // stay DRAFT regardless (the former until scheduledAt via the sweep job, the latter pending
    // mandatory Admin review — Phase 6, not yet built — see MASTER_EXECUTION_PLAN.md).
    if (input.type === 'IMMEDIATE' && !highValueReviewRequired) {
      if (await settingsService.isModerationEnabled()) {
        assertTransition('DRAFT', 'PENDING_MODERATION');
        const pending = await requestRepository.update(created.id, {status: 'PENDING_MODERATION'});
        return presentRequest(pending);
      }
      return publishFromDraft(created.id, 'DRAFT', created.acceptanceMode);
    }

    return presentRequest(created);
  },

  async getById(requesterId: string, id: string) {
    const request = await requestRepository.findByIdForUser(id, requesterId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    const withRatings = await ratingService.attachRatingSummaries(presentRequest(request), request);
    return trustScoreService.attachTrustSummaries(withRatings, request);
  },

  async listMine(requesterId: string, status: RequestStatus | undefined, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      requestRepository.findManyForRequester(requesterId, status, skip, limit),
      requestRepository.countForRequester(requesterId, status),
    ]);
    return {items: items.map(presentRequest), total, page, limit};
  },

  async update(requesterId: string, id: string, data: UpdateRequestInput) {
    const request = await requestRepository.findByIdForUser(id, requesterId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    if (request.status !== 'DRAFT') {
      throw new HttpError(409, 'Only a request still in DRAFT can be edited.');
    }

    // Request Cost is fixed and read-only in Beta/CREDIT mode (PRD §5.3.1) — only a real-money
    // request's Reward Amount can be edited pre-publish.
    if (request.currencyMode === 'CREDIT' && data.rewardAmount !== undefined) {
      throw new HttpError(400, 'Request Cost is fixed in Beta Mode and cannot be edited.');
    }

    const rewardAmount = data.rewardAmount ?? Number(request.rewardAmount);
    const updated = await requestRepository.update(id, {
      ...data,
      highValueReviewRequired: request.currencyMode === 'INR' && rewardAmount >= REQUEST_HIGH_VALUE_THRESHOLD,
    });

    return presentRequest(updated);
  },

  async cancel(requesterId: string, id: string, reason: string | undefined) {
    const request = await requestRepository.findByIdForUser(id, requesterId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    // Pre-acceptance only, no penalty (PRD §5.3.2). Creator-matching states (CREATOR_ASSIGNED+)
    // are out of this domain's scope — cancellation there belongs to the fulfilment phase.
    assertTransition(request.status, 'CANCELLED');

    // Refund before flipping status, not after — if the refund fails, the request stays in its
    // original (still-cancellable) status rather than landing in a CANCELLED-but-unrefunded state.
    await escrowService.refund(id);

    const updated = await requestRepository.update(id, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReason: reason,
    });

    await notificationService.notifyUser(
      requesterId,
      NotificationType.REQUEST_CANCELLED,
      'Request cancelled',
      'Your request has been cancelled and the escrowed amount refunded.',
      {requestId: id, screen: 'RequestDetail'},
    );

    return presentRequest(updated);
  },

  // --- Fulfilment (Creator side, PRD §5.5) ------------------------------------------------

  /**
   * `POST /requests/:id/accept` — atomic Redis mutex + business-rule gate. Exactly one Creator
   * wins a race; the DB conditional update (`updateStatusIfCurrently`) is the second, authoritative
   * guard in case the row moved between the pre-checks and the lock acquisition.
   */
  async accept(creatorId: string, id: string, creatorLocation: {latitude: number; longitude: number}) {
    const request = await requestRepository.findById(id);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    // Idempotent acceptance: the same Creator retrying (e.g. a lost response after a network
    // blip) sees the same success result, not a false conflict. CREATOR_ASSIGNED is now the
    // settled resting state until Start Recording (v2.1, backend Phase 4 item 2) — TEMPORARY_CHAT
    // is still checked here too so a retry against a pre-existing row in that state still no-ops.
    if (
      (request.status === 'CREATOR_ASSIGNED' || request.status === 'TEMPORARY_CHAT') &&
      request.creatorId === creatorId
    ) {
      return presentRequest(request);
    }

    if (request.requesterId === creatorId) {
      throw new HttpError(403, 'You cannot accept your own request.');
    }

    // Defensive — PROHIBITED requests are hard-blocked at creation (never reach PUBLISHED),
    // but this must never be acceptable even if that invariant is ever violated upstream.
    if (request.locationCategory === 'PROHIBITED') {
      throw new HttpError(403, 'This request cannot be accepted.');
    }

    if (request.status !== 'PUBLISHED') {
      throw new HttpError(409, 'This request has already been accepted by another creator.');
    }

    if (request.expiresAt.getTime() <= Date.now()) {
      throw new HttpError(409, 'This request has expired.');
    }

    const creator = await userRepository.findById(creatorId);
    if (!creator || creator.availabilityStatus !== 'ONLINE') {
      throw new HttpError(403, 'You must be Online to accept requests.');
    }

    // Abandonment guard (PRD_TRD_SUMMARY.md §5.8, backend Phase 8 item 3) — 3 acceptance-timer
    // expiries in a rolling 30 days blocks new Accepts for 24h (set by acceptanceTimerJob).
    if (creator.acceptanceBlockedUntil && creator.acceptanceBlockedUntil.getTime() > Date.now()) {
      throw new HttpError(
        403,
        `You've missed the recording window too many times recently. You can accept new requests again after ${creator.acceptanceBlockedUntil.toISOString()}.`,
      );
    }

    // Accept Request Cost (PRD_TRD_SUMMARY.md §7.3, "Accept Request Cost = 1 Connect") — was
    // schema/settings-only until this fix (`SettingsKey.ACCEPT_REQUEST_CONNECTS` existed but was
    // never actually read on Accept). Pre-check here so a Creator without enough Connects is
    // rejected before ever taking the Redis lock; the actual debit happens after the DB-level
    // race is won below, so a losing Creator in a First Accepted race is never charged.
    let acceptCost = 0;
    if (request.currencyMode === 'CREDIT') {
      acceptCost = await settingsService.getNumber(
        SettingsKey.ACCEPT_REQUEST_CONNECTS,
        BETA_ECONOMY_DEFAULTS.ACCEPT_REQUEST_CONNECTS,
      );
      if (creator.creatorConnects < acceptCost) {
        throw new HttpError(
          402,
          `You need ${acceptCost} Connect(s) to accept a request. You have ${creator.creatorConnects}.`,
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
        `You must be within ${request.radiusMeters} metres of the requested location to fulfil this request.`,
      );
    }

    assertTransition('PUBLISHED', 'CREATOR_ASSIGNED');

    const lockKey = creatorLockKey(id);
    const ttlMs = env.ACCEPTANCE_TIMER_MINUTES * 60 * 1000;
    const token = await creatorLockService.acquire(lockKey, ttlMs);
    if (!token) {
      throw new HttpError(409, 'This request has already been accepted by another creator.');
    }

    let updated;
    try {
      const now = new Date();
      const result = await requestRepository.updateStatusIfCurrently(id, 'PUBLISHED', {
        status: 'CREATOR_ASSIGNED',
        creatorId,
        // Kept alongside `creatorId` (not a replacement) — see the schema comment on
        // `lastAssignedCreatorId`: it survives the acceptance-timer sweep nulling `creatorId`,
        // so trustScoreService can still compute this Creator's fulfilment history afterward.
        lastAssignedCreatorId: creatorId,
        acceptedAt: now,
        acceptanceTimerExpiresAt: new Date(now.getTime() + ttlMs),
      });

      if (result.count === 0) {
        await creatorLockService.release(lockKey, token);
        throw new HttpError(409, 'This request has already been accepted by another creator.');
      }

      if (acceptCost > 0) {
        try {
          await ledgerService.debitConnects(creatorId, acceptCost, 'ACCEPT_SPEND', {requestId: id});
        } catch (debitErr) {
          // Balance changed between the pre-check above and this debit (e.g. spent elsewhere in
          // the same instant) — roll back the assignment rather than leave a Creator holding a
          // request they couldn't actually pay to accept.
          await requestRepository.updateStatusIfCurrently(id, 'CREATOR_ASSIGNED', {
            status: 'PUBLISHED',
            creatorId: null,
            lastAssignedCreatorId: null,
            acceptedAt: null,
            acceptanceTimerExpiresAt: null,
          });
          await creatorLockService.release(lockKey, token);
          throw debitErr;
        }
      }

      updated = await requestRepository.findById(id);
    } catch (err) {
      if (!(err instanceof HttpError)) {
        await creatorLockService.release(lockKey, token);
      }
      throw err;
    }

    // v2.1 (backend Phase 4 item 2, paired with Phase 3 item 3): CREATOR_ASSIGNED is now the
    // resting state until Start Recording — the old TEMPORARY_CHAT interstitial is retired from
    // this flow. All open Pre-Acceptance Query threads close the instant a Creator is assigned
    // (PRD §5.4.0/§5.4.1 "all open query threads on this request close"), whichever Creator won.
    await queryService.closeAllForRequest(id);

    // GPS spoofing signal (backend Phase 8 item 2) — flag-and-queue only, never blocks Accept.
    gpsSpoofingService.checkAndFlag(creatorId, creatorLocation.latitude, creatorLocation.longitude, 'accept').catch(() => {});

    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.CREATOR_ACCEPTED,
      'Creator found!',
      'A Creator has accepted your request and is on the way.',
      {requestId: id, screen: 'RequestDetail'},
    );

    return presentRequest(updated!);
  },

  /**
   * `GET /requests/estimated-response-time` (PRD_TRD_SUMMARY.md §3.3, §10 item 8) — shown on
   * Create Request before posting. Averages the last `SAMPLE_SIZE` accepted requests in the same
   * category; falls back to a fixed default when there isn't enough history yet (a brand-new
   * category, or Beta launch day with too few accepted requests to be a meaningful average).
   */
  async estimatedResponseTimeMinutes(category: RequestCategory) {
    const SAMPLE_SIZE = 50;
    const FALLBACK_MINUTES = 5;
    const MIN_SAMPLES = 5;

    const recent = await requestRepository.findRecentAcceptedForCategory(category, SAMPLE_SIZE);
    if (recent.length < MIN_SAMPLES) {
      return {estimatedMinutes: FALLBACK_MINUTES, sampleSize: recent.length, isEstimate: true};
    }

    const totalMs = recent.reduce(
      (sum, r) => sum + (r.acceptedAt!.getTime() - r.requesterDeclarationAt.getTime()),
      0,
    );
    const avgMinutes = Math.round(totalMs / recent.length / 60_000);
    return {estimatedMinutes: Math.max(1, avgMinutes), sampleSize: recent.length, isEstimate: false};
  },

  // --- Discovery (Creator side, PRD §5.5, §5.11) -----------------------------------------

  /** `GET /requests/nearby` — GPS-proximity feed. All matching/ordering logic lives in creatorMatchingService. */
  async nearby(
    creatorId: string,
    origin: {latitude: number; longitude: number},
    radiusMeters: number,
    filters: NearbyFilters,
    page: number,
    limit: number,
  ) {
    const result = await creatorMatchingService.findNearbyForCreator(
      {id: creatorId},
      origin,
      radiusMeters,
      filters,
      page,
      limit,
    );
    return {
      items: await Promise.all(
        result.items.map(item => attachRequesterTrustProfile(presentRequest(item, item.distanceMeters), item)),
      ),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  },

  /** `GET /requests/available` — no-GPS fallback feed (PRD §5.11.1), newest-first, same filters. */
  async available(
    creatorId: string,
    filters: NearbyFilters,
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const [items, total] = await requestRepository.findAvailable({
      excludeUserId: creatorId,
      now: new Date(),
      category: filters.category,
      minReward: filters.minReward,
      maxReward: filters.maxReward,
      type: filters.type,
      skip,
      take: limit,
    });
    return {
      items: await Promise.all(items.map(item => attachRequesterTrustProfile(presentRequest(item), item))),
      total,
      page,
      limit,
    };
  },

  /** `GET /requests/:id/details` — Creator-facing detail view, any authenticated user, non-DRAFT only. */
  async getDetailsForCreator(
    creatorId: string,
    id: string,
    origin?: {latitude: number; longitude: number},
  ) {
    const request = await requestRepository.findVisibleById(id);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    const distanceMeters = origin
      ? haversineMeters(origin.latitude, origin.longitude, request.latitude, request.longitude)
      : undefined;

    const presented = {
      ...presentRequest(request, distanceMeters),
      isOwnRequest: request.requesterId === creatorId,
      // MATCHING_WINDOW (backend Phase 4 item 4) is a Highest Rated request's own "searching"
      // state, same as PUBLISHED — not locked to anyone yet, so it must not read as "already
      // accepted by another creator" the way CREATOR_ASSIGNED+ does.
      isLocked: request.status !== 'PUBLISHED' && request.status !== 'DRAFT' && request.status !== 'MATCHING_WINDOW',
      isVisible: creatorMatchingService.isVisibleToCreator(request, creatorId),
    };
    const withRatings = await ratingService.attachRatingSummaries(presented, request);
    return trustScoreService.attachTrustSummaries(withRatings, request);
  },
};
