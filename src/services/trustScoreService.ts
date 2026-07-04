import {RequestStatus, User} from '@prisma/client';

import {reportRepository} from '../repositories/reportRepository';
import {trustProfileRepository} from '../repositories/trustProfileRepository';
import {userRepository} from '../repositories/userRepository';
import {HttpError} from '../utils/httpError';
import {adminAuditLogService} from './adminAuditLogService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {
  BADGE_MIN_SAMPLE_SIZE,
  FAST_RESPONSE_MIN_RATE,
  LOW_CANCELLATION_MAX_RATE,
  PROFILE_COMPLETION_FIELDS,
  TOP_CREATOR_MIN_RATING,
  TOP_CREATOR_MIN_SUCCESSFUL,
  TRUSTED_REQUESTER_MAX_CANCELLATION_RATE,
  TRUSTED_REQUESTER_MIN_SUCCESSFUL,
  TRUST_SCORE_NEUTRAL_RATING,
  TRUST_SCORE_NEUTRAL_RELIABILITY,
  TRUST_SCORE_NEUTRAL_RESHOOT,
  TRUST_SCORE_NEUTRAL_RESPONSE_RATE,
  TRUST_SCORE_NEUTRAL_SUCCESS_RATE,
  TRUST_SCORE_SUSPICIOUS_CAP,
  TRUST_SCORE_UNRESOLVED_REPORT_PENALTY,
  TRUST_SCORE_UNRESOLVED_REPORT_PENALTY_CAP,
  TRUST_SCORE_VERIFIED_BONUS,
  TRUST_SCORE_WEIGHTS,
} from '../validations/trustProfileValidation';
import {ratingService} from './ratingService';

const TERMINAL_STATUSES: RequestStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'DISPUTED'];

type StatusCounts = Partial<Record<RequestStatus, number>>;

function toStatusCounts(rows: Array<{status: RequestStatus; _count: {_all: number}}>): StatusCounts {
  const counts: StatusCounts = {};
  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

function pct(numerator: number, denominator: number, fallback: number): number {
  if (denominator <= 0) return fallback;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export type RoleMetrics = {
  totalRequests: number;
  completedRequests: number; // reached any terminal state
  successfulRequests: number; // reached COMPLETED specifically (completedRequests above is ANY terminal outcome, incl. cancelled/rejected/expired/disputed)
  cancellationRate: number; // %
  reshootRate: number; // %
  acceptanceRate: number; // %
  responseRate: number; // %
};

/**
 * One role's metrics, computed on demand from Request/ChatMessage rows already owned by the
 * Request domain (backend Phases 1-8) — no denormalized/cached field, matching this codebase's
 * existing "computed on demand" convention for aggregates (see ratingService.getSummaryForUser).
 * `role: 'requester'` reads requests this user *created*; `role: 'creator'` reads requests this
 * user was ever assigned to fulfil (via `lastAssignedCreatorId`, which survives an acceptance
 * timeout — see the schema comment on that field).
 */
async function computeRoleMetrics(userId: string, role: 'requester' | 'creator'): Promise<RoleMetrics> {
  if (role === 'requester') {
    const [statusRows, reshootCount, pickedUpCount, chat] = await Promise.all([
      trustProfileRepository.statusCountsForRequester(userId),
      trustProfileRepository.reshootCountForRequester(userId),
      trustProfileRepository.pickedUpCountForRequester(userId),
      trustProfileRepository.chatResponsivenessForRequester(userId),
    ]);
    const counts = toStatusCounts(statusRows);
    const totalRequests = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
    const completedRequests = TERMINAL_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
    const successfulRequests = counts.COMPLETED ?? 0;
    const cancelledRequests = counts.CANCELLED ?? 0;

    return {
      totalRequests,
      completedRequests,
      successfulRequests,
      cancellationRate: pct(cancelledRequests, completedRequests, 0),
      reshootRate: pct(reshootCount, completedRequests, 0),
      // "How often does a Creator actually pick up this Requester's posts" — a proxy signal
      // for how reasonable/trustworthy their requests read to the Creator pool.
      acceptanceRate: pct(pickedUpCount, totalRequests, TRUST_SCORE_NEUTRAL_SUCCESS_RATE),
      responseRate: pct(chat.responded, chat.reached, TRUST_SCORE_NEUTRAL_RESPONSE_RATE),
    };
  }

  const [statusRows, reshootCount, timedOutCount, totalAssigned, chat] = await Promise.all([
    trustProfileRepository.statusCountsForCreator(userId),
    trustProfileRepository.reshootCountForCreator(userId),
    trustProfileRepository.timedOutCountForCreator(userId),
    trustProfileRepository.totalAssignedForCreator(userId),
    trustProfileRepository.chatResponsivenessForCreator(userId),
  ]);
  const counts = toStatusCounts(statusRows);
  const completedRequests = TERMINAL_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const successfulRequests = counts.COMPLETED ?? 0;

  return {
    totalRequests: totalAssigned,
    completedRequests,
    successfulRequests,
    // A Creator has no "cancel" action — the equivalent abandonment signal is accepting and
    // then letting the acceptance timer expire (`creatorTimedOut`, see acceptanceTimerJob).
    cancellationRate: pct(timedOutCount, totalAssigned, 0),
    reshootRate: pct(reshootCount, completedRequests, 0),
    acceptanceRate: pct(totalAssigned - timedOutCount, totalAssigned, TRUST_SCORE_NEUTRAL_SUCCESS_RATE),
    responseRate: pct(chat.responded, chat.reached, TRUST_SCORE_NEUTRAL_RESPONSE_RATE),
  };
}

function computeProfileCompletion(user: User): number {
  const filled = PROFILE_COMPLETION_FIELDS.filter(field => {
    if (field === 'location') return user.latitude !== null && user.longitude !== null;
    return Boolean((user as unknown as Record<string, unknown>)[field]);
  }).length;
  return Math.round((filled / PROFILE_COMPLETION_FIELDS.length) * 100);
}

/**
 * Composite Trust Score (0-100) — a transparent, documented weighted sum (see
 * trustProfileValidation.ts for every weight/threshold), not a black-box/ML score. Built per
 * this milestone's explicit instruction; PRD §5.8 itself defers this exact algorithm to a later
 * phase, so treat every weight as an interim default pending client confirmation.
 */
function computeTrustScore(
  metrics: RoleMetrics,
  averageRating: number | null,
  isVerified: boolean,
  isSuspicious: boolean,
  unresolvedReportCount: number,
): number {
  const successRateScore = metrics.completedRequests > 0
    ? pct(metrics.successfulRequests, metrics.completedRequests, TRUST_SCORE_NEUTRAL_SUCCESS_RATE)
    : TRUST_SCORE_NEUTRAL_SUCCESS_RATE;
  const ratingScore = averageRating !== null ? (averageRating / 5) * 100 : TRUST_SCORE_NEUTRAL_RATING;
  const reliabilityScore = metrics.totalRequests > 0
    ? 100 - metrics.cancellationRate
    : TRUST_SCORE_NEUTRAL_RELIABILITY;
  const responseScore = metrics.responseRate ?? TRUST_SCORE_NEUTRAL_RESPONSE_RATE;
  const reshootScore = metrics.completedRequests > 0
    ? 100 - metrics.reshootRate
    : TRUST_SCORE_NEUTRAL_RESHOOT;

  const weighted =
    (successRateScore * TRUST_SCORE_WEIGHTS.successRate +
      ratingScore * TRUST_SCORE_WEIGHTS.ratingScore +
      reliabilityScore * TRUST_SCORE_WEIGHTS.reliability +
      responseScore * TRUST_SCORE_WEIGHTS.responseRate +
      reshootScore * TRUST_SCORE_WEIGHTS.lowReshoot) /
    100;

  const verifiedBonus = isVerified ? TRUST_SCORE_VERIFIED_BONUS : 0;
  const reportPenalty = Math.min(
    unresolvedReportCount * TRUST_SCORE_UNRESOLVED_REPORT_PENALTY,
    TRUST_SCORE_UNRESOLVED_REPORT_PENALTY_CAP,
  );

  let score = weighted + verifiedBonus - reportPenalty;
  if (isSuspicious) score = Math.min(score, TRUST_SCORE_SUSPICIOUS_CAP);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export type Badges = {
  verified: boolean;
  topCreator: boolean;
  trustedRequester: boolean;
  lowCancellation: boolean;
  fastResponse: boolean;
};

function computeBadges(
  role: 'requester' | 'creator',
  metrics: RoleMetrics,
  averageRating: number | null,
  isVerified: boolean,
  isSuspicious: boolean,
): Badges {
  const hasSampleSize = metrics.completedRequests >= BADGE_MIN_SAMPLE_SIZE || metrics.totalRequests >= BADGE_MIN_SAMPLE_SIZE;
  const clean = !isSuspicious && hasSampleSize;

  return {
    verified: isVerified,
    topCreator:
      role === 'creator' &&
      clean &&
      metrics.successfulRequests >= TOP_CREATOR_MIN_SUCCESSFUL &&
      (averageRating ?? 0) >= TOP_CREATOR_MIN_RATING,
    trustedRequester:
      role === 'requester' &&
      clean &&
      metrics.successfulRequests >= TRUSTED_REQUESTER_MIN_SUCCESSFUL &&
      metrics.cancellationRate <= TRUSTED_REQUESTER_MAX_CANCELLATION_RATE,
    lowCancellation: clean && metrics.cancellationRate <= LOW_CANCELLATION_MAX_RATE,
    fastResponse: clean && metrics.responseRate >= FAST_RESPONSE_MIN_RATE,
  };
}

/**
 * Full Trust Profile for one user, for a given role perspective (`requester` = as the account
 * posting requests, `creator` = as the account fulfilling them — the same account can have
 * both, per PRD §3.1's "one account, either role"). Read-only: there is no update/delete path
 * for any field here — every input is sourced from Request/Rating/Report/User rows other
 * modules already own (reuse, not duplication, per docs/CLAUDE.md's "no duplicated
 * calculations" rule). A standalone function (not an object method) so its return type can be
 * referenced elsewhere in this file without a self-referential-type error.
 */
async function buildTrustProfile(userId: string, role: 'requester' | 'creator') {
  const user = await userRepository.findById(userId);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

    const [metrics, ratingSummary, reportsReceived, reportsResolved, unresolvedReportCount] = await Promise.all([
      computeRoleMetrics(userId, role),
      ratingService.getSummaryForUser(userId),
      reportRepository.count({reportedUserId: userId}),
      reportRepository.count({reportedUserId: userId, status: 'RESOLVED'}),
      reportRepository.count({reportedUserId: userId, status: 'PENDING'}),
    ]);

    const trustScore = computeTrustScore(
      metrics,
      ratingSummary.averageRating,
      user.isVerified,
      user.isSuspicious,
      unresolvedReportCount,
    );
    const badges = computeBadges(role, metrics, ratingSummary.averageRating, user.isVerified, user.isSuspicious);
    const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / (24 * 60 * 60 * 1000));

    return {
      userId,
      role,
      name: user.name,
      username: user.username,
      profileImage: user.profileImage,
      trustScore,
      verificationStatus: user.isVerified ? ('VERIFIED' as const) : ('UNVERIFIED' as const),
      suspiciousFlag: user.isSuspicious,
      averageRating: ratingSummary.averageRating,
      ratingCount: ratingSummary.ratingCount,
      completedRequests: metrics.completedRequests,
      successfulRequests: metrics.successfulRequests,
      cancellationRate: metrics.cancellationRate,
      reshootRate: metrics.reshootRate,
      acceptanceRate: metrics.acceptanceRate,
      responseRate: metrics.responseRate,
      reportsReceived,
      reportsResolved,
      profileCompletion: computeProfileCompletion(user),
      memberSince: user.createdAt.toISOString(),
      accountAgeDays,
      badges,
    };
}

export type TrustProfile = Awaited<ReturnType<typeof buildTrustProfile>>;

export const trustScoreService = {
  async getProfile(userId: string, role: 'requester' | 'creator'): Promise<TrustProfile> {
    return buildTrustProfile(userId, role);
  },

  /**
   * Badge/score change-detection (backend Phase 12, PRD §8.1 "Trust" notifications). Trust Score
   * itself is still computed on demand, never denormalized (see `buildTrustProfile` above) — this
   * only persists the *last-notified* snapshot on `User` so repeat fetches of an unchanged
   * profile don't re-notify. Checked only from `GET /trust-profile/me` (self-fetch), not from
   * every `getProfile`/`attachTrustSummaries` call site (those run on nearly every request-detail
   * page load and would make this an expensive, spammy per-request check) — an interim decision,
   * not a fully event-driven recompute on every score-affecting mutation.
   */
  async checkAndNotifyChanges(userId: string, profile: TrustProfile): Promise<void> {
    const user = await userRepository.findById(userId);
    if (!user) return;

    const earnedBadgeKeys = (Object.keys(profile.badges) as (keyof Badges)[])
      .filter(key => profile.badges[key])
      .map(key => `${profile.role}:${key}`);

    const previousBadges = new Set(user.lastNotifiedTrustBadges);
    const newlyEarned = earnedBadgeKeys.filter(key => !previousBadges.has(key));
    const mergedBadges = Array.from(new Set([...user.lastNotifiedTrustBadges, ...earnedBadgeKeys]));

    if (newlyEarned.length > 0) {
      await notificationService.notifyUser(
        userId,
        NotificationType.BADGE_EARNED,
        'Badge Earned',
        `You earned ${newlyEarned.length === 1 ? 'a new badge' : `${newlyEarned.length} new badges`}: ${newlyEarned
          .map(k => k.split(':')[1])
          .join(', ')}.`,
        {screen: 'TrustProfile'},
      );
    }

    const scoreChanged = user.lastNotifiedTrustScore !== null && user.lastNotifiedTrustScore !== profile.trustScore;
    if (scoreChanged) {
      await notificationService.notifyUser(
        userId,
        NotificationType.TRUST_SCORE_UPDATED,
        'Trust Score Updated',
        `Your Trust Score is now ${profile.trustScore}.`,
        {screen: 'TrustProfile'},
      );
    }

    if (newlyEarned.length > 0 || scoreChanged || user.lastNotifiedTrustScore === null) {
      await userRepository.update(userId, {
        lastNotifiedTrustScore: profile.trustScore,
        lastNotifiedTrustBadges: mergedBadges,
      });
    }
  },

  /**
   * Lightweight version merged onto other modules' responses (Creator Discovery, Request
   * Detail) — same numbers, no extra query beyond what `getProfile` already does; this just
   * picks the role by who's who on the request (`requesterId` -> requester profile,
   * `creatorId`/`lastAssignedCreatorId` -> creator profile) so callers don't have to know the
   * role-selection rule themselves.
   */
  async attachTrustSummaries<T extends object>(
    base: T,
    request: {requesterId: string; creatorId: string | null},
  ): Promise<T & {requesterTrustProfile: TrustProfile; creatorTrustProfile: TrustProfile | null}> {
    const [requesterTrustProfile, creatorTrustProfile] = await Promise.all([
      this.getProfile(request.requesterId, 'requester'),
      request.creatorId ? this.getProfile(request.creatorId, 'creator') : Promise.resolve(null),
    ]);
    return {...base, requesterTrustProfile, creatorTrustProfile};
  },

  // --- Admin (PRD §5.14-adjacent) ----------------------------------------------------------

  /** `GET /admin/trust-profiles` — paginated at the User level, then enriched per page. */
  async adminList(
    filters: {isSuspicious?: boolean; isVerified?: boolean; isActive?: boolean; search?: string},
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const [users, total] = await trustProfileRepository.findUsersForAdminList(filters, skip, limit);

    const items = await Promise.all(
      users.map(async user => ({
        requesterProfile: await this.getProfile(user.id, 'requester'),
        creatorProfile: await this.getProfile(user.id, 'creator'),
      })),
    );

    return {items, total, page, limit, totalPages: Math.ceil(total / limit)};
  },

  /** `GET /admin/trust-profiles/:userId` — both role perspectives + review-note history. */
  async adminDetail(userId: string) {
    const [requesterProfile, creatorProfile, notes] = await Promise.all([
      this.getProfile(userId, 'requester'),
      this.getProfile(userId, 'creator'),
      this.adminListNotes(userId),
    ]);
    return {requesterProfile, creatorProfile, notes};
  },

  /** `PATCH /admin/trust-profiles/:userId/verify` — toggles the Verified Badge, audit-logged. */
  async adminSetVerified(adminId: string, userId: string, isVerified: boolean) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }
    await trustProfileRepository.setVerified(userId, isVerified);
    await adminAuditLogService.log(adminId, isVerified ? 'USER_VERIFIED' : 'USER_UNVERIFIED', 'User', userId);
    if (isVerified) {
      await notificationService.notifyUser(
        userId,
        NotificationType.VERIFICATION_GRANTED,
        'Verification Granted',
        'Your account has been verified by our team.',
        {screen: 'TrustProfile'},
      );
    }
    return this.getProfile(userId, 'requester');
  },

  /**
   * Manual review notes — reuses the existing immutable `AdminAuditLog` (per docs/CLAUDE.md's
   * "reuse existing" instruction) rather than a new table; a note is just an audit-logged
   * action against the `User` entity, same as every other Admin annotation in this codebase.
   */
  async adminAddNote(adminId: string, userId: string, note: string) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }
    await adminAuditLogService.log(adminId, 'TRUST_REVIEW_NOTE_ADDED', 'User', userId, {note});
    return this.adminListNotes(userId);
  },

  async adminListNotes(userId: string) {
    const {items} = await adminAuditLogService.list({targetEntityType: 'User', targetEntityId: userId}, 1, 100);
    return items.filter(entry => entry.action === 'TRUST_REVIEW_NOTE_ADDED');
  },

  /** `GET /admin/trust-profiles/stats` — aggregate counters for the Admin dashboard. */
  async adminStats() {
    const [totalUsers, suspiciousUsers, verifiedUsers] = await Promise.all([
      trustProfileRepository.countTotalUsers(),
      trustProfileRepository.countSuspicious(),
      trustProfileRepository.countVerified(),
    ]);
    return {totalUsers, suspiciousUsers, verifiedUsers};
  },
};
