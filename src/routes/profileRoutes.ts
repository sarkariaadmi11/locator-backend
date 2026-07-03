import {Router} from 'express';

import {profileController} from '../controllers/profileController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {imageUpload} from '../middlewares/upload';
import {validate} from '../middlewares/validate';
import {updateProfileSchema} from '../validations/profileValidation';

export const profileRoutes = Router();

profileRoutes.use(authenticate);
profileRoutes.put(
  '/update',
  validate({body: updateProfileSchema}),
  asyncHandler(profileController.update),
);
profileRoutes.post(
  '/upload-image',
  imageUpload.single('image'),
  asyncHandler(profileController.uploadImage),
);
