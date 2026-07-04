import rateLimit from 'express-rate-limit';

/**
 * Stricter rate limit for auth/OTP endpoints (login, register, OTP request/verify,
 * forgot/reset-password) — backend Phase 14 security hardening. The app-wide limiter in
 * `app.ts` (100 req/15min per IP) is sized for normal API traffic; brute-force/OTP-spam attempts
 * concentrate on these few endpoints specifically, so they get a materially tighter budget on
 * top of (not instead of) the global limiter.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {success: false, message: 'Too many attempts. Please try again later.'},
});
