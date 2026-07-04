import {Router} from 'express';

import {privacyController} from '../controllers/privacyController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';

/** Privacy Settings hub (backend Phase 13). */
export const privacyRoutes = Router();

privacyRoutes.get('/settings', authenticate, asyncHandler(privacyController.getSettings));
