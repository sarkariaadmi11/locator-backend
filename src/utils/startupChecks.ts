import {getApps} from 'firebase-admin/app';

import {cloudinary} from '../config/cloudinary';
import {env} from '../config/env';
import {ensureFirebaseInitialized} from '../config/firebase';
import {logger} from '../config/logger';
import {prisma} from '../prisma/client';
import {checkRedisConnectivity} from '../config/redis';
import {checkBrevoConnectivity} from '../services/mailService';

type CheckResult = {ok: boolean; reason?: string};

export type StartupCheckResults = {
  environment: CheckResult;
  database: CheckResult;
  redis: CheckResult;
  firebase: CheckResult;
  cloudinary: CheckResult;
  brevo: CheckResult;
  razorpayWebhook: CheckResult;
};

async function checkDatabase(): Promise<CheckResult> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {ok: true};
  } catch (err) {
    return {ok: false, reason: (err as Error).message};
  }
}

function checkFirebase(): CheckResult {
  ensureFirebaseInitialized();
  if (getApps().length > 0) {
    return {ok: true};
  }
  return {
    ok: false,
    reason: env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? 'Firebase Admin failed to initialize — check FIREBASE_SERVICE_ACCOUNT_PATH.'
      : 'FIREBASE_SERVICE_ACCOUNT_PATH not set — push notifications disabled.',
  };
}

async function checkCloudinary(): Promise<CheckResult> {
  try {
    await cloudinary.api.ping();
    return {ok: true};
  } catch (err) {
    return {ok: false, reason: (err as Error).message};
  }
}

async function checkBrevo(): Promise<CheckResult> {
  const result = await checkBrevoConnectivity();
  return result.ok ? {ok: true} : {ok: false, reason: result.reason};
}

function checkEnvironment(): CheckResult {
  // env.ts already zod-validates process.env at import time (throws on invalid config
  // before this ever runs), so reaching this point means the environment is valid.
  return {ok: true};
}

function checkRazorpayWebhook(): CheckResult {
  if (env.RAZORPAY_WEBHOOK_SECRET) return {ok: true};
  return {
    ok: false,
    reason: 'RAZORPAY_WEBHOOK_SECRET not set — payment webhook reconciliation disabled.',
  };
}

export async function runStartupChecks(): Promise<StartupCheckResults> {
  const [database, redisResult, cloudinaryResult, brevo] = await Promise.all([
    checkDatabase(),
    checkRedisConnectivity(),
    checkCloudinary(),
    checkBrevo(),
  ]);

  return {
    environment: checkEnvironment(),
    database,
    redis: redisResult,
    firebase: checkFirebase(),
    cloudinary: cloudinaryResult,
    brevo,
    razorpayWebhook: checkRazorpayWebhook(),
  };
}

function line(label: string, result: CheckResult): string {
  if (result.ok) {
    return `✓ ${label}`;
  }
  return `⚠ ${label} — ${result.reason ?? 'unknown reason'}`;
}

export function logStartupSummary(checks: StartupCheckResults, port: number): void {
  const summary = [
    line('Environment Valid', checks.environment),
    line('Database Connected', checks.database),
    line('Prisma Ready', checks.database),
    line('Redis Connected', checks.redis),
    line('Firebase Ready', checks.firebase),
    line('Cloudinary Ready', checks.cloudinary),
    line('Brevo Configured', checks.brevo),
    line('Razorpay Webhook Configured', checks.razorpayWebhook),
    `✓ Server Listening on port ${port}`,
  ].join('\n');

  logger.info(`Locator API startup summary:\n${summary}`);
}
