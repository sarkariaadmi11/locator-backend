import {Router} from 'express';

import {accountController} from '../controllers/accountController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {validate} from '../middlewares/validate';
import {dataExportIdParamsSchema, dataExportListQuerySchema, deleteAccountRequestSchema} from '../validations/accountValidation';

/** Account Deletion & Data Export (PRD §9, backend Phase 13). */
export const accountRoutes = Router();

accountRoutes.post(
  '/delete-request',
  authenticate,
  validate({body: deleteAccountRequestSchema}),
  asyncHandler(accountController.requestDeletion),
);
accountRoutes.post('/delete-cancel', authenticate, asyncHandler(accountController.cancelDeletion));
accountRoutes.get('/delete-status', authenticate, asyncHandler(accountController.deletionStatus));

accountRoutes.post('/export', authenticate, asyncHandler(accountController.createExport));
accountRoutes.get(
  '/export',
  authenticate,
  validate({query: dataExportListQuerySchema}),
  asyncHandler(accountController.listExports),
);
accountRoutes.get(
  '/export/:id',
  authenticate,
  validate({params: dataExportIdParamsSchema}),
  asyncHandler(accountController.getExport),
);

accountRoutes.post('/welcome-video-ack', authenticate, asyncHandler(accountController.acknowledgeWelcomeVideo));
