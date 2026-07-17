import {logger} from '../config/logger';
import {chatRepository} from '../repositories/chatRepository';
import {dataDeletionLogRepository} from '../repositories/dataDeletionLogRepository';
import {notificationRepository} from '../repositories/notificationRepository';
import {phoneOtpRepository} from '../repositories/phoneOtpRepository';
import {refreshTokenRepository} from '../repositories/refreshTokenRepository';
import {registrationOtpRepository} from '../repositories/registrationOtpRepository';
import {requestRepository} from '../repositories/requestRepository';
import {requestVideoRepository} from '../repositories/requestVideoRepository';
import {userRepository} from '../repositories/userRepository';
import {videoStorageProvider} from './storage';
import {ComplianceConfigKey, complianceConfigService} from './complianceConfigService';
import {requestLifecycleJob} from './requestLifecycleJob';
import {TERMINAL_STATUSES} from './requestStateMachine';

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number) {
  return hoursAgo(days * 24);
}

/**
 * Data Retention & Data Management scheduled jobs (PRD §9, backend Phase 13). Every purge is
 * best-effort per-row (one failure never blocks the rest of the sweep, matching
 * `requestLifecycleJob`'s established pattern) and writes a `DataDeletionLog` row so there is an
 * immutable audit trail of exactly what was purged and why — independent of `AdminAuditLog`
 * (Admin-actor-only), since these are system/scheduled-job actions with no Admin behind them.
 */
export const retentionJob = {
  /** Chat retention (PRD §9, §5.4) — deletes messages for requests closed long enough ago. */
  async purgeExpiredChatMessages() {
    const days = await complianceConfigService.getNumber(ComplianceConfigKey.CHAT_RETENTION_DAYS);
    const result = await chatRepository.deleteOlderThanForClosedRequests(daysAgo(days), [...TERMINAL_STATUSES]);
    if (result.count > 0) {
      await dataDeletionLogRepository.create({
        action: 'CHAT_MESSAGES_PURGED',
        entityType: 'ChatMessage',
        metadata: {count: result.count, retentionDays: days},
      });
      logger.info(`[retentionJob.purgeExpiredChatMessages] Purged ${result.count} chat message(s).`);
    }
    return result.count;
  },

  /** Video asset retention (PRD §9, §5.6) — deletes the Cloudinary asset, keeps the audit row. */
  async purgeExpiredVideoAssets() {
    const [fulfilledHours, terminalHours] = await Promise.all([
      complianceConfigService.getNumber(ComplianceConfigKey.VIDEO_FULFILLED_RETENTION_HOURS),
      complianceConfigService.getNumber(ComplianceConfigKey.VIDEO_TERMINAL_RETENTION_HOURS),
    ]);

    const candidates = [
      ...(await requestVideoRepository.findFulfilledPurgeCandidates(hoursAgo(fulfilledHours))),
      ...(await requestVideoRepository.findTerminalPurgeCandidates(hoursAgo(terminalHours), {
        in: ['REJECTED', 'EXPIRED', 'CANCELLED', 'DISPUTED'],
      })),
    ];

    let purged = 0;
    for (const video of candidates) {
      if (!video.storagePublicId) continue;
      try {
        await videoStorageProvider.deleteVideo(video.storagePublicId);
        await requestVideoRepository.markAssetPurged(video.id);
        await dataDeletionLogRepository.create({
          action: 'VIDEO_ASSET_PURGED',
          entityType: 'RequestVideo',
          entityId: video.id,
          metadata: {requestId: video.requestId},
        });
        purged += 1;
      } catch (err) {
        logger.error(`[retentionJob.purgeExpiredVideoAssets] Failed for video=${video.id}: ${(err as Error).message}`);
      }
    }

    if (purged > 0) {
      logger.info(`[retentionJob.purgeExpiredVideoAssets] Purged ${purged} video asset(s).`);
    }
    return purged;
  },

  /** Notification retention (this milestone's own explicit ask, not PRD-numbered). */
  async purgeExpiredNotifications() {
    const days = await complianceConfigService.getNumber(ComplianceConfigKey.NOTIFICATION_RETENTION_DAYS);
    const result = await notificationRepository.deleteReadOlderThan(daysAgo(days));
    if (result.count > 0) {
      await dataDeletionLogRepository.create({
        action: 'NOTIFICATIONS_PURGED',
        entityType: 'Notification',
        metadata: {count: result.count, retentionDays: days},
      });
      logger.info(`[retentionJob.purgeExpiredNotifications] Purged ${result.count} notification(s).`);
    }
    return result.count;
  },

  /**
   * Inactive-account cleanup — scoped conservatively (this milestone's interim decision, since
   * the PRD doesn't specify an inactive-account policy beyond deletion-on-request): purges only
   * genuinely stale ephemeral data (expired registration/password-reset OTPs, dead FCM tokens for
   * accounts untouched for a long time) rather than deactivating or locking anyone out.
   */
  async cleanupInactiveAccounts() {
    const inactiveDays = await complianceConfigService.getNumber(ComplianceConfigKey.INACTIVE_ACCOUNT_DAYS);
    const now = new Date();

    const [expiredRegistrations, expiredPhoneOtps, expiredRefreshTokens] = await Promise.all([
      registrationOtpRepository.deleteExpired(now),
      phoneOtpRepository.deleteExpired(now),
      refreshTokenRepository.deleteExpired(now),
    ]);

    const staleUsers = await userRepository.findInactiveWithFcmToken(daysAgo(inactiveDays));
    for (const user of staleUsers) {
      await userRepository.clearFcmToken(user.id);
    }

    const total = expiredRegistrations.count + expiredPhoneOtps.count + expiredRefreshTokens.count + staleUsers.length;
    if (total > 0) {
      await dataDeletionLogRepository.create({
        action: 'INACTIVE_ACCOUNT_CLEANED',
        entityType: 'User',
        metadata: {
          expiredRegistrationOtps: expiredRegistrations.count,
          expiredPhoneOtps: expiredPhoneOtps.count,
          expiredRefreshTokens: expiredRefreshTokens.count,
          staleFcmTokensCleared: staleUsers.length,
          inactiveDays,
        },
      });
      logger.info(
        `[retentionJob.cleanupInactiveAccounts] Cleaned ${expiredRegistrations.count} registration OTP(s), ` +
          `${expiredPhoneOtps.count} phone OTP(s), ${expiredRefreshTokens.count} refresh token(s), ` +
          `${staleUsers.length} stale FCM token(s).`,
      );
    }
    return total;
  },

  /**
   * Expired-draft cleanup — `requestLifecycleJob.expireDueRequests` already owns the actual
   * DRAFT/PUBLISHED -> EXPIRED business transition (backend Phase 2/8, untouched by this phase).
   * This is the Data-Management-side accounting layer on top of it: `requestLifecycleJob` runs
   * every 5 minutes and doesn't write a `DataDeletionLog` row (that's a Phase 13 concept, not a
   * Phase 2 one) — this re-invokes the same idempotent sweep (a second call is a safe no-op for
   * anything already expired) and logs the compliance-side audit trail this milestone asks for.
   */
  async cleanupExpiredDrafts() {
    const expired = await requestLifecycleJob.expireDueRequests();
    if (expired > 0) {
      await dataDeletionLogRepository.create({
        action: 'EXPIRED_DRAFT_CLEANED',
        entityType: 'Request',
        metadata: {count: expired},
      });
    }
    return expired;
  },

  /**
   * Suspend User auto-reactivation (PRD §5.9.2) — lifts any time-boxed suspension whose
   * `suspendedUntil` has elapsed. Never touches an indefinite `toggleBlock` (which leaves
   * `suspendedUntil` null, so it's simply never selected here).
   */
  async reactivateExpiredSuspensions() {
    const candidates = await userRepository.findExpiredSuspensions(new Date());
    for (const user of candidates) {
      await userRepository.reactivateExpiredSuspension(user.id);
    }
    if (candidates.length > 0) {
      logger.info(`[retentionJob.reactivateExpiredSuspensions] Reactivated ${candidates.length} account(s).`);
    }
    return candidates.length;
  },

  async runSweep() {
    const chatMessagesPurged = await this.purgeExpiredChatMessages();
    const videoAssetsPurged = await this.purgeExpiredVideoAssets();
    const notificationsPurged = await this.purgeExpiredNotifications();
    const inactiveAccountsCleaned = await this.cleanupInactiveAccounts();
    const expiredDraftsCleaned = await this.cleanupExpiredDrafts();
    const suspensionsReactivated = await this.reactivateExpiredSuspensions();
    return {
      chatMessagesPurged,
      videoAssetsPurged,
      notificationsPurged,
      inactiveAccountsCleaned,
      expiredDraftsCleaned,
      suspensionsReactivated,
    };
  },
};
