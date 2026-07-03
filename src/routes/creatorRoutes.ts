import {Router} from 'express';

import {creatorController} from '../controllers/creatorController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {validate} from '../middlewares/validate';
import {updateCreatorLocationSchema, updateCreatorStatusSchema} from '../validations/creatorValidation';

export const creatorRoutes = Router();

creatorRoutes.patch(
  '/location',
  authenticate,
  validate({body: updateCreatorLocationSchema}),
  asyncHandler(creatorController.updateLocation),
);

creatorRoutes.patch(
  '/status',
  authenticate,
  validate({body: updateCreatorStatusSchema}),
  asyncHandler(creatorController.updateStatus),
);

creatorRoutes.get('/dashboard', authenticate, asyncHandler(creatorController.dashboard));
