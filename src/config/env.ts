import dotenv from 'dotenv';
import {z} from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters.'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  UPLOAD_DIR: z.string().default('uploads'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().optional(),
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  OTP_EXPIRES_MINUTES: z.coerce.number().int().positive().default(10),
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  ADMIN_NAME: z.string().default('Admin'),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
  // PRD §5.5 [REVIEW — suggested 15 min]. Configurable rather than hardcoded per
  // docs/CLAUDE.md §4/§11 "do not silently invent values for anything tagged [REVIEW]".
  ACCEPTANCE_TIMER_MINUTES: z.coerce.number().int().positive().default(15),
  // Compliance & Data Retention (PRD §9, backend Phase 13) — how often the retention sweep runs.
  // The retention *windows* themselves (chat/video/notification days, deletion grace period,
  // consent versions) are DB-configurable via `ComplianceConfig`, not env vars — see
  // `complianceConfigService` — so an Admin can adjust them without a redeploy.
  RETENTION_SWEEP_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
});

// Production Configuration hardening (backend Phase 14): a handful of vars are optional in
// dev/test (silently degrading to a documented fallback — console-logged OTPs, disabled webhook
// reconciliation, disabled push) but must be explicitly set before this app is trusted with real
// traffic/money. Fails fast at boot rather than silently running production in a degraded mode.
const baseEnv = envSchema.parse(process.env);

if (baseEnv.NODE_ENV === 'production') {
  const missing: string[] = [];
  if (!baseEnv.BREVO_API_KEY || !baseEnv.BREVO_SENDER_EMAIL) missing.push('BREVO_API_KEY/BREVO_SENDER_EMAIL');
  if (!baseEnv.RAZORPAY_WEBHOOK_SECRET) missing.push('RAZORPAY_WEBHOOK_SECRET');
  if (!baseEnv.FIREBASE_SERVICE_ACCOUNT_PATH) missing.push('FIREBASE_SERVICE_ACCOUNT_PATH');
  if (baseEnv.CORS_ORIGIN === '*') missing.push('CORS_ORIGIN (must not be "*" in production)');
  if (baseEnv.ADMIN_PASSWORD === 'change-me-please') missing.push('ADMIN_PASSWORD (still the .env.example default)');

  if (missing.length > 0) {
    throw new Error(
      `Refusing to start in production with missing/unsafe configuration: ${missing.join(', ')}. ` +
        'These are optional in development (documented fallbacks apply) but required once NODE_ENV=production.',
    );
  }
}

export const env = baseEnv;
