import {CreatorAvailability} from '@prisma/client';

import {requestRepository} from '../repositories/requestRepository';
import {userRepository} from '../repositories/userRepository';
import {boundingBox, haversineMeters} from '../utils/geo';
import {HttpError} from '../utils/httpError';
import {presentRequest} from '../utils/requestPresenter';
import {presentUser} from '../utils/userPresenter';
import {resolveCity} from './locationService';
import {ratingService} from './ratingService';
import {trustScoreService} from './trustScoreService';
import {REQUEST_DEFAULT_RADIUS_METERS} from '../validations/requestValidation';

const DASHBOARD_PENDING_PREVIEW_LIMIT = 5;
const DASHBOARD_ACCEPTED_PREVIEW_LIMIT = 10;

/** Creator-facing profile/status/dashboard endpoints (PRD §5.5, §5.11, §5.14.1-adjacent). */
export const creatorService = {
  async updateLocation(userId: string, latitude: number, longitude: number) {
    const existing = await userRepository.findById(userId);
    // Only resolve on first fix / when the city is unknown — this endpoint fires on every GPS
    // ping while the Creator Dashboard is open, so re-geocoding every time would be wasteful.
    const city = existing && !existing.city ? await resolveCity(latitude, longitude) : undefined;
    const updated = await userRepository.updateLocation(userId, latitude, longitude, city);
    return presentUser(updated);
  },

  async updateStatus(userId: string, availabilityStatus: CreatorAvailability) {
    const updated = await userRepository.updateAvailability(userId, availabilityStatus);
    return presentUser(updated);
  },

  /**
   * `GET /creator/dashboard` — availability, last known location, nearby-count, plus the
   * fulfilment-side additions this phase adds: the Creator's current in-flight request (with
   * its acceptance countdown), a preview of nearby pending requests, and recently accepted ones.
   */
  async dashboard(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

    let nearbyRequestsCount = 0;
    let pendingRequestsPreview: ReturnType<typeof presentRequest>[] = [];
    if (user.latitude !== null && user.longitude !== null) {
      const box = boundingBox(user.latitude, user.longitude, REQUEST_DEFAULT_RADIUS_METERS);
      const candidates = await requestRepository.findDiscoverableInBoundingBox({
        excludeUserId: userId,
        minLat: box.minLat,
        maxLat: box.maxLat,
        minLng: box.minLng,
        maxLng: box.maxLng,
        now: new Date(),
      });
      const withinRadius = candidates
        .map(request => ({
          request,
          distanceMeters: haversineMeters(user.latitude as number, user.longitude as number, request.latitude, request.longitude),
        }))
        .filter(({distanceMeters}) => distanceMeters <= REQUEST_DEFAULT_RADIUS_METERS)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);

      nearbyRequestsCount = withinRadius.length;
      pendingRequestsPreview = withinRadius
        .slice(0, DASHBOARD_PENDING_PREVIEW_LIMIT)
        .map(({request, distanceMeters}) => presentRequest(request, distanceMeters));
    }

    const [activeRequest, acceptedRequests, myRating, myTrustProfile] = await Promise.all([
      requestRepository.findActiveForCreator(userId),
      requestRepository.findAcceptedForCreator(userId, DASHBOARD_ACCEPTED_PREVIEW_LIMIT),
      ratingService.getSummaryForUser(userId),
      trustScoreService.getUserFacingProfile(userId, 'creator'),
    ]);

    return {
      availabilityStatus: user.availabilityStatus,
      myRating,
      myTrustProfile,
      location:
        user.latitude !== null && user.longitude !== null
          ? {
              latitude: user.latitude,
              longitude: user.longitude,
              city: user.city,
              updatedAt: user.locationUpdatedAt?.toISOString() ?? null,
            }
          : null,
      nearbyRequestsCount,
      pendingRequests: pendingRequestsPreview,
      activeRequest: activeRequest ? presentRequest(activeRequest) : null,
      // Acceptance immediately advances a request into TEMPORARY_CHAT (chat opens
      // automatically, PRD §5.4), so that's the status this countdown is observed in.
      acceptanceCountdownSeconds:
        activeRequest?.acceptanceTimerExpiresAt && activeRequest.status === 'TEMPORARY_CHAT'
          ? Math.max(0, Math.round((activeRequest.acceptanceTimerExpiresAt.getTime() - Date.now()) / 1000))
          : null,
      acceptedRequests: acceptedRequests.map(request => presentRequest(request)),
      // Fulfilment history (completed count, earnings) belongs to Phase 5-8's Creator side —
      // not built yet, intentionally omitted rather than faked here.
    };
  },
};
