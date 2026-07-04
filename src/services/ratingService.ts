import {ratingRepository} from '../repositories/ratingRepository';
import {requestRepository} from '../repositories/requestRepository';
import {HttpError} from '../utils/httpError';
import {presentRating, presentRatingSummary, RatingSummary} from '../utils/ratingPresenter';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';

/** Mutual Ratings (PRD §5.12, §4.6 "Rate your experience", backend Phase 9). */
export const ratingService = {
  /**
   * `POST /requests/:id/rate` — direction (Requester->Creator vs Creator->Requester) is derived
   * from which side the caller is on, not passed by the client. Only reachable once the request
   * is COMPLETED (PRD §4.6), and exactly once per participant (DB-unique on requestId+raterId,
   * checked here first for a clean error message) — there is no update/delete path anywhere in
   * this module, which is what "no editing after submission" means in practice.
   */
  async rate(userId: string, requestId: string, stars: number, comment: string | undefined) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    if (request.status !== 'COMPLETED') {
      throw new HttpError(409, 'Ratings are only allowed once a request is completed.');
    }

    let rateeId: string;
    let role: 'REQUESTER_RATES_CREATOR' | 'CREATOR_RATES_REQUESTER';
    if (request.requesterId === userId) {
      role = 'REQUESTER_RATES_CREATOR';
      rateeId = request.creatorId as string;
    } else if (request.creatorId === userId) {
      role = 'CREATOR_RATES_REQUESTER';
      rateeId = request.requesterId;
    } else {
      throw new HttpError(403, 'Only participants of this request can rate each other.');
    }

    const existing = await ratingRepository.findByRequestAndRater(requestId, userId);
    if (existing) {
      throw new HttpError(409, 'You have already rated this request.');
    }

    const rating = await ratingRepository.create({
      request: {connect: {id: requestId}},
      rater: {connect: {id: userId}},
      ratee: {connect: {id: rateeId}},
      role,
      stars,
      reviewText: comment ?? null,
    });

    await notificationService.notifyUser(
      rateeId,
      NotificationType.RATING_RECEIVED,
      'New Rating Received',
      `You received a ${stars}-star rating.`,
      {requestId, stars: String(stars), screen: 'RequestDetail'},
    );

    return presentRating(rating);
  },

  /** `GET /requests/:id/rating` — participants only, shows both directions once submitted. */
  async getForRequest(userId: string, requestId: string) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    if (request.requesterId !== userId && request.creatorId !== userId) {
      throw new HttpError(403, 'You are not a participant in this request.');
    }

    const ratings = await ratingRepository.findByRequestId(requestId);
    return ratings.map(presentRating);
  },

  /** Average/count for a user, computed on demand — no denormalized field on `User`. */
  async getSummaryForUser(userId: string): Promise<RatingSummary> {
    const agg = await ratingRepository.aggregateForUser(userId);
    return presentRatingSummary(agg._avg.stars, agg._count.stars);
  },

  /**
   * Attaches both participants' rating summaries onto an already-presented request object —
   * shared by `requestService.getById`/`getDetailsForCreator` so "show average rating on
   * Request Detail / Creator Discovery" (this milestone's explicit ask) isn't duplicated logic.
   */
  async attachRatingSummaries<T extends object>(
    base: T,
    request: {requesterId: string; creatorId: string | null},
  ): Promise<T & {requesterRating: RatingSummary; creatorRating: RatingSummary | null}> {
    const [requesterRating, creatorRating] = await Promise.all([
      this.getSummaryForUser(request.requesterId),
      request.creatorId ? this.getSummaryForUser(request.creatorId) : Promise.resolve(null),
    ]);
    return {...base, requesterRating, creatorRating};
  },
};
