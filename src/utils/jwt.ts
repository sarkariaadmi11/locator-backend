import crypto from 'crypto';

import jwt, {SignOptions} from 'jsonwebtoken';

import {env} from '../config/env';

// Session management (PRD §5.1.1 "JWT tokens (24-hour expiry; refresh token 30-day expiry)").
// signToken issues the short-lived access token for user sessions (email + phone OTP flows
// alike); signAdminToken is intentionally untouched (separate Admin session, still governed by
// JWT_EXPIRES_IN).
export const signToken = (userId: string) =>
  jwt.sign({sub: userId}, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_EXPIRES_IN as SignOptions['expiresIn'],
  });

export const signAdminToken = (adminId: string) =>
  jwt.sign({sub: adminId, role: 'admin'}, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });

export const verifyToken = (token: string) =>
  jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & {sub: string; role?: string};

// Refresh Token Rotation (PRD §5.1.1, §11). Opaque high-entropy random tokens, not JWTs — only
// the SHA-256 hash is ever persisted (see RefreshToken model comment in schema.prisma), so a
// stolen `refreshTokens` table dump can't be used to mint sessions. SHA-256 (not bcrypt) because
// the raw token already has 256 bits of entropy and the store needs a deterministic hash for
// O(1) lookup by value, not a slow one-way KDF meant for low-entropy secrets like passwords.
export const generateRefreshToken = () => crypto.randomBytes(48).toString('hex');

export const hashRefreshToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

export const refreshTokenExpiry = () =>
  new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
