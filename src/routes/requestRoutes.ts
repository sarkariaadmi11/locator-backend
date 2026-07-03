import {Router} from 'express';

import {requestController} from '../controllers/requestController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {validate} from '../middlewares/validate';
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
