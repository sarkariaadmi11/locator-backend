import {NextFunction, Request, Response} from 'express';

import {userRepository} from '../repositories/userRepository';
import {HttpError} from '../utils/httpError';
import {verifyToken} from '../utils/jwt';

export type AuthenticatedRequest = Request & {
  user?: Awaited<ReturnType<typeof userRepository.findById>>;
};

export const authenticate = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      throw new HttpError(401, 'Authentication token is required.');
    }

    const payload = verifyToken(token);
    const user = await userRepository.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new HttpError(401, 'Invalid or inactive user.');
    }

    req.user = user;
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'Invalid token.'));
  }
};
