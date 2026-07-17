import {Request, RequestCategory, RequestType, User} from '@prisma/client';

import {requestRepository} from '../repositories/requestRepository';
import {userRepository} from '../repositories/userRepository';
import {boundingBox, haversineMeters} from '../utils/geo';
import {REQUEST_DEFAULT_RADIUS_METERS} from '../validations/requestValidation';

export type NearbyFilters = {
  category?: RequestCategory;
  minReward?: number;
  maxReward?: number;
  type?: RequestType;
};

export type RequestWithDistance = Request & {distanceMeters: number};

/**
 * The single source of truth for "which requests can this Creator see, and in what order"
 * (PRD §5.5, §5.11). Controllers/services must call this instead of re-deriving eligibility —
 * see backend/docs/CLAUDE.md "Do NOT place matching logic inside controllers."
 *
 * This also owns the reverse direction (which Creators are eligible for a given Request),
 * used today by nothing yet but built as the single hook Phase 3's accept-push-broadcast
 * (MASTER_EXECUTION_PLAN.md Phase 3, item 2) will call without duplicating the radius/online
 * rules that this discovery pass already encodes.
 */
export const creatorMatchingService = {
  /**
   * A request is visible to a creator when: PUBLISHED or MATCHING_WINDOW (not DRAFT/locked/
   * terminal), not their own, and not expired. MATCHING_WINDOW (backend Phase 4 item 4) is a
   * Highest Rated request's own "searching" state — it must stay discoverable the same way
   * PUBLISHED is, or nearby Creators could never see it to respond. `CREATOR_ASSIGNED`+ requests
   * are already locked to another creator and are intentionally excluded — this is the
   * discovery-time half of the locking contract that Phase 3's Redis mutex
   * (`creatorLockService.ts`) enforces at accept-time.
   */
  isVisibleToCreator(request: Request, creatorId: string, now: Date = new Date()): boolean {
    return (
      (request.status === 'PUBLISHED' || request.status === 'MATCHING_WINDOW') &&
      request.requesterId !== creatorId &&
      request.expiresAt.getTime() > now.getTime()
    );
  },

  /** Nearest-first, radius-filtered, paginated feed for `GET /requests/nearby`. */
  async findNearbyForCreator(
    creator: Pick<User, 'id'>,
    origin: {latitude: number; longitude: number},
    radiusMeters: number = REQUEST_DEFAULT_RADIUS_METERS,
    filters: NearbyFilters = {},
    page = 1,
    limit = 20,
  ): Promise<{items: RequestWithDistance[]; total: number; page: number; limit: number}> {
    const box = boundingBox(origin.latitude, origin.longitude, radiusMeters);
    const now = new Date();

    const candidates = await requestRepository.findDiscoverableInBoundingBox({
      excludeUserId: creator.id,
      minLat: box.minLat,
      maxLat: box.maxLat,
      minLng: box.minLng,
      maxLng: box.maxLng,
      now,
      category: filters.category,
      minReward: filters.minReward,
      maxReward: filters.maxReward,
      type: filters.type,
    });

    const withDistance: RequestWithDistance[] = candidates
      .map(request => ({
        ...request,
        distanceMeters: haversineMeters(origin.latitude, origin.longitude, request.latitude, request.longitude),
      }))
      .filter(request => request.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    const total = withDistance.length;
    const skip = (page - 1) * limit;
    return {items: withDistance.slice(skip, skip + limit), total, page, limit};
  },

  /**
   * Reverse lookup for future notification support (Phase 3): which ONLINE creators fall
   * within a request's radius right now. Not called by any endpoint in this phase.
   */
  async findEligibleCreatorsForRequest(request: Request): Promise<Array<User & {distanceMeters: number}>> {
    const box = boundingBox(request.latitude, request.longitude, request.radiusMeters);

    const candidates = await userRepository.findOnlineCreatorsInBoundingBox(
      box.minLat,
      box.maxLat,
      box.minLng,
      box.maxLng,
      request.requesterId,
    );

    return candidates
      .filter((user): user is User & {latitude: number; longitude: number} => user.latitude !== null && user.longitude !== null)
      .map(user => ({
        ...user,
        distanceMeters: haversineMeters(request.latitude, request.longitude, user.latitude, user.longitude),
      }))
      .filter(user => user.distanceMeters <= request.radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  },
};
