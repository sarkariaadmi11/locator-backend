import {Router} from 'express';

import {homeController} from '../controllers/homeController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';

export const homeRoutes = Router();

homeRoutes.get('/', authenticate, asyncHandler(homeController.index));
