import {Router} from 'express';

import {disputeController} from '../controllers/disputeController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {disputeEvidenceUpload} from '../middlewares/upload';
import {validate} from '../middlewares/validate';
import {
  createDisputeSchema,
  disputeEvidenceCaptionSchema,
  disputeIdParamsSchema,
  disputeListQuerySchema,
  disputeMessageSchema,
} from '../validations/disputeValidation';

/** Dispute Center (PRD §5.14.2, backend Phase 11) — Requester/Creator-facing raise/track flow. */
export const disputeRoutes = Router();

disputeRoutes.post('/', authenticate, validate({body: createDisputeSchema}), asyncHandler(disputeController.create));

disputeRoutes.get('/mine', authenticate, validate({query: disputeListQuerySchema}), asyncHandler(disputeController.listMine));

disputeRoutes.get(
  '/:id',
  authenticate,
  validate({params: disputeIdParamsSchema}),
  asyncHandler(disputeController.detail),
);

disputeRoutes.post(
  '/:id/messages',
  authenticate,
  validate({params: disputeIdParamsSchema, body: disputeMessageSchema}),
  asyncHandler(disputeController.postMessage),
);

disputeRoutes.post(
  '/:id/evidence',
  authenticate,
  disputeEvidenceUpload.single('file'),
  validate({params: disputeIdParamsSchema, body: disputeEvidenceCaptionSchema}),
  asyncHandler(disputeController.submitEvidence),
);
