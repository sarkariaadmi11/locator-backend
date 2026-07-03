import jwt, {SignOptions} from 'jsonwebtoken';

import {env} from '../config/env';

export const signToken = (userId: string) =>
  jwt.sign({sub: userId}, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });

export const signAdminToken = (adminId: string) =>
  jwt.sign({sub: adminId, role: 'admin'}, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });

export const verifyToken = (token: string) =>
  jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & {sub: string; role?: string};

export const signResetToken = (email: string) =>
  jwt.sign({sub: email, purpose: 'password_reset'}, env.JWT_SECRET, {expiresIn: '15m'});

export const verifyResetToken = (token: string) => {
  const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & {
    sub: string;
    purpose: string;
  };
  if (payload.purpose !== 'password_reset') {
    throw new Error('Invalid token purpose');
  }
  return payload;
};
