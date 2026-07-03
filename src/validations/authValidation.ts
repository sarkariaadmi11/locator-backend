import {z} from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

export const verifyRegistrationOtpSchema = registerSchema.extend({
  otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6 digit code.'),
});

export const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(128),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
});

export const verifyPasswordResetOtpSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6-digit code.'),
});

export const resetPasswordSchema = z.object({
  resetToken: z.string().min(1),
  password: z.string().min(8).max(128),
});
