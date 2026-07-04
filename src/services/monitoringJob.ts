import {logger} from '../config/logger';
import {payoutRequestRepository} from '../repositories/payoutRequestRepository';
import {moderationService} from './moderationService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {getWebhookFailureCountLastHour} from './webhookHealthTracker';

// PRD §11 monitoring/alerting thresholds. Interim engineering defaults (not PRD-numbered) —
// flagged the same way every other undocumented threshold in this codebase is (docs/CLAUDE.md
// §8 rule 11), surfaced here rather than buried inline so a client-confirmed value is a one-line
// change.
export const MODERATION_QUEUE_ALERT_THRESHOLD = 50;
export const PAYOUT_QUEUE_ALERT_THRESHOLD = 20;
export const FAILED_WEBHOOK_ALERT_THRESHOLD_PER_HOUR = 5;

/**
 * Monitoring/alerting sweep (PRD §11, backend Phase 14) — checks the three thresholds the PRD
 * names explicitly (moderation queue depth, pending-payout queue depth, failed-webhook rate) and
 * pushes an Admin-only alert (reusing `notificationService.notifyAdmins`, the same path
 * `escrowService`'s `LARGE_REFUND`/`reportService`'s `HIGH_PRIORITY_REPORT` already use — no
 * second alerting mechanism) whenever one is breached. Also always logs the current values at
 * `info` level so they're visible in structured logs/log-based dashboards even when nothing is
 * breached.
 */
export const monitoringJob = {
  async runSweep() {
    const [moderationStats, pendingPayouts] = await Promise.all([
      moderationService.getStats(),
      payoutRequestRepository.count({status: 'PENDING'}),
    ]);
    const failedWebhooksLastHour = getWebhookFailureCountLastHour();

    logger.info(
      `[monitoringJob] moderationQueueDepth=${moderationStats.pendingQueueDepth} ` +
        `pendingPayouts=${pendingPayouts} failedWebhooksLastHour=${failedWebhooksLastHour}`,
    );

    if (moderationStats.pendingQueueDepth > MODERATION_QUEUE_ALERT_THRESHOLD) {
      await this.alert(
        'Moderation queue backlog',
        `${moderationStats.pendingQueueDepth} videos are pending moderation (threshold: ${MODERATION_QUEUE_ALERT_THRESHOLD}).`,
      );
    }

    if (pendingPayouts > PAYOUT_QUEUE_ALERT_THRESHOLD) {
      await this.alert(
        'Payout queue backlog',
        `${pendingPayouts} payout requests are pending approval (threshold: ${PAYOUT_QUEUE_ALERT_THRESHOLD}).`,
      );
    }

    if (failedWebhooksLastHour > FAILED_WEBHOOK_ALERT_THRESHOLD_PER_HOUR) {
      await this.alert(
        'Elevated webhook failure rate',
        `${failedWebhooksLastHour} Razorpay webhook calls failed in the last hour (threshold: ${FAILED_WEBHOOK_ALERT_THRESHOLD_PER_HOUR}).`,
      );
    }
  },

  async alert(title: string, body: string) {
    logger.warn(`[monitoringJob] ALERT — ${title}: ${body}`);
    await notificationService.notifyAdmins(NotificationType.SYSTEM_THRESHOLD_ALERT, title, body);
  },
};
