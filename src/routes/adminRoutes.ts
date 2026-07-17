import {Router} from 'express';

import {adminActiveRequestsQuerySchema} from '../validations/adminDashboardValidation';
import {adminAuditLogController} from '../controllers/adminAuditLogController';
import {adminComplianceController} from '../controllers/adminComplianceController';
import {adminController} from '../controllers/adminController';
import {adminDisputeController} from '../controllers/adminDisputeController';
import {adminEscrowController} from '../controllers/adminEscrowController';
import {adminModerationController} from '../controllers/adminModerationController';
import {adminReportController} from '../controllers/adminReportController';
import {adminRestrictedLocationController} from '../controllers/adminRestrictedLocationController';
import {adminNotificationTemplateController} from '../controllers/adminNotificationTemplateController';
import {adminSettingsController} from '../controllers/adminSettingsController';
import {adminTrustProfileController} from '../controllers/adminTrustProfileController';
import {AdminRole} from '@prisma/client';

import {authenticateAdmin} from '../middlewares/adminAuthMiddleware';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authRateLimit} from '../middlewares/authRateLimit';
import {requireRole} from '../middlewares/requireRole';
import {disputeEvidenceUpload} from '../middlewares/upload';
import {validate} from '../middlewares/validate';
import {
  adminDisputeAssignSchema,
  adminDisputeCloseSchema,
  adminDisputeListQuerySchema,
  adminDisputeMessageSchema,
  adminDisputeNoteSchema,
  adminDisputeReopenSchema,
  adminDisputeResolveSchema,
  adminEscalateDisputeSchema,
  disputeEvidenceCaptionSchema,
  disputeIdParamsSchema,
} from '../validations/disputeValidation';
import {
  adminEscrowListQuerySchema,
  adminEscrowOverrideSchema,
  escrowRequestIdParamsSchema,
} from '../validations/escrowValidation';
import {
  auditLogQuerySchema,
  approveVideoSchema,
  bulkRejectVideosSchema,
  bulkVideoIdsSchema,
  moderationHistoryQuerySchema,
  moderationQueueQuerySchema,
  moderationVideoIdParamsSchema,
  pendingRequestIdParamsSchema,
  pendingRequestsQuerySchema,
  rejectPendingRequestSchema,
  rejectVideoSchema,
} from '../validations/moderationValidation';
import {
  adminReportActionSchema,
  adminReportListQuerySchema,
  reportIdParamsSchema,
} from '../validations/reportValidation';
import {
  createRestrictedLocationSchema,
  restrictedLocationIdParamsSchema,
  restrictedLocationListQuerySchema,
  updateRestrictedLocationSchema,
} from '../validations/restrictedLocationValidation';
import {
  adminTrustProfileListQuerySchema,
  adminTrustProfileNoteSchema,
  trustProfileUserIdParamsSchema,
} from '../validations/trustProfileValidation';
import {
  complianceConfigKeyParamsSchema,
  complianceConfigUpdateSchema,
  deletionLogQuerySchema,
} from '../validations/accountValidation';
import {
  notificationTemplateTypeParamsSchema,
  upsertNotificationTemplateSchema,
} from '../validations/notificationTemplateValidation';
import {
  applyPresetSchema,
  presetNameParamsSchema,
  setModerationToggleSchema,
  setSettingSchema,
  settingsKeyParamsSchema,
} from '../validations/settingsValidation';
import {
  adminSuspendUserSchema,
  adminUserActionReasonSchema,
  adminWalletAdjustmentSchema,
} from '../validations/adminUserActionValidation';

export const adminRoutes = Router();

// Auth — no admin middleware
adminRoutes.post('/auth/login', authRateLimit, asyncHandler(adminController.login));
adminRoutes.get('/auth/me', authenticateAdmin, asyncHandler(adminController.me));

// Dashboard (PRD §5.14.1-§5.14.3, backend Phase 11)
adminRoutes.get('/dashboard', authenticateAdmin, asyncHandler(adminController.getDashboard));
adminRoutes.get('/dashboard/live-monitoring', authenticateAdmin, asyncHandler(adminController.getLiveMonitoring));
adminRoutes.get('/dashboard/live-monitoring/alerts', authenticateAdmin, asyncHandler(adminController.listAlerts));
adminRoutes.get(
  '/dashboard/active-requests',
  authenticateAdmin,
  validate({query: adminActiveRequestsQuerySchema}),
  asyncHandler(adminController.getActiveRequests),
);

// Users
adminRoutes.get('/users', authenticateAdmin, asyncHandler(adminController.listUsers));
adminRoutes.get('/users/:id', authenticateAdmin, asyncHandler(adminController.getUserDetail));
adminRoutes.patch(
  '/users/:id/wallet-adjustment',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({body: adminWalletAdjustmentSchema}),
  asyncHandler(adminController.adjustWallet),
);
adminRoutes.patch(
  '/users/:id/block',
  authenticateAdmin,
  validate({body: adminUserActionReasonSchema}),
  asyncHandler(adminController.toggleBlock),
);
adminRoutes.patch(
  '/users/:id/suspicious',
  authenticateAdmin,
  validate({body: adminUserActionReasonSchema}),
  asyncHandler(adminController.toggleSuspicious),
);

// Transactions
adminRoutes.get('/transactions', authenticateAdmin, asyncHandler(adminController.listTransactions));
adminRoutes.get('/transactions/export', authenticateAdmin, asyncHandler(adminController.exportTransactions));
adminRoutes.post(
  '/transactions/reconcile-pending',
  authenticateAdmin,
  asyncHandler(adminController.reconcilePendingTransactions),
);
// Ledger reconciliation report (PRD §5.14.5) — surfaces `ledgerReconciliationJob`'s persisted
// nightly runs; the job itself is unchanged, this just makes its output visible in the panel.
adminRoutes.get(
  '/ledger/reconciliation',
  authenticateAdmin,
  asyncHandler(adminController.listLedgerReconciliation),
);

// Payouts
adminRoutes.get('/payouts', authenticateAdmin, asyncHandler(adminController.listPayouts));
adminRoutes.patch(
  '/payouts/:id/process',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  asyncHandler(adminController.processPayout),
);

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

// Manual Moderation Workflow (PRD §5.9, §4.5, §5.14.7, backend Phase 6). Moderator is a
// capability of the existing Admin JWT namespace, not a separate principal (docs/CLAUDE.md
// §1/§7) — `authenticateAdmin` alone satisfies "only moderators/admins can moderate; Creator
// and Requester (both on the `authenticate`/User namespace) cannot."
// Pre-publish Pending Requests queue (PRD §5.9.2, §5.14.7, TRD §6 ground-truth paths) — distinct
// entity from the video queue below (a Request before it's ever published, gated by the same
// MODERATION_TOGGLE wired into requestService.create).
adminRoutes.get(
  '/moderation/requests/queue',
  authenticateAdmin,
  validate({query: pendingRequestsQuerySchema}),
  asyncHandler(adminModerationController.requestQueue),
);
adminRoutes.get(
  '/moderation/requests/:requestId',
  authenticateAdmin,
  validate({params: pendingRequestIdParamsSchema}),
  asyncHandler(adminModerationController.requestDetail),
);
adminRoutes.post(
  '/moderation/requests/:requestId/approve',
  authenticateAdmin,
  validate({params: pendingRequestIdParamsSchema}),
  asyncHandler(adminModerationController.approveRequest),
);
adminRoutes.post(
  '/moderation/requests/:requestId/reject',
  authenticateAdmin,
  validate({params: pendingRequestIdParamsSchema, body: rejectPendingRequestSchema}),
  asyncHandler(adminModerationController.rejectRequest),
);

adminRoutes.get(
  '/moderation/videos',
  authenticateAdmin,
  validate({query: moderationQueueQuerySchema}),
  asyncHandler(adminModerationController.queue),
);
adminRoutes.get(
  '/moderation/videos/history',
  authenticateAdmin,
  validate({query: moderationHistoryQuerySchema}),
  asyncHandler(adminModerationController.history),
);
adminRoutes.get(
  '/moderation/stats',
  authenticateAdmin,
  asyncHandler(adminModerationController.stats),
);
adminRoutes.post(
  '/moderation/videos/bulk-approve',
  authenticateAdmin,
  validate({body: bulkVideoIdsSchema}),
  asyncHandler(adminModerationController.bulkApprove),
);
adminRoutes.post(
  '/moderation/videos/bulk-reject',
  authenticateAdmin,
  validate({body: bulkRejectVideosSchema}),
  asyncHandler(adminModerationController.bulkReject),
);
adminRoutes.get(
  '/moderation/videos/:videoId',
  authenticateAdmin,
  validate({params: moderationVideoIdParamsSchema}),
  asyncHandler(adminModerationController.detail),
);
adminRoutes.patch(
  '/moderation/videos/:videoId/approve',
  authenticateAdmin,
  validate({params: moderationVideoIdParamsSchema, body: approveVideoSchema}),
  asyncHandler(adminModerationController.approve),
);
adminRoutes.patch(
  '/moderation/videos/:videoId/reject',
  authenticateAdmin,
  validate({params: moderationVideoIdParamsSchema, body: rejectVideoSchema}),
  asyncHandler(adminModerationController.reject),
);
adminRoutes.post(
  '/moderation/videos/:videoId/escalate',
  authenticateAdmin,
  validate({params: moderationVideoIdParamsSchema, body: adminEscalateDisputeSchema}),
  asyncHandler(adminModerationController.escalate),
);
// TRD §6 ground-truth REST surface: `POST /moderation/users/:id/suspend` — placed in the
// Moderation module (not the Users module's plain block toggle) since PRD §5.9.2 lists Suspend
// User as a Moderator-queue action, reason + duration required.
adminRoutes.post(
  '/moderation/users/:userId/suspend',
  authenticateAdmin,
  validate({body: adminSuspendUserSchema}),
  asyncHandler(adminModerationController.suspendUser),
);

// Escrow & Payment Release (PRD §7.1, §7.2, §5.14.5, backend Phase 8) — Refund Management /
// Finance Management. Release/refund are the same escrowService functions the automatic
// Requester/lifecycle flows use — they only gate on the escrow's own state, not the Request's
// current status, which is what makes them safe to reuse as an Admin "manual override."
adminRoutes.get(
  '/escrow',
  authenticateAdmin,
  validate({query: adminEscrowListQuerySchema}),
  asyncHandler(adminEscrowController.list),
);
adminRoutes.get('/escrow/summary', authenticateAdmin, asyncHandler(adminEscrowController.summary));
adminRoutes.get(
  '/escrow/:id',
  authenticateAdmin,
  validate({params: escrowRequestIdParamsSchema}),
  asyncHandler(adminEscrowController.detail),
);
adminRoutes.post(
  '/escrow/:id/release',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: escrowRequestIdParamsSchema, body: adminEscrowOverrideSchema}),
  asyncHandler(adminEscrowController.release),
);
adminRoutes.post(
  '/escrow/:id/refund',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: escrowRequestIdParamsSchema, body: adminEscrowOverrideSchema}),
  asyncHandler(adminEscrowController.refund),
);

// Report Queue (PRD §5.12, §5.14, backend Phase 9) — Admin review of Requester/Creator reports.
adminRoutes.get(
  '/reports',
  authenticateAdmin,
  validate({query: adminReportListQuerySchema}),
  asyncHandler(adminReportController.list),
);
adminRoutes.get('/reports/stats', authenticateAdmin, asyncHandler(adminReportController.stats));
adminRoutes.get(
  '/reports/:id',
  authenticateAdmin,
  validate({params: reportIdParamsSchema}),
  asyncHandler(adminReportController.detail),
);
adminRoutes.patch(
  '/reports/:id/resolve',
  authenticateAdmin,
  validate({params: reportIdParamsSchema, body: adminReportActionSchema}),
  asyncHandler(adminReportController.resolve),
);
adminRoutes.patch(
  '/reports/:id/dismiss',
  authenticateAdmin,
  validate({params: reportIdParamsSchema, body: adminReportActionSchema}),
  asyncHandler(adminReportController.dismiss),
);

// Requester/Creator Trust Profile (PRD §5.8, backend Phase 10) — Admin sub-module: score/badge
// visibility, suspicious-user surfacing (reuses the existing isSuspicious filter), verification
// toggle, manual review notes (reuses AdminAuditLog), and aggregate statistics.
adminRoutes.get(
  '/trust-profiles',
  authenticateAdmin,
  validate({query: adminTrustProfileListQuerySchema}),
  asyncHandler(adminTrustProfileController.list),
);
adminRoutes.get('/trust-profiles/stats', authenticateAdmin, asyncHandler(adminTrustProfileController.stats));
adminRoutes.get(
  '/trust-profiles/:userId',
  authenticateAdmin,
  validate({params: trustProfileUserIdParamsSchema}),
  asyncHandler(adminTrustProfileController.detail),
);
adminRoutes.patch(
  '/trust-profiles/:userId/verify',
  authenticateAdmin,
  validate({params: trustProfileUserIdParamsSchema}),
  asyncHandler(adminTrustProfileController.verify),
);
adminRoutes.patch(
  '/trust-profiles/:userId/unverify',
  authenticateAdmin,
  validate({params: trustProfileUserIdParamsSchema}),
  asyncHandler(adminTrustProfileController.unverify),
);
adminRoutes.get(
  '/trust-profiles/:userId/notes',
  authenticateAdmin,
  validate({params: trustProfileUserIdParamsSchema}),
  asyncHandler(adminTrustProfileController.listNotes),
);
adminRoutes.post(
  '/trust-profiles/:userId/notes',
  authenticateAdmin,
  validate({params: trustProfileUserIdParamsSchema, body: adminTrustProfileNoteSchema}),
  asyncHandler(adminTrustProfileController.addNote),
);

// Dispute Center (PRD §5.14.2, §5.14.3, §5.14.6, §5.14.8, §5.14.10, §4.9, backend Phase 11) —
// Admin arbitration. Moderator is a capability of the existing Admin JWT namespace, not a
// separate principal (docs/CLAUDE.md §1/§7) — `authenticateAdmin` alone gates every route here,
// same as every other Admin sub-module in this file.
adminRoutes.get(
  '/disputes',
  authenticateAdmin,
  validate({query: adminDisputeListQuerySchema}),
  asyncHandler(adminDisputeController.list),
);
adminRoutes.get('/disputes/stats', authenticateAdmin, asyncHandler(adminDisputeController.stats));
adminRoutes.get(
  '/disputes/:id',
  authenticateAdmin,
  validate({params: disputeIdParamsSchema}),
  asyncHandler(adminDisputeController.detail),
);
adminRoutes.get(
  '/disputes/:id/audit-log',
  authenticateAdmin,
  validate({params: disputeIdParamsSchema}),
  asyncHandler(adminDisputeController.auditTrail),
);
adminRoutes.get(
  '/disputes/:id/notes',
  authenticateAdmin,
  validate({params: disputeIdParamsSchema}),
  asyncHandler(adminDisputeController.listNotes),
);
adminRoutes.post(
  '/disputes/:id/notes',
  authenticateAdmin,
  validate({params: disputeIdParamsSchema, body: adminDisputeNoteSchema}),
  asyncHandler(adminDisputeController.addNote),
);
adminRoutes.post(
  '/disputes/:id/assign',
  authenticateAdmin,
  validate({params: disputeIdParamsSchema, body: adminDisputeAssignSchema}),
  asyncHandler(adminDisputeController.assign),
);
adminRoutes.post(
  '/disputes/:id/messages',
  authenticateAdmin,
  validate({params: disputeIdParamsSchema, body: adminDisputeMessageSchema}),
  asyncHandler(adminDisputeController.postMessage),
);
adminRoutes.post(
  '/disputes/:id/evidence',
  authenticateAdmin,
  disputeEvidenceUpload.single('file'),
  validate({params: disputeIdParamsSchema, body: disputeEvidenceCaptionSchema}),
  asyncHandler(adminDisputeController.submitEvidence),
);
adminRoutes.patch(
  '/disputes/:id/resolve',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: disputeIdParamsSchema, body: adminDisputeResolveSchema}),
  asyncHandler(adminDisputeController.resolve),
);
adminRoutes.patch(
  '/disputes/:id/close',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: disputeIdParamsSchema, body: adminDisputeCloseSchema}),
  asyncHandler(adminDisputeController.close),
);
adminRoutes.patch(
  '/disputes/:id/reopen',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: disputeIdParamsSchema, body: adminDisputeReopenSchema}),
  asyncHandler(adminDisputeController.reopen),
);

// Immutable Admin/Moderator audit log (PRD §5.14.7) — this pass only writes Moderation
// actions (see moderationService); backfilling other Admin actions is a later Phase 11 item.
adminRoutes.get(
  '/audit-logs',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({query: auditLogQuerySchema}),
  asyncHandler(adminAuditLogController.list),
);

// Compliance & Data Management (PRD §9, §5.14.8, backend Phase 13) — Admin-configurable
// retention windows/consent versions/grace periods, and the immutable data-deletion audit log
// (independent of AdminAuditLog above, since most Phase 13 actions are system/scheduled-job
// driven, not Admin-actor driven).
adminRoutes.get(
  '/compliance/config',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  asyncHandler(adminComplianceController.listConfig),
);
adminRoutes.patch(
  '/compliance/config/:key',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: complianceConfigKeyParamsSchema, body: complianceConfigUpdateSchema}),
  asyncHandler(adminComplianceController.updateConfig),
);
adminRoutes.get(
  '/compliance/deletion-logs',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({query: deletionLogQuerySchema}),
  asyncHandler(adminComplianceController.listDeletionLogs),
);

// v2.1 Feature Flags / Economy Settings — Admin-only (PRD §5.14.11, backend Phase 6). Single
// consolidated surface on top of `settingsService`/`PlatformSetting` — every economy value
// (Request Cost, Creator Reward, Signup Bonus, Daily Connects, Tip bounds, Credit/Connect INR
// values) and every wired-but-inactive feature flag, plus the dedicated Moderation Toggle
// endpoints from backend Phase 5.
// Dedicated Moderation Toggle routes registered before the generic `/settings/:key` below —
// Express matches PATCH routes in registration order, so the literal path must win first (same
// "specific before parameterized" convention already used for e.g. `/requests/nearby` above).
adminRoutes.get(
  '/settings/moderation-toggle',
  authenticateAdmin,
  asyncHandler(adminSettingsController.getModerationToggle),
);
adminRoutes.patch(
  '/settings/moderation-toggle',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({body: setModerationToggleSchema}),
  asyncHandler(adminSettingsController.setModerationToggle),
);

// Launch-Stage Presets (PRD §5.14.11, TRD §6 ground-truth paths) — registered before the
// generic `/settings/:key` below for readability (path shapes don't actually collide — this
// has 3 extra segments — but grouping with the other named settings routes above).
adminRoutes.post(
  '/settings/preset/:name/preview',
  authenticateAdmin,
  validate({params: presetNameParamsSchema}),
  asyncHandler(adminSettingsController.previewPreset),
);
adminRoutes.post(
  '/settings/preset/:name/apply',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: presetNameParamsSchema, body: applyPresetSchema}),
  asyncHandler(adminSettingsController.applyPreset),
);

adminRoutes.get('/settings', authenticateAdmin, asyncHandler(adminSettingsController.listAll));
adminRoutes.patch(
  '/settings/:key',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: settingsKeyParamsSchema, body: setSettingSchema}),
  asyncHandler(adminSettingsController.setSetting),
);

// Notification Templates (PRD §5.14.9) — Admin-only.
adminRoutes.get(
  '/notification-templates',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  asyncHandler(adminNotificationTemplateController.listAll),
);
adminRoutes.patch(
  '/notification-templates/:type',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: notificationTemplateTypeParamsSchema, body: upsertNotificationTemplateSchema}),
  asyncHandler(adminNotificationTemplateController.upsert),
);
adminRoutes.delete(
  '/notification-templates/:type',
  authenticateAdmin,
  requireRole(AdminRole.ADMIN),
  validate({params: notificationTemplateTypeParamsSchema}),
  asyncHandler(adminNotificationTemplateController.remove),
);
