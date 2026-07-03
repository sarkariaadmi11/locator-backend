import {NextFunction, Request, Response} from 'express';
import {Prisma} from '@prisma/client';

import {logger} from '../config/logger';
import {HttpError} from '../utils/httpError';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      details: err.details,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return res.status(409).json({
      success: false,
      message: 'A record with this unique value already exists.',
    });
  }

  logger.error(err.message, {stack: err.stack});

  return res.status(500).json({
    success: false,
    message: 'Internal server error.',
  });
};
