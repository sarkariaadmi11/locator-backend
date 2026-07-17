import {adminAlertRepository} from '../repositories/adminAlertRepository';
import {userRepository} from '../repositories/userRepository';
import {haversineMeters} from '../utils/geo';
import {logger} from '../config/logger';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';

/**
 * GPS spoofing / mock-location signal ingestion (PRD_TRD_SUMMARY.md §5.10, backend Phase 8
 * item 2, TRD's `gps_spoofing_check`). Server-side impossible-velocity check between
 * consecutive GPS reads — compares a new reading against `User.latitude`/`longitude`/
 * `locationUpdatedAt` (the same "last known location" fields `POST /location/save` and the
 * Nearby Feed already maintain, reused rather than duplicated).
 *
 * **Explicit MVP policy (repeated throughout the PRD): flag-and-queue for Admin review, never
 * auto-block.** This function never throws and never prevents the caller's action from
 * proceeding — it only fires an Admin-only notification when triggered. Call sites: accept-time
 * (`requestService.accept`, has the Creator's live GPS) and recording-upload-complete
 * (`recordingService.completeUpload`, has the embedded GPS metadata).
 */
const IMPOSSIBLE_VELOCITY_KMH_THRESHOLD = 200;
/** Below this many seconds between reads, a velocity computation is too noisy to trust (GPS jitter). */
const MIN_ELAPSED_SECONDS = 5;

export const gpsSpoofingService = {
  async checkAndFlag(userId: string, newLat: number, newLng: number, context: 'accept' | 'recording_upload') {
    try {
      const user = await userRepository.findById(userId);
      if (!user?.latitude || !user?.longitude || !user?.locationUpdatedAt) {
        return; // No prior reading to compare against — nothing to flag yet.
      }

      const elapsedSeconds = (Date.now() - user.locationUpdatedAt.getTime()) / 1000;
      if (elapsedSeconds < MIN_ELAPSED_SECONDS) return;

      const distanceMeters = haversineMeters(user.latitude, user.longitude, newLat, newLng);
      const impliedKmh = distanceMeters / 1000 / (elapsedSeconds / 3600);

      if (impliedKmh > IMPOSSIBLE_VELOCITY_KMH_THRESHOLD) {
        logger.warn(
          `[gpsSpoofingService] Impossible velocity for user=${userId} context=${context}: ${impliedKmh.toFixed(0)}km/h implied over ${elapsedSeconds.toFixed(0)}s.`,
        );
        const message = `User ${user.username} showed an implied velocity of ${impliedKmh.toFixed(0)} km/h during ${context}. Flagged for review — no automatic action taken.`;
        await notificationService.notifyAdmins(
          NotificationType.GPS_SPOOFING_SUSPECTED,
          'Possible GPS spoofing detected',
          message,
          {userId, context, impliedKmh: impliedKmh.toFixed(0)},
        );
        // Live Monitoring alert feed (PRD §5.14.2) — additive alongside the push notification
        // above, so this signal is also queryable in the panel, not just ephemeral push.
        await adminAlertRepository.create({
          type: 'GPS_SPOOFING_SUSPECTED',
          message,
          metadata: {context, impliedKmh: impliedKmh.toFixed(0)},
          userId,
        });
      }
    } catch (err) {
      // Best-effort safety net — must never block the caller's actual action (accept/upload).
      logger.error(`[gpsSpoofingService] Check failed, ignoring: ${(err as Error).message}`);
    }
  },
};
