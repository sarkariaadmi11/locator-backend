import {NextFunction, Request, Response} from 'express';
import {ZodSchema} from 'zod';

import {HttpError} from '../utils/httpError';

type Schemas = {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
};

export const validate =
  (schemas: Schemas) => (req: Request, _res: Response, next: NextFunction) => {
    const errors: unknown[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        errors.push(result.error.flatten());
      } else {
        req.body = result.data;
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        errors.push(result.error.flatten());
      } else {
        req.params = result.data as Request['params'];
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        errors.push(result.error.flatten());
      } else {
        // Express 5 makes `req.query` a getter-only accessor, so it can't be reassigned
        // directly — redefine the property instead (same effect as `req.query = ...` in Express 4).
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
        });
      }
    }

    if (errors.length) {
      throw new HttpError(422, 'Validation failed.', errors);
    }

    next();
  };
