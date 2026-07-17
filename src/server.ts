import dns from 'dns';

// Render's free tier has no IPv6 outbound — force IPv4 for all DNS resolutions
dns.setDefaultResultOrder('ipv4first');

import {app} from './app';
import {env} from './config/env';
import {logger} from './config/logger';
import {disconnectRedis} from './config/redis';
import {prisma} from './prisma/client';
import {acceptanceTimerJob} from './services/acceptanceTimerJob';
import {ledgerReconciliationJob} from './services/ledgerReconciliationJob';
import {matchingWindowJob} from './services/matchingWindowJob';
import {monitoringJob} from './services/monitoringJob';
import {notificationReminderJob} from './services/notificationReminderJob';
import {requestLifecycleJob} from './services/requestLifecycleJob';
import {requesterReviewAutoAcceptJob} from './services/requesterReviewAutoAcceptJob';
import {retentionJob} from './services/retentionJob';
import {seedAdmins} from './utils/seedAdmins';
import {runStartupChecks, logStartupSummary} from './utils/startupChecks';

const REQUEST_LIFECYCLE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const ACCEPTANCE_TIMER_SWEEP_INTERVAL_MS = 30 * 1000;
// Highest Rated matching window (default 90s, admin-configurable 30-300s) — swept far more
// frequently than the window itself so a close is picked up promptly.
const MATCHING_WINDOW_SWEEP_INTERVAL_MS = 15 * 1000;
const NOTIFICATION_REMINDER_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
// v2.1 §5.8 `requester_review_auto_accept` — TRD 9 specifies "every 15 min".
const AUTO_ACCEPT_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
// v2.1 §5.8 `ledger_reconciliation` — TRD 9 specifies "nightly, e.g. 02:00 IST". No cron
// library in this stack (matches every other job here) — a fixed 24h interval from server boot
// is an approximation, not a precise 02:00 IST trigger; flagged, not silently treated as exact.
const LEDGER_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_SWEEP_INTERVAL_MS = env.RETENTION_SWEEP_INTERVAL_MINUTES * 60 * 1000;
const MONITORING_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function bootstrap() {
  const checks = await runStartupChecks();

  if (!checks.database.ok) {
    logger.error(`Database connection failed — refusing to start. Reason: ${checks.database.reason}`);
    process.exit(1);
  }

  await seedAdmins();

  const server = app.listen(env.PORT, () => {
    logStartupSummary(checks, env.PORT);
  });

  // Publishes due SCHEDULED requests and expires stale DRAFT/PUBLISHED ones (PRD §7.3, §4.3).
  // No job queue exists in this stack yet — an in-process interval is the minimal correct
  // mechanism at MVP scale; revisit if this ever needs to run across multiple instances.
  const lifecycleInterval = setInterval(() => {
    requestLifecycleJob.runSweep().catch(err => {
      logger.error(`[requestLifecycleJob] Sweep failed: ${(err as Error).message}`);
    });
  }, REQUEST_LIFECYCLE_SWEEP_INTERVAL_MS);

  // Acceptance-timer expiry sweep (PRD §5.5) — release the Redis lock and republish requests
  // whose Creator never started recording within the acceptance window. Runs far more
  // frequently than the lifecycle sweep since this window is minutes, not hours.
  const acceptanceTimerInterval = setInterval(() => {
    acceptanceTimerJob.runSweep().catch(err => {
      logger.error(`[acceptanceTimerJob] Sweep failed: ${(err as Error).message}`);
    });
  }, ACCEPTANCE_TIMER_SWEEP_INTERVAL_MS);

  // Highest Rated matching-window close sweep (backend Phase 4 item 4).
  const matchingWindowInterval = setInterval(() => {
    matchingWindowJob.runSweep().catch(err => {
      logger.error(`[matchingWindowJob] Sweep failed: ${(err as Error).message}`);
    });
  }, MATCHING_WINDOW_SWEEP_INTERVAL_MS);

  // Reminder sweep (backend Phase 12) — recording/review/rating reminders, each gated on its
  // own `*ReminderSentAt` timestamp so a request is only ever reminded once per stage.
  const notificationReminderInterval = setInterval(() => {
    notificationReminderJob.runSweep().catch(err => {
      logger.error(`[notificationReminderJob] Sweep failed: ${(err as Error).message}`);
    });
  }, NOTIFICATION_REMINDER_SWEEP_INTERVAL_MS);

  // v2.1 Requester Review 48h auto-accept (PRD_TRD_SUMMARY.md §5.8, backend Phase 3 item 5) —
  // 42h warning + 48h auto-accept, every 15 min per TRD 9's schedule.
  const autoAcceptInterval = setInterval(() => {
    requesterReviewAutoAcceptJob.runSweep().catch(err => {
      logger.error(`[requesterReviewAutoAcceptJob] Sweep failed: ${(err as Error).message}`);
    });
  }, AUTO_ACCEPT_SWEEP_INTERVAL_MS);

  // v2.1 nightly ledger reconciliation (PRD_TRD_SUMMARY.md §5.8, backend Phase 8 item 4) —
  // correctness backstop, never mutates, alerts Admins on any variance.
  const ledgerReconciliationInterval = setInterval(() => {
    ledgerReconciliationJob.runSweep().catch(err => {
      logger.error(`[ledgerReconciliationJob] Sweep failed: ${(err as Error).message}`);
    });
  }, LEDGER_RECONCILIATION_INTERVAL_MS);

  // Compliance & Data Retention sweep (backend Phase 13) — chat/video/notification purges,
  // inactive-account cleanup, expired-draft cleanup, and scheduled hard-deletes. Runs far less
  // often than the other jobs since these windows are days/hours, not minutes.
  const retentionInterval = setInterval(() => {
    retentionJob.runSweep().catch(err => {
      logger.error(`[retentionJob] Sweep failed: ${(err as Error).message}`);
    });
  }, RETENTION_SWEEP_INTERVAL_MS);

  // Monitoring/alerting sweep (PRD §11, backend Phase 14) — moderation/payout queue depth and
  // failed-webhook rate, each checked against a documented threshold and pushed to Admins as a
  // notification when breached (see monitoringJob.ts).
  const monitoringInterval = setInterval(() => {
    monitoringJob.runSweep().catch(err => {
      logger.error(`[monitoringJob] Sweep failed: ${(err as Error).message}`);
    });
  }, MONITORING_SWEEP_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully.`);
    clearInterval(lifecycleInterval);
    clearInterval(acceptanceTimerInterval);
    clearInterval(matchingWindowInterval);
    clearInterval(notificationReminderInterval);
    clearInterval(autoAcceptInterval);
    clearInterval(ledgerReconciliationInterval);
    clearInterval(retentionInterval);
    clearInterval(monitoringInterval);
    server.close(async () => {
      await prisma.$disconnect();
      await disconnectRedis();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch(err => {
  logger.error(`Failed to start server: ${(err as Error).message}`);
  process.exit(1);
});
