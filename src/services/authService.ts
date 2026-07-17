import bcrypt from 'bcrypt';
import crypto from 'crypto';

import {env} from '../config/env';
import {phoneOtpRepository} from '../repositories/phoneOtpRepository';
import {refreshTokenRepository} from '../repositories/refreshTokenRepository';
import {registrationOtpRepository} from '../repositories/registrationOtpRepository';
import {userRepository} from '../repositories/userRepository';
import {ledgerService} from './ledgerService';
import {mailService} from './mailService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {smsService} from './smsService';
import {HttpError} from '../utils/httpError';
import {generateRefreshToken, hashRefreshToken, refreshTokenExpiry, signToken} from '../utils/jwt';
import {normalizePhone} from '../utils/phone';
import {presentUser} from '../utils/userPresenter';
import {logger} from '../config/logger';

type RegisterInput = {
  name: string;
  username: string;
  email: string;
  password: string;
};

type LoginInput = {
  email: string;
  password: string;
};

type VerifyRegistrationOtpInput = RegisterInput & {
  otp: string;
};

const OTP_MAX_ATTEMPTS = 5;

const SUSPENDED_MESSAGE = 'Your account has been suspended. Contact support at support@locatorapp.in';

const assertRegistrationAvailable = async (input: Pick<RegisterInput, 'email' | 'username'>) => {
  const [emailUser, usernameUser] = await Promise.all([
    userRepository.findByEmail(input.email),
    userRepository.findByUsername(input.username),
  ]);

  if (emailUser) {
    throw new HttpError(409, 'Email is already registered.');
  }

  if (usernameUser) {
    throw new HttpError(409, 'Username is already taken.');
  }
};

const createOtp = () => crypto.randomInt(100000, 1000000).toString();

// Dev-only mock OTP (temporary, MOCK_OTP=true in .env) — lets phone signup/login be exercised
// without real MSG91 credentials. Fixed code so testers don't need to read server logs. Gated
// by env.MOCK_OTP_ENABLED, which is hard-disabled outside development in config/env.ts — remove
// (or comment out) MOCK_OTP once real MSG91 keys are configured; real OTPs resume automatically.
const MOCK_OTP_CODE = '123456';

/**
 * Session issuance shared by every auth flow (email register/login, phone register/login,
 * password reset completion) — PRD §5.1.1 "Session management via JWT tokens (24-hour expiry;
 * refresh token 30-day expiry)". Each call mints a brand-new refresh token family; rotation
 * (see `refresh` below) stays within that family so a reuse-detected breach only ever revokes
 * the sessions descended from the token that was replayed.
 */
const issueSession = async (userId: string) => {
  const accessToken = signToken(userId);
  const refreshToken = generateRefreshToken();
  const familyId = crypto.randomUUID();

  await refreshTokenRepository.create({
    userId,
    tokenHash: hashRefreshToken(refreshToken),
    familyId,
    expiresAt: refreshTokenExpiry(),
  });

  return {token: accessToken, refreshToken};
};

/** Generates a syntactically-valid, collision-checked placeholder username for phone signups. */
const generatePlaceholderUsername = async (): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `user${crypto.randomInt(10_000_000, 99_999_999)}`;
    const existing = await userRepository.findByUsername(candidate);
    if (!existing) return candidate;
  }
  throw new HttpError(500, 'Could not generate a unique username. Please try again.');
};

export const authService = {
  // Email + password registration — PRD §4.1 "First-Time Registration: Phone/Email input → OTP"
  // (the canonical registration flow, explicitly flagged as such in the spec summary) requires
  // OTP verification for either input channel, not just phone. `register` issues the OTP;
  // `verifyRegistrationOtp` below completes account creation once it's confirmed.
  async register(input: RegisterInput) {
    logger.debug(`[authService.register] checking availability email=${input.email} username=${input.username}`);
    await assertRegistrationAvailable(input);

    const otp = createOtp();
    const [passwordHash, otpHash] = await Promise.all([
      bcrypt.hash(input.password, 12),
      bcrypt.hash(otp, 10),
    ]);

    logger.debug(`[authService.register] clearing prior pending OTPs email=${input.email}`);
    await registrationOtpRepository.deletePendingForEmail(input.email);

    logger.debug(`[authService.register] creating registrationOtp record email=${input.email}`);
    await registrationOtpRepository.create({
      email: input.email,
      expiresAt: new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60 * 1000),
      name: input.name,
      otpHash,
      passwordHash,
      username: input.username,
    });

    logger.debug(`[authService.register] dispatching OTP email email=${input.email}`);
    await mailService.sendRegistrationOtp(input.email, otp);

    return {
      email: input.email,
      expiresInMinutes: env.OTP_EXPIRES_MINUTES,
    };
  },

  async verifyRegistrationOtp(input: VerifyRegistrationOtpInput) {
    await assertRegistrationAvailable(input);

    const pendingRegistration = await registrationOtpRepository.findLatestByEmail(input.email);

    if (!pendingRegistration) {
      throw new HttpError(404, 'Verification code not found. Please sign up again.');
    }

    if (pendingRegistration.expiresAt.getTime() < Date.now()) {
      await registrationOtpRepository.delete(pendingRegistration.id);
      throw new HttpError(410, 'Verification code expired. Please request a new code.');
    }

    if (pendingRegistration.attempts >= OTP_MAX_ATTEMPTS) {
      await registrationOtpRepository.delete(pendingRegistration.id);
      throw new HttpError(429, 'Too many incorrect attempts. Please request a new code.');
    }

    const sameRegistration =
      pendingRegistration.name === input.name &&
      pendingRegistration.username === input.username &&
      (await bcrypt.compare(input.password, pendingRegistration.passwordHash));

    if (!sameRegistration) {
      throw new HttpError(400, 'Signup details changed. Please sign up again.');
    }

    const validOtp = await bcrypt.compare(input.otp, pendingRegistration.otpHash);
    if (!validOtp) {
      await registrationOtpRepository.incrementAttempts(pendingRegistration.id);
      throw new HttpError(400, 'Invalid verification code.');
    }

    const user = await userRepository.create({
      email: input.email,
      name: input.name,
      password: pendingRegistration.passwordHash,
      username: input.username,
    });
    await registrationOtpRepository.delete(pendingRegistration.id);

    // v2.1 Signup Bonus (PRD §7.2, backend Phase 2) — 300 Credits + 30 Connects, every account,
    // both auth paths. Idempotency-keyed per-user in ledgerService so this can never double-grant.
    await ledgerService.grantSignupBonus(user.id);

    // Signup-completion + welcome notifications (backend Phase 12, PRD §8.1 "Authentication").
    // Both fire together at account-creation time — there's no separate "first login" event to
    // distinguish them from in this codebase, so this is the interim decision (flagged, not a
    // PRD-specified distinct trigger).
    await notificationService.notifyUser(
      user.id,
      NotificationType.SIGNUP_SUCCESSFUL,
      'Signup successful',
      'Your Locator account has been created.',
    );
    await notificationService.notifyUser(
      user.id,
      NotificationType.WELCOME,
      `Welcome to Locator, ${user.name}!`,
      'Browse nearby requests as a Creator, or post your first paid video request as a Requester.',
    );

    const session = await issueSession(user.id);
    return {
      user: presentUser(user),
      ...session,
    };
  },

  async login(input: LoginInput) {
    const user = await userRepository.findByEmail(input.email);

    if (!user) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    if (!user.isActive) {
      throw new HttpError(403, SUSPENDED_MESSAGE);
    }

    const validPassword = await bcrypt.compare(input.password, user.password);
    if (!validPassword) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    const session = await issueSession(user.id);
    return {
      user: presentUser(user),
      ...session,
    };
  },

  // --- Phone OTP Registration & Login (PRD §5.1.1 "OTP-based phone login (primary)", §5.1.2,
  // §10.1) -------------------------------------------------------------------------------------

  async requestPhoneRegistrationOtp(rawPhone: string) {
    const phone = normalizePhone(rawPhone);

    const existingUser = await userRepository.findByPhone(phone);
    if (existingUser) {
      throw new HttpError(409, 'This phone number is already registered. Please log in instead.');
    }

    return this.dispatchPhoneOtp(phone, 'REGISTER');
  },

  async requestPhoneLoginOtp(rawPhone: string) {
    const phone = normalizePhone(rawPhone);

    const user = await userRepository.findByPhone(phone);
    if (!user) {
      throw new HttpError(404, 'No account found with this phone number. Please sign up instead.');
    }
    if (!user.isActive) {
      throw new HttpError(403, SUSPENDED_MESSAGE);
    }

    return this.dispatchPhoneOtp(phone, 'LOGIN');
  },

  /** Shared OTP issuance for both phone purposes — resend cooldown, hashing, and SMS dispatch. */
  async dispatchPhoneOtp(phone: string, purpose: 'REGISTER' | 'LOGIN') {
    const existing = await phoneOtpRepository.findByPhone(phone);
    if (existing) {
      const cooldownMs = env.PHONE_OTP_RESEND_COOLDOWN_SECONDS * 1000;
      const elapsedMs = Date.now() - existing.lastSentAt.getTime();
      if (elapsedMs < cooldownMs) {
        const waitSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
        throw new HttpError(429, `Please wait ${waitSeconds} seconds before requesting another OTP.`);
      }
    }

    const otp = env.MOCK_OTP_ENABLED ? MOCK_OTP_CODE : createOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + env.PHONE_OTP_EXPIRES_SECONDS * 1000);

    await phoneOtpRepository.upsertForPhone(phone, {
      purpose,
      otpHash,
      expiresAt,
      lastSentAt: new Date(),
    });

    if (env.MOCK_OTP_ENABLED) {
      logger.info(`[MOCK_OTP] Phone OTP for ${phone}: ${MOCK_OTP_CODE} (no SMS sent — MOCK_OTP=true)`);
    } else {
      await smsService.sendPhoneOtp(phone, otp, env.PHONE_OTP_EXPIRES_SECONDS);
    }

    return {phone, expiresInSeconds: env.PHONE_OTP_EXPIRES_SECONDS};
  },

  /** Shared verification: expiry, lockout, attempt-counting, and remaining-attempts messaging. */
  async verifyPhoneOtpCode(rawPhone: string, otp: string, purpose: 'REGISTER' | 'LOGIN') {
    const phone = normalizePhone(rawPhone);
    const pending = await phoneOtpRepository.findByPhone(phone);

    if (!pending || pending.purpose !== purpose) {
      throw new HttpError(404, 'Verification code not found. Please request a new one.');
    }

    if (pending.lockedUntil && pending.lockedUntil.getTime() > Date.now()) {
      throw new HttpError(429, 'Too many failed attempts. Please wait 5 minutes before trying again.');
    }

    if (pending.expiresAt.getTime() < Date.now()) {
      await phoneOtpRepository.delete(phone);
      throw new HttpError(410, 'OTP has expired. Please request a new one.');
    }

    const validOtp = await bcrypt.compare(otp, pending.otpHash);
    if (!validOtp) {
      const updated = await phoneOtpRepository.incrementAttempts(pending.id);

      if (updated.attempts >= env.PHONE_OTP_MAX_ATTEMPTS) {
        await phoneOtpRepository.lock(
          pending.id,
          new Date(Date.now() + env.PHONE_OTP_LOCKOUT_MINUTES * 60 * 1000),
        );
        throw new HttpError(429, 'Too many failed attempts. Please wait 5 minutes before trying again.');
      }

      const remaining = env.PHONE_OTP_MAX_ATTEMPTS - updated.attempts;
      throw new HttpError(400, `Incorrect OTP. Please try again. You have ${remaining} attempt(s) remaining.`);
    }

    await phoneOtpRepository.delete(phone);
    return phone;
  },

  async verifyPhoneRegistrationOtp(rawPhone: string, otp: string) {
    const phone = await this.verifyPhoneOtpCode(rawPhone, otp, 'REGISTER');

    const alreadyRegistered = await userRepository.findByPhone(phone);
    if (alreadyRegistered) {
      throw new HttpError(409, 'This phone number is already registered. Please log in instead.');
    }

    const username = await generatePlaceholderUsername();
    // Phone-only accounts have no email at signup — `User.email` stays required/unique across
    // the schema (every other service, admin panel, and notification path assumes a non-null
    // email), so a synthetic placeholder is generated here, mirroring the same pattern already
    // used by `userRepository.anonymize` for deleted accounts. Mobile routes the user straight
    // to Profile Setup after this (name/username both blank/placeholder — see
    // RootNavigator's `needsProfile` gate) where a real email can be added later if desired.
    const email = `phone-${phone.replace('+', '')}@phone.locator.app`;
    const randomPassword = crypto.randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, 12);

    const user = await userRepository.create({
      name: '',
      username,
      email,
      password: passwordHash,
      phone,
      phoneVerifiedAt: new Date(),
    });

    // v2.1 Signup Bonus (PRD §7.2, backend Phase 2) — same grant as the email path above.
    await ledgerService.grantSignupBonus(user.id);

    await notificationService.notifyUser(
      user.id,
      NotificationType.SIGNUP_SUCCESSFUL,
      'Signup successful',
      'Your Locator account has been created.',
    );
    await notificationService.notifyUser(
      user.id,
      NotificationType.WELCOME,
      'Welcome to Locator!',
      'Browse nearby requests as a Creator, or post your first paid video request as a Requester.',
    );

    const session = await issueSession(user.id);
    return {
      user: presentUser(user),
      isNewUser: true,
      ...session,
    };
  },

  async verifyPhoneLoginOtp(rawPhone: string, otp: string) {
    const phone = await this.verifyPhoneOtpCode(rawPhone, otp, 'LOGIN');

    const user = await userRepository.findByPhone(phone);
    if (!user) {
      throw new HttpError(404, 'No account found with this phone number. Please sign up instead.');
    }
    if (!user.isActive) {
      throw new HttpError(403, SUSPENDED_MESSAGE);
    }

    const session = await issueSession(user.id);
    return {
      user: presentUser(user),
      isNewUser: false,
      ...session,
    };
  },

  // --- Refresh Token Rotation & Session Restore (PRD §5.1.1, §11) ---------------------------

  async refresh(rawRefreshToken: string) {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const record = await refreshTokenRepository.findByHash(tokenHash);

    if (!record) {
      throw new HttpError(401, 'Your session has expired. Please log in again.');
    }

    if (record.revokedAt) {
      // Reuse of an already-rotated/revoked refresh token — signals theft/replay. Revoke the
      // entire token family so every descendant session is invalidated, not just this one.
      await refreshTokenRepository.revokeFamily(record.familyId);
      throw new HttpError(401, 'Your session has expired. Please log in again.');
    }

    if (record.expiresAt.getTime() < Date.now()) {
      throw new HttpError(401, 'Your session has expired. Please log in again.');
    }

    const user = await userRepository.findById(record.userId);
    if (!user || !user.isActive) {
      throw new HttpError(401, 'Your session has expired. Please log in again.');
    }

    const newRefreshToken = generateRefreshToken();
    const newTokenHash = hashRefreshToken(newRefreshToken);

    await refreshTokenRepository.create({
      userId: user.id,
      tokenHash: newTokenHash,
      familyId: record.familyId,
      expiresAt: refreshTokenExpiry(),
    });
    await refreshTokenRepository.markRotated(record.id, newTokenHash);

    return {
      user: presentUser(user),
      token: signToken(user.id),
      refreshToken: newRefreshToken,
    };
  },

  async logout(rawRefreshToken: string) {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const record = await refreshTokenRepository.findByHash(tokenHash);
    if (record && !record.revokedAt) {
      await refreshTokenRepository.revoke(record.id);
    }
  },

};
