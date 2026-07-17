import dotenv from 'dotenv';
import {z} from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters.'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  // Session management (PRD §5.1.1 "JWT tokens (24-hour expiry; refresh token 30-day expiry)",
  // §11 "Security — Auth"). Applies to user access tokens (both phone-OTP and email flows —
  // "Proper JWT Expiry" is a platform-wide auth requirement, not phone-only); `JWT_EXPIRES_IN`
  // above is left untouched and still governs the separate Admin token (signAdminToken).
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('24h'),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),
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
  // Phone OTP auth (PRD §5.1.1, §5.1.2) — deliberately separate from the email registration OTP
  // settings above; PRD §5.1.2 specifies 60-second expiry / 3 attempts / 5-minute lockout for
  // phone OTP specifically.
  PHONE_OTP_EXPIRES_SECONDS: z.coerce.number().int().positive().default(60),
  PHONE_OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  PHONE_OTP_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(5),
  PHONE_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),
  // SMS gateway (PRD §12.2 "SMS/OTP Gateway (e.g. MSG91, Twilio)"). Optional in dev — falls
  // back to console-logged OTPs.
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  // Temporary dev/test convenience (not in PRD/TRD): forces every phone OTP to a fixed
  // '123456' and skips the real MSG91 SMS send entirely, so signup/login work with zero SMS
  // gateway credentials during development. Hard-disabled outside development below regardless
  // of this flag's value — comment out/remove MOCK_OTP from .env once MSG91 keys are set and
  // real OTPs resume automatically.
  MOCK_OTP: z
    .string()
    .optional()
    .transform(v => v === 'true')
    .default(false),
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
  // v2.1 Beta Credits/Connects economy (PRD_TRD_SUMMARY.md §1, §10 item 7, backend Phase 2 item
  // 4). Interim env-var gate for the Razorpay top-up/withdraw endpoints only — Phase 6 replaces
  // this with the full `platform_settings`-backed Feature Flags surface. Defaults to `false`
  // (Beta Mode is the v2.1 default launch mode); set to `true` to reach Public Launch behavior.
  // Deliberately does NOT gate escrow/request creation, which remains INR-only/unconditional
  // until Phase 2 item 5 (currency-aware escrow) lands — see docs/CLAUDE.md §2.1.
  ENABLE_REAL_MONEY: z
    .string()
    .optional()
    .transform(v => v === 'true')
    .default(false),
});

// Production Configuration hardening (backend Phase 14): a handful of vars are optional in
// dev/test (silently degrading to a documented fallback — console-logged OTPs, disabled webhook
// reconciliation, disabled push) but must be explicitly set before this app is trusted with real
// traffic/money. Fails fast at boot rather than silently running production in a degraded mode.
const baseEnv = envSchema.parse(process.env);

if (baseEnv.NODE_ENV === 'production') {
  const missing: string[] = [];
  if (!baseEnv.BREVO_API_KEY || !baseEnv.BREVO_SENDER_EMAIL) missing.push('BREVO_API_KEY/BREVO_SENDER_EMAIL');
  if (!baseEnv.MSG91_AUTH_KEY || !baseEnv.MSG91_SENDER_ID) missing.push('MSG91_AUTH_KEY/MSG91_SENDER_ID');
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

export const env = {
  ...baseEnv,
  // Hard safety net: MOCK_OTP never activates outside development, even if the flag is left
  // set by mistake in a staging/production .env.
  MOCK_OTP_ENABLED: baseEnv.MOCK_OTP && baseEnv.NODE_ENV === 'development',
};
