import bcrypt from 'bcrypt';
import crypto from 'crypto';

import {env} from '../config/env';
import {passwordResetOtpRepository} from '../repositories/passwordResetOtpRepository';
import {registrationOtpRepository} from '../repositories/registrationOtpRepository';
import {userRepository} from '../repositories/userRepository';
import {mailService} from './mailService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {HttpError} from '../utils/httpError';
import {signResetToken, signToken, verifyResetToken} from '../utils/jwt';
import {presentUser} from '../utils/userPresenter';
import { logger } from '../config/logger';

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

export const authService = {
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
    mailService.sendWelcomeEmail(user.email, user.name).catch(() => {});

    return {
      user: presentUser(user),
      token: signToken(user.id),
    };
  },

  async login(input: LoginInput) {
    const user = await userRepository.findByEmail(input.email);

    if (!user || !user.isActive) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    const validPassword = await bcrypt.compare(input.password, user.password);
    if (!validPassword) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    return {
      user: presentUser(user),
      token: signToken(user.id),
    };
  },

  async requestPasswordReset(email: string) {
    const user = await userRepository.findByEmail(email);
    if (!user || !user.isActive) {
      throw new HttpError(404, 'No account found with this email address.');
    }

    const otp = createOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    await passwordResetOtpRepository.deletePendingForEmail(email);
    await passwordResetOtpRepository.create({
      email,
      otpHash,
      expiresAt: new Date(Date.now() + env.OTP_EXPIRES_MINUTES * 60 * 1000),
    });

    await mailService.sendPasswordResetOtp(email, otp);

    return {email, expiresInMinutes: env.OTP_EXPIRES_MINUTES};
  },

  async verifyPasswordResetOtp(input: {email: string; otp: string}) {
    const pending = await passwordResetOtpRepository.findLatestByEmail(input.email);

    if (!pending) {
      throw new HttpError(404, 'No password reset request found. Please try again.');
    }

    if (pending.expiresAt.getTime() < Date.now()) {
      await passwordResetOtpRepository.delete(pending.id);
      throw new HttpError(410, 'Code expired. Please request a new one.');
    }

    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      await passwordResetOtpRepository.delete(pending.id);
      throw new HttpError(429, 'Too many incorrect attempts. Please request a new code.');
    }

    const validOtp = await bcrypt.compare(input.otp, pending.otpHash);
    if (!validOtp) {
      await passwordResetOtpRepository.incrementAttempts(pending.id);
      throw new HttpError(400, 'Invalid verification code.');
    }

    await passwordResetOtpRepository.delete(pending.id);
    return {resetToken: signResetToken(input.email)};
  },

  async resetPassword(input: {resetToken: string; password: string}) {
    let email: string;
    try {
      const payload = verifyResetToken(input.resetToken);
      email = payload.sub;
    } catch {
      throw new HttpError(401, 'Invalid or expired reset token. Please start over.');
    }

    const user = await userRepository.findByEmail(email);
    if (!user) {
      throw new HttpError(404, 'Account not found.');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    await userRepository.updatePassword(user.id, passwordHash);
    logger.info(`Password reset for user ${user.id}`);

    await notificationService.notifyUser(
      user.id,
      NotificationType.PASSWORD_RESET_CONFIRMATION,
      'Password reset confirmation',
      'Your Locator password was changed successfully.',
    );
    mailService.sendPasswordResetConfirmation(user.email).catch(() => {});
  },
};
