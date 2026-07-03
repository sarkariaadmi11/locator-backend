import {Router} from 'express';

import {adminController} from '../controllers/adminController';
import {adminRestrictedLocationController} from '../controllers/adminRestrictedLocationController';
import {authenticateAdmin} from '../middlewares/adminAuthMiddleware';
import {asyncHandler} from '../middlewares/asyncHandler';
import {validate} from '../middlewares/validate';
import {
  createRestrictedLocationSchema,
  restrictedLocationIdParamsSchema,
  restrictedLocationListQuerySchema,
  updateRestrictedLocationSchema,
} from '../validations/restrictedLocationValidation';

export const adminRoutes = Router();

// Auth — no admin middleware
adminRoutes.post('/auth/login', asyncHandler(adminController.login));
adminRoutes.get('/auth/me', authenticateAdmin, asyncHandler(adminController.me));

// Dashboard
adminRoutes.get('/dashboard', authenticateAdmin, asyncHandler(adminController.getDashboard));

// Users
adminRoutes.get('/users', authenticateAdmin, asyncHandler(adminController.listUsers));
adminRoutes.patch('/users/:id/block', authenticateAdmin, asyncHandler(adminController.toggleBlock));
adminRoutes.patch('/users/:id/suspicious', authenticateAdmin, asyncHandler(adminController.toggleSuspicious));

// Transactions
adminRoutes.get('/transactions', authenticateAdmin, asyncHandler(adminController.listTransactions));
adminRoutes.get('/transactions/export', authenticateAdmin, asyncHandler(adminController.exportTransactions));
adminRoutes.post(
  '/transactions/reconcile-pending',
  authenticateAdmin,
  asyncHandler(adminController.reconcilePendingTransactions),
);

// Payouts
adminRoutes.get('/payouts', authenticateAdmin, asyncHandler(adminController.listPayouts));
adminRoutes.patch('/payouts/:id/process', authenticateAdmin, asyncHandler(adminController.processPayout));

// Notifications
adminRoutes.post('/notifications/token', authenticateAdmin, asyncHandler(adminController.registerFcmToken));

// Restricted Locations (manual-list fallback for the Restricted Location Engine, PRD §5.7.2)
adminRoutes.get(
  '/restricted-locations',
  authenticateAdmin,
  validate({query: restrictedLocationListQuerySchema}),
  asyncHandler(adminRestrictedLocationController.list),
);
adminRoutes.post(
  '/restricted-locations',
  authenticateAdmin,
  validate({body: createRestrictedLocationSchema}),
  asyncHandler(adminRestrictedLocationController.create),
);
adminRoutes.patch(
  '/restricted-locations/:id',
  authenticateAdmin,
  validate({params: restrictedLocationIdParamsSchema, body: updateRestrictedLocationSchema}),
  asyncHandler(adminRestrictedLocationController.update),
);
adminRoutes.delete(
  '/restricted-locations/:id',
  authenticateAdmin,
  validate({params: restrictedLocationIdParamsSchema}),
  asyncHandler(adminRestrictedLocationController.remove),
);
