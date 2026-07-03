import dns from 'dns';

// Render's free tier has no IPv6 outbound — force IPv4 for all DNS resolutions
dns.setDefaultResultOrder('ipv4first');

import {app} from './app';
import {env} from './config/env';
import {logger} from './config/logger';
import {disconnectRedis} from './config/redis';
import {prisma} from './prisma/client';
import {acceptanceTimerJob} from './services/acceptanceTimerJob';
import {requestLifecycleJob} from './services/requestLifecycleJob';
import {seedAdmins} from './utils/seedAdmins';
import {runStartupChecks, logStartupSummary} from './utils/startupChecks';

const REQUEST_LIFECYCLE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const ACCEPTANCE_TIMER_SWEEP_INTERVAL_MS = 30 * 1000;

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

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down gracefully.`);
    clearInterval(lifecycleInterval);
    clearInterval(acceptanceTimerInterval);
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
