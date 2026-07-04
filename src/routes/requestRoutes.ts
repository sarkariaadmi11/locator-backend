import {Router} from 'express';

import {recordingController} from '../controllers/recordingController';
import {ratingController} from '../controllers/ratingController';
import {requestController} from '../controllers/requestController';
import {requesterReviewController} from '../controllers/requesterReviewController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {validate} from '../middlewares/validate';
import {videoUpload} from '../middlewares/upload';
import {sendChatMessageSchema} from '../validations/chatValidation';
import {rateRequestSchema} from '../validations/ratingValidation';
import {
  completeVideoUploadSchema,
  requestVideoIdParamsSchema,
  startRecordingSchema,
} from '../validations/recordingValidation';
import {
  acceptVideoSchema,
  rejectRequestVideoSchema,
  requestReshootSchema,
} from '../validations/requesterReviewValidation';
import {
  acceptRequestSchema,
  availableRequestsQuerySchema,
  cancelRequestSchema,
  createRequestSchema,
  nearbyRequestsQuerySchema,
  requestDetailsQuerySchema,
  requestIdParamsSchema,
  requestListQuerySchema,
  updateRequestSchema,
} from '../validations/requestValidation';

export const requestRoutes = Router();

requestRoutes.post(
  '/',
  authenticate,
  validate({body: createRequestSchema}),
  asyncHandler(requestController.create),
);

requestRoutes.get(
  '/mine',
  authenticate,
  validate({query: requestListQuerySchema}),
  asyncHandler(requestController.listMine),
);

// Discovery routes (Creator side) — must be registered before `/:id` to avoid being
// captured as an `:id` path segment.
requestRoutes.get(
  '/nearby',
  authenticate,
  validate({query: nearbyRequestsQuerySchema}),
  asyncHandler(requestController.nearby),
);

requestRoutes.get(
  '/available',
  authenticate,
  validate({query: availableRequestsQuerySchema}),
  asyncHandler(requestController.available),
);

requestRoutes.get(
  '/:id/details',
  authenticate,
  validate({params: requestIdParamsSchema, query: requestDetailsQuerySchema}),
  asyncHandler(requestController.details),
);

requestRoutes.get(
  '/:id',
  authenticate,
  validate({params: requestIdParamsSchema}),
  asyncHandler(requestController.getById),
);

requestRoutes.patch(
  '/:id',
  authenticate,
  validate({params: requestIdParamsSchema, body: updateRequestSchema}),
  asyncHandler(requestController.update),
);

requestRoutes.post(
  '/:id/cancel',
  authenticate,
  validate({params: requestIdParamsSchema, body: cancelRequestSchema}),
  asyncHandler(requestController.cancel),
);

requestRoutes.post(
  '/:id/accept',
  authenticate,
  validate({params: requestIdParamsSchema, body: acceptRequestSchema}),
  asyncHandler(requestController.accept),
);

// Temporary Chat (PRD §5.4) — participants only, gated by the request's current status.
requestRoutes.get(
  '/:id/chat',
  authenticate,
  validate({params: requestIdParamsSchema}),
  asyncHandler(requestController.listChat),
);

requestRoutes.post(
  '/:id/chat',
  authenticate,
  validate({params: requestIdParamsSchema, body: sendChatMessageSchema}),
  asyncHandler(requestController.sendChat),
);

// Recording & Upload pipeline (PRD §5.6, §4.4) — Creator-only, gated by request status inside
// recordingService. Registered before the generic `/:id/video` reads no ordering conflict
// exists (all paths below are more specific than `/:id`).

requestRoutes.post(
  '/:id/recording/start',
  authenticate,
  validate({params: requestIdParamsSchema, body: startRecordingSchema}),
  asyncHandler(recordingController.start),
);

requestRoutes.post(
  '/:id/video/session',
  authenticate,
  validate({params: requestIdParamsSchema}),
  asyncHandler(recordingController.createSession),
);

requestRoutes.get(
  '/:id/video',
  authenticate,
  validate({params: requestIdParamsSchema}),
  asyncHandler(recordingController.getVideo),
);

requestRoutes.get(
  '/:id/video/history',
  authenticate,
  validate({params: requestIdParamsSchema}),
  asyncHandler(recordingController.getVideoHistory),
);

requestRoutes.post(
  '/:id/video/:videoId/complete',
  authenticate,
  videoUpload.single('video'),
  validate({params: requestVideoIdParamsSchema, body: completeVideoUploadSchema}),
  asyncHandler(recordingController.completeUpload),
);

requestRoutes.post(
  '/:id/video/:videoId/retry',
  authenticate,
  validate({params: requestVideoIdParamsSchema}),
  asyncHandler(recordingController.retryUpload),
);

requestRoutes.post(
  '/:id/video/:videoId/cancel',
  authenticate,
  validate({params: requestVideoIdParamsSchema}),
  asyncHandler(recordingController.cancelUpload),
);

requestRoutes.delete(
  '/:id/video/:videoId',
  authenticate,
  validate({params: requestVideoIdParamsSchema}),
  asyncHandler(recordingController.deleteDraft),
);

// Requester Review & Re-shoot (PRD §5.10, §4.6, backend Phase 7) — Requester-only, gated by
// request status inside requesterReviewService (REQUESTER_REVIEW only, single-shot per cycle).

requestRoutes.post(
  '/:id/accept-video',
  authenticate,
  validate({params: requestIdParamsSchema, body: acceptVideoSchema}),
  asyncHandler(requesterReviewController.acceptVideo),
);

requestRoutes.post(
  '/:id/request-reshoot',
  authenticate,
  validate({params: requestIdParamsSchema, body: requestReshootSchema}),
  asyncHandler(requesterReviewController.requestReshoot),
);

requestRoutes.post(
  '/:id/reject',
  authenticate,
  validate({params: requestIdParamsSchema, body: rejectRequestVideoSchema}),
  asyncHandler(requesterReviewController.reject),
);

// Escrow & Payment Release (PRD §7.1, §7.2, backend Phase 8) — Requester or the assigned
// Creator only (escrowService.getForParticipant enforces this).
requestRoutes.get(
  '/:id/escrow',
  authenticate,
  validate({params: requestIdParamsSchema}),
  asyncHandler(requestController.getEscrow),
);

// Mutual Ratings (PRD §5.12, §4.6, backend Phase 9) — participants only, only once COMPLETED,
// exactly once per participant (ratingService enforces both).
requestRoutes.post(
  '/:id/rate',
  authenticate,
  validate({params: requestIdParamsSchema, body: rateRequestSchema}),
  asyncHandler(ratingController.rate),
);

requestRoutes.get(
  '/:id/rating',
  authenticate,
  validate({params: requestIdParamsSchema}),
  asyncHandler(ratingController.getForRequest),
);
