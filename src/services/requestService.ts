import {RequestCategory, RequestStatus, RequestType} from '@prisma/client';

import {env} from '../config/env';
import {requestRepository} from '../repositories/requestRepository';
import {userRepository} from '../repositories/userRepository';
import {haversineMeters} from '../utils/geo';
import {HttpError} from '../utils/httpError';
import {presentRequest} from '../utils/requestPresenter';
import {consentService} from './consentService';
import {creatorLockKey, creatorLockService} from './creatorLockService';
import {creatorMatchingService, NearbyFilters} from './creatorMatchingService';
import {escrowService} from './escrowService';
import {locationCategoryService} from './locationCategoryService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {placesService} from './placesService';
import {ratingService} from './ratingService';
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
 * Creator Discovery (nearby/available feeds) shows only the Requester's trust profile — these
 * lists are `PUBLISHED`-only (pre-acceptance, see creatorMatchingService/findAvailable), so
 * there's never a Creator side to show yet.
 */
async function attachRequesterTrustProfile<T extends object>(
  base: T,
  request: {requesterId: string},
): Promise<T & {requesterTrustProfile: Awaited<ReturnType<typeof trustScoreService.getProfile>>}> {
  const requesterTrustProfile = await trustScoreService.getProfile(request.requesterId, 'requester');
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
    // Escrow reservation (backend Phase 8) debits the full reward amount up front, so a
    // requester without sufficient funds is blocked before a Request row (or its escrow) ever
    // exists — checked here, ahead of the atomic reserve, to avoid an orphaned Request on
    // insufficient balance (see escrowService.reserve for the actual debit).
    const requester = await userRepository.findById(requesterId);
    if (!requester) {
      throw new HttpError(404, 'User not found.');
    }
    if (Number(requester.walletBalance) < input.rewardAmount) {
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

    const highValueReviewRequired = input.rewardAmount >= REQUEST_HIGH_VALUE_THRESHOLD;
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
      rewardAmount: input.rewardAmount,
      category: input.category,
      instructions: input.instructions,
      highValueReviewRequired,
      requesterDeclarationAt: now,
      expiresAt,
      status: 'DRAFT',
    });

    await escrowService.reserve(created.id, requesterId, input.rewardAmount);

    // Immutable consent audit row (PRD §9.1, §5.7.3, backend Phase 13) — additive alongside the
    // `requesterDeclarationAt` timestamp stamped above (Phase 2's interim substitute, unchanged).
    await consentService.recordDeclaration(requesterId, 'REQUESTER_DECLARATION', created.id);

    await notificationService.notifyUser(
      requesterId,
      NotificationType.REQUEST_CREATED,
      'Request created',
      `Your request for ₹${input.rewardAmount} has been created.`,
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
      await notificationService.notifyAdmins(
        NotificationType.HIGH_VALUE_ESCROW,
        'High-value request pending review',
        `A request worth ₹${input.rewardAmount} requires Admin review before publishing.`,
        {requestId: created.id},
      );
    }

    // Immediate, non-high-value requests publish straight away; SCHEDULED and high-value
    // requests stay DRAFT (the former until scheduledAt via the sweep job, the latter
    // pending mandatory Admin review — Phase 6, not yet built — see MASTER_EXECUTION_PLAN.md).
    if (input.type === 'IMMEDIATE' && !highValueReviewRequired) {
      assertTransition('DRAFT', 'PUBLISHED');
      const published = await requestRepository.update(created.id, {status: 'PUBLISHED'});
      await notifyEligibleCreatorsOfNewRequest(published);
      return presentRequest(published);
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

    const rewardAmount = data.rewardAmount ?? Number(request.rewardAmount);
    const updated = await requestRepository.update(id, {
      ...data,
      highValueReviewRequired: rewardAmount >= REQUEST_HIGH_VALUE_THRESHOLD,
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
    // blip) sees the same success result, not a false conflict. CREATOR_ASSIGNED is transient
    // (this same call advances it straight to TEMPORARY_CHAT below), so a retry will usually
    // observe TEMPORARY_CHAT rather than CREATOR_ASSIGNED.
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

      updated = await requestRepository.findById(id);
    } catch (err) {
      if (!(err instanceof HttpError)) {
        await creatorLockService.release(lockKey, token);
      }
      throw err;
    }

    // Chat opens automatically the instant GPS-validated acceptance completes (PRD §5.4).
    // The row is no longer PUBLISHED and is exclusively owned by this Creator at this point,
    // so this is a plain transition, not a race-guarded conditional update.
    assertTransition('CREATOR_ASSIGNED', 'TEMPORARY_CHAT');
    updated = await requestRepository.update(id, {status: 'TEMPORARY_CHAT'});

    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.CREATOR_ACCEPTED,
      'Creator found!',
      'A Creator has accepted your request and is on the way.',
      {requestId: id, screen: 'RequestDetail'},
    );

    // Chat opens automatically the instant acceptance completes (PRD §5.4) — notify both
    // participants it's available now.
    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.CHAT_OPENED,
      'Chat opened',
      'You can now chat with your Creator until recording starts.',
      {requestId: id, screen: 'Chat'},
    );
    await notificationService.notifyUser(
      creatorId,
      NotificationType.CHAT_OPENED,
      'Chat opened',
      'You can now chat with the Requester until you start recording.',
      {requestId: id, screen: 'Chat'},
    );

    return presentRequest(updated!);
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
      isLocked: request.status !== 'PUBLISHED' && request.status !== 'DRAFT',
      isVisible: creatorMatchingService.isVisibleToCreator(request, creatorId),
    };
    const withRatings = await ratingService.attachRatingSummaries(presented, request);
    return trustScoreService.attachTrustSummaries(withRatings, request);
  },
};
