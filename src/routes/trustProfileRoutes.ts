import {Router} from 'express';

import {trustProfileController} from '../controllers/trustProfileController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {validate} from '../middlewares/validate';
import {trustProfileUserIdParamsSchema} from '../validations/trustProfileValidation';

export const trustProfileRoutes = Router();

trustProfileRoutes.get('/me', authenticate, asyncHandler(trustProfileController.me));

trustProfileRoutes.get(
  '/:userId',
  authenticate,
  validate({params: trustProfileUserIdParamsSchema}),
  asyncHandler(trustProfileController.byUserId),
);
