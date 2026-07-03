import {Router} from 'express';

import {locationController} from '../controllers/locationController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {validate} from '../middlewares/validate';
import {classifyLocationQuerySchema} from '../validations/restrictedLocationValidation';
import {saveLocationSchema} from '../validations/locationValidation';

export const locationRoutes = Router();

locationRoutes.post(
  '/save',
  authenticate,
  validate({body: saveLocationSchema}),
  asyncHandler(locationController.save),
);

locationRoutes.get(
  '/classify',
  authenticate,
  validate({query: classifyLocationQuerySchema}),
  asyncHandler(locationController.classify),
);
