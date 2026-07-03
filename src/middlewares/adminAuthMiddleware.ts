import {NextFunction, Request, Response} from 'express';

import {adminRepository} from '../repositories/adminRepository';
import {HttpError} from '../utils/httpError';
import {verifyToken} from '../utils/jwt';

export type AdminRequest = Request & {
  admin?: Awaited<ReturnType<typeof adminRepository.findById>>;
};

export const authenticateAdmin = async (
  req: AdminRequest,
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

    if (payload.role !== 'admin') {
      throw new HttpError(403, 'Admin access required.');
    }

    const admin = await adminRepository.findById(payload.sub);
    if (!admin) {
      throw new HttpError(401, 'Admin not found.');
    }

    req.admin = admin;
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'Invalid token.'));
  }
};
