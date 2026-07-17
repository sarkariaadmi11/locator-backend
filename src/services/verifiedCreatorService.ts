import {prisma} from '../prisma/client';
import {ratingRepository} from '../repositories/ratingRepository';
import {requestRepository} from '../repositories/requestRepository';
import {userRepository} from '../repositories/userRepository';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {SettingsKey, settingsService} from './settingsService';

/**
 * Verified Creator Badge automation (PRD_TRD_SUMMARY.md §3.5, §4.12, backend Phase 7).
 * Replaces `User.isVerified`'s previous manual-Admin-toggle-only semantics with the v2.1
 * auto-award/auto-revoke/auto-reinstate rule, backed by the `VerifiedCreatorStatus` table
 * (Phase 1). `User.isVerified` is kept in sync (not replaced) so every existing consumer of it
 * — `trustScoreService.buildTrustProfile`'s badge computation, `computeTrustScore` — reflects
 * the automated result without needing its own change; `VerifiedCreatorStatus` is the source of
 * truth for *why* (`revokedReason`) and the automation bookkeeping (`completedCount`,
 * `lastEvaluatedAt`), `User.isVerified` is the read-optimized boolean everything else already
 * expects.
 *
 * Event-driven per TRD 9 — call `evaluate(creatorId)` after every Completed transition (see
 * `requesterReviewService.acceptVideo`) and every new Creator-directed rating (see
 * `ratingService.rate`), never from a sweep.
 *
 * An Admin's manual `adminSetVerified` override (`trustScoreService.adminSetVerified`,
 * pre-existing) still works — it sets `User.isVerified` directly. The next automated
 * `evaluate()` call (next completion or rating) will recompute and may override a manual
 * change if the underlying stats disagree; this mirrors the plan's "keep the manual Admin
 * override as a secondary path" instruction without adding a "manually pinned, never
 * re-evaluated" flag that doesn't exist in the schema.
 */
export const verifiedCreatorService = {
  async evaluate(creatorId: string) {
    const [user, completedCount, threshold, minRating, ratingWindow, existing] = await Promise.all([
      userRepository.findById(creatorId),
      requestRepository.countCompletedForCreator(creatorId),
      settingsService.getNumber(SettingsKey.VERIFIED_CREATOR_THRESHOLD, 50),
      settingsService.getNumber(SettingsKey.VERIFIED_CREATOR_MIN_RATING, 3.5),
      settingsService.getNumber(SettingsKey.VERIFIED_CREATOR_RATING_WINDOW, 20),
      prisma.verifiedCreatorStatus.findUnique({where: {userId: creatorId}}),
    ]);
    if (!user) return null;

    const recentRatings = await ratingRepository.findRecentForRateeRole(creatorId, 'REQUESTER_RATES_CREATOR', ratingWindow);
    const avgRecentRating =
      recentRatings.length > 0 ? recentRatings.reduce((sum, r) => sum + r.stars, 0) / recentRatings.length : null;

    const isSuspended = !user.isActive;
    // Only evaluate the rating gate once there's a meaningful sample (the full window) —
    // a Creator with 2 ratings shouldn't be revoked off one bad early rating.
    const ratingGateFails = recentRatings.length >= ratingWindow && (avgRecentRating ?? 0) < minRating;

    const wasVerified = existing?.isVerified ?? user.isVerified;
    let nextVerified: boolean;
    let revokedReason: 'SUSPENSION' | 'LOW_RATING' | 'ADMIN_MANUAL' | null = null;

    if (isSuspended) {
      nextVerified = false;
      revokedReason = 'SUSPENSION';
    } else if (ratingGateFails) {
      nextVerified = false;
      revokedReason = 'LOW_RATING';
    } else {
      // Auto-award (first time crossing the threshold) or auto-reinstate (was revoked, condition cleared).
      nextVerified = completedCount >= threshold;
    }

    await prisma.verifiedCreatorStatus.upsert({
      where: {userId: creatorId},
      create: {userId: creatorId, completedCount, isVerified: nextVerified, revokedReason, lastEvaluatedAt: new Date()},
      update: {completedCount, isVerified: nextVerified, revokedReason, lastEvaluatedAt: new Date()},
    });

    if (nextVerified !== user.isVerified) {
      await userRepository.update(creatorId, {isVerified: nextVerified});
    }

    if (nextVerified && !wasVerified) {
      await notificationService.notifyUser(
        creatorId,
        NotificationType.VERIFICATION_GRANTED,
        'Verified Creator Badge Earned!',
        `You've completed ${completedCount} requests and earned the Verified Creator badge.`,
        {screen: 'TrustProfile'},
      );
    }

    return {isVerified: nextVerified, completedCount, revokedReason};
  },
};
