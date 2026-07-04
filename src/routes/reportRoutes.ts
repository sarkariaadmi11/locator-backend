import {Router} from 'express';

import {reportController} from '../controllers/reportController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {validate} from '../middlewares/validate';
import {createReportSchema} from '../validations/reportValidation';

/** Report/Abuse workflow (PRD §5.12, backend Phase 9). */
export const reportRoutes = Router();

reportRoutes.post('/', authenticate, validate({body: createReportSchema}), asyncHandler(reportController.create));
