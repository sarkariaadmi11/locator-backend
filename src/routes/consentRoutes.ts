import {Router} from 'express';

import {consentController} from '../controllers/consentController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {validate} from '../middlewares/validate';
import {acceptConsentSchema} from '../validations/consentValidation';

/** Consent capture (PRD §9.1, §5.7.3, backend Phase 13). */
export const consentRoutes = Router();

consentRoutes.post('/accept', authenticate, validate({body: acceptConsentSchema}), asyncHandler(consentController.accept));
consentRoutes.get('/status', authenticate, asyncHandler(consentController.status));
consentRoutes.get('/history', authenticate, asyncHandler(consentController.history));
