import {NextFunction, Response} from 'express';
import {AdminRole} from '@prisma/client';

import {AdminRequest} from './adminAuthMiddleware';
import {HttpError} from '../utils/httpError';

// RBAC (PRD §5.13, TRD §5.4/§14) — Moderator vs Admin capability gate, layered on top of
// `authenticateAdmin` (which only proves "this is some Admin/Moderator JWT"). Mirrors the
// frontend's `RequireRole` route guard one-to-one so client and server never diverge on which
// role can reach which surface.
export const requireRole = (...roles: AdminRole[]) => {
  return (req: AdminRequest, _res: Response, next: NextFunction) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return next(new HttpError(403, 'You do not have permission to perform this action.'));
    }
    next();
  };
};
