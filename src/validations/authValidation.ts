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

// Phone OTP auth (PRD §5.1.1, §5.1.2). Loose regex here — `utils/phone.ts#normalizePhone` does
// the authoritative validation/normalization inside the service; this just rejects obviously
// malformed input before it reaches the DB layer.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?91)?[6-9]\d{9}$/, 'Please enter a valid 10-digit Indian mobile number.');

export const requestPhoneOtpSchema = z.object({
  phone: phoneSchema,
});

export const verifyPhoneOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6 digit code.'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required.'),
});
