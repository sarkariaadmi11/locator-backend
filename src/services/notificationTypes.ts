/**
 * Full notification matrix (backend Phase 12, PRD §8.1/§8.2). One canonical `type` string per
 * trigger — `data.type` on every `Notification` row and FCM payload uses these exact values, so
 * mobile has a single, stable key to route deep links off (see `notificationService.ts`).
 *
 * Three renames from pre-Phase-12 ad hoc strings (no other code read these as anything but an
 * opaque JSON value, so renaming is safe): `REQUEST_ACCEPTED` -> `CREATOR_ACCEPTED`,
 * `ACCEPTANCE_EXPIRED` -> `CREATOR_TIMED_OUT`, `DISPUTE_RAISED` -> `DISPUTE_CREATED` — each now
 * matches this milestone's matrix naming exactly. Every other pre-existing type string is kept
 * unchanged.
 */
export const NotificationType = {
  // Authentication
  WELCOME: 'WELCOME',
  SIGNUP_SUCCESSFUL: 'SIGNUP_SUCCESSFUL',
  PASSWORD_RESET_CONFIRMATION: 'PASSWORD_RESET_CONFIRMATION',

  // Requests
  REQUEST_CREATED: 'REQUEST_CREATED',
  REQUEST_SCHEDULED: 'REQUEST_SCHEDULED',
  REQUEST_PUBLISHED: 'REQUEST_PUBLISHED',
  NEARBY_CREATOR_FOUND: 'NEARBY_CREATOR_FOUND',
  CREATOR_ACCEPTED: 'CREATOR_ACCEPTED',
  CREATOR_TIMED_OUT: 'CREATOR_TIMED_OUT',
  REQUEST_CANCELLED: 'REQUEST_CANCELLED',
  REQUEST_EXPIRED: 'REQUEST_EXPIRED',
  // Pre-publish Pending Requests queue (PRD §5.9.2, §5.14.7) — a Moderator/Admin rejected the
  // request before it was ever published/broadcast to Creators; full refund accompanies this.
  REQUEST_REJECTED: 'REQUEST_REJECTED',
  // Highest Rated acceptance mode matching window (PRD_TRD_SUMMARY.md §5.6/§5.7/§7.4 item 5,
  // backend Phase 4 item 4) — sent to a Creator who responded but didn't win the window, and to
  // the Requester if the window closes with zero responses (falls back to First Accepted).
  MATCHING_WINDOW_LOST: 'MATCHING_WINDOW_LOST',
  MATCHING_WINDOW_FALLBACK: 'MATCHING_WINDOW_FALLBACK',

  // Temporary Chat (v2.0, superseded — see docs/CLAUDE.md §2.2. Kept for any pre-existing row.)
  CHAT_OPENED: 'CHAT_OPENED',
  NEW_MESSAGE: 'NEW_MESSAGE',
  CHAT_CLOSED: 'CHAT_CLOSED',

  // Pre-Acceptance Query (PRD_TRD_SUMMARY.md §4.6, backend Phase 4 — v2.1 replacement for the
  // post-acceptance chat above).
  QUERY_RECEIVED: 'QUERY_RECEIVED',
  QUERY_REPLY_RECEIVED: 'QUERY_REPLY_RECEIVED',

  // Recording
  RECORDING_STARTED: 'RECORDING_STARTED',
  RECORDING_REMINDER: 'RECORDING_REMINDER',
  UPLOAD_STARTED: 'UPLOAD_STARTED',
  UPLOAD_SUCCESSFUL: 'UPLOAD_SUCCESSFUL',
  UPLOAD_FAILED: 'UPLOAD_FAILED',

  // Moderation
  VIDEO_APPROVED: 'VIDEO_APPROVED',
  VIDEO_REJECTED: 'VIDEO_REJECTED',

  // Requester Review
  VIDEO_READY: 'VIDEO_READY',
  REVIEW_REMINDER: 'REVIEW_REMINDER',
  // v2.1 48h auto-accept (PRD_TRD_SUMMARY.md §5.8, backend Phase 3 item 5) — 42h warning, distinct
  // from the pre-existing 2h REVIEW_REMINDER above (different trigger, different message).
  REVIEW_AUTO_ACCEPT_WARNING: 'REVIEW_AUTO_ACCEPT_WARNING',
  VIDEO_ACCEPTED: 'VIDEO_ACCEPTED',
  RESHOOT_REQUESTED: 'RESHOOT_REQUESTED',
  VIDEO_REQUESTER_REJECTED: 'VIDEO_REQUESTER_REJECTED',

  // Escrow
  ESCROW_RESERVED: 'ESCROW_RESERVED',
  PAYMENT_RELEASED: 'PAYMENT_RELEASED',
  REFUND_ISSUED: 'REFUND_ISSUED',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
  // Tipping (PRD §5.15, backend Phase 2) — post-Completed, non-blocking, one-way (Requester -> Creator).
  TIP_RECEIVED: 'TIP_RECEIVED',

  // Ratings
  RATING_REMINDER: 'RATING_REMINDER',
  RATING_RECEIVED: 'RATING_RECEIVED',

  // Reports
  REPORT_SUBMITTED: 'REPORT_SUBMITTED',
  REPORT_UPDATED: 'REPORT_UPDATED',
  REPORT_RESOLVED: 'REPORT_RESOLVED',

  // Trust
  BADGE_EARNED: 'BADGE_EARNED',
  TRUST_SCORE_UPDATED: 'TRUST_SCORE_UPDATED',
  VERIFICATION_GRANTED: 'VERIFICATION_GRANTED',

  // Disputes
  DISPUTE_CREATED: 'DISPUTE_CREATED',
  NEW_EVIDENCE: 'NEW_EVIDENCE',
  ADMIN_ASSIGNED: 'ADMIN_ASSIGNED',
  DISPUTE_MESSAGE: 'DISPUTE_MESSAGE',
  DISPUTE_RESOLVED: 'DISPUTE_RESOLVED',
  DISPUTE_REOPENED: 'DISPUTE_REOPENED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',

  // Wallet / Payout (pre-existing, kept as-is)
  PAYOUT_REQUEST: 'PAYOUT_REQUEST',
  PAYOUT_APPROVED: 'PAYOUT_APPROVED',
  PAYOUT_REJECTED: 'PAYOUT_REJECTED',

  // Compliance & Data Management (PRD §9, backend Phase 13)
  ACCOUNT_DELETION_SCHEDULED: 'ACCOUNT_DELETION_SCHEDULED',
  ACCOUNT_DELETION_CANCELLED: 'ACCOUNT_DELETION_CANCELLED',
  DATA_EXPORT_READY: 'DATA_EXPORT_READY',
  RECONSENT_REQUIRED: 'RECONSENT_REQUIRED',

  // Safety-critical (never gated by user preference, PRD §8.2)
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  // Account hard-deletion is irreversible — the user must see this regardless of preferences,
  // mirroring ACCOUNT_SUSPENDED's "cannot be disabled" treatment.
  ACCOUNT_HARD_DELETED: 'ACCOUNT_HARD_DELETED',

  // Admin-only alerts (sent via fcmService.sendToAllAdmins, no in-app row, no user preference gate)
  SUSPICIOUS_USER: 'SUSPICIOUS_USER',
  HIGH_PRIORITY_REPORT: 'HIGH_PRIORITY_REPORT',
  HIGH_VALUE_ESCROW: 'HIGH_VALUE_ESCROW',
  LARGE_REFUND: 'LARGE_REFUND',
  // GPS spoofing / mock-location signal (PRD_TRD_SUMMARY.md §5.10, backend Phase 8 item 2) —
  // flag-and-queue only, never auto-block (explicit MVP policy, repeated throughout the PRD).
  GPS_SPOOFING_SUSPECTED: 'GPS_SPOOFING_SUSPECTED',
  // Monitoring/alerting (PRD §11, backend Phase 14) — moderation-queue depth, pending-payout
  // queue depth, and failed-webhook rate all crossing their documented thresholds.
  SYSTEM_THRESHOLD_ALERT: 'SYSTEM_THRESHOLD_ALERT',
} as const;

export type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType];

/** PRD §8.2's 3 independently toggleable categories. */
export const NotificationCategory = {
  REQUEST_ACTIVITY: 'REQUEST_ACTIVITY',
  PAYMENT_WALLET: 'PAYMENT_WALLET',
  PLATFORM_ALERTS: 'PLATFORM_ALERTS',
} as const;

export type NotificationCategoryValue = (typeof NotificationCategory)[keyof typeof NotificationCategory];

const T = NotificationType;
const C = NotificationCategory;

/** Every user-facing type must appear here exactly once. Admin-only alert types are excluded — they never go through the per-user preference gate (see notificationService.notifyAdmins). */
export const NOTIFICATION_TYPE_CATEGORY: Partial<Record<NotificationTypeValue, NotificationCategoryValue>> = {
  [T.WELCOME]: C.PLATFORM_ALERTS,
  [T.SIGNUP_SUCCESSFUL]: C.PLATFORM_ALERTS,
  [T.PASSWORD_RESET_CONFIRMATION]: C.PLATFORM_ALERTS,

  [T.REQUEST_CREATED]: C.REQUEST_ACTIVITY,
  [T.REQUEST_SCHEDULED]: C.REQUEST_ACTIVITY,
  [T.REQUEST_PUBLISHED]: C.REQUEST_ACTIVITY,
  [T.NEARBY_CREATOR_FOUND]: C.REQUEST_ACTIVITY,
  [T.CREATOR_ACCEPTED]: C.REQUEST_ACTIVITY,
  [T.CREATOR_TIMED_OUT]: C.REQUEST_ACTIVITY,
  [T.REQUEST_CANCELLED]: C.REQUEST_ACTIVITY,
  [T.REQUEST_EXPIRED]: C.REQUEST_ACTIVITY,
  [T.REQUEST_REJECTED]: C.REQUEST_ACTIVITY,
  [T.MATCHING_WINDOW_LOST]: C.REQUEST_ACTIVITY,
  [T.MATCHING_WINDOW_FALLBACK]: C.REQUEST_ACTIVITY,

  [T.CHAT_OPENED]: C.REQUEST_ACTIVITY,
  [T.NEW_MESSAGE]: C.REQUEST_ACTIVITY,
  [T.CHAT_CLOSED]: C.REQUEST_ACTIVITY,
  [T.QUERY_RECEIVED]: C.REQUEST_ACTIVITY,
  [T.QUERY_REPLY_RECEIVED]: C.REQUEST_ACTIVITY,

  [T.RECORDING_STARTED]: C.REQUEST_ACTIVITY,
  [T.RECORDING_REMINDER]: C.REQUEST_ACTIVITY,
  [T.UPLOAD_STARTED]: C.REQUEST_ACTIVITY,
  [T.UPLOAD_SUCCESSFUL]: C.REQUEST_ACTIVITY,
  [T.UPLOAD_FAILED]: C.REQUEST_ACTIVITY,

  [T.VIDEO_APPROVED]: C.REQUEST_ACTIVITY,
  [T.VIDEO_REJECTED]: C.REQUEST_ACTIVITY,

  [T.VIDEO_READY]: C.REQUEST_ACTIVITY,
  [T.REVIEW_REMINDER]: C.REQUEST_ACTIVITY,
  [T.REVIEW_AUTO_ACCEPT_WARNING]: C.REQUEST_ACTIVITY,
  [T.VIDEO_ACCEPTED]: C.REQUEST_ACTIVITY,
  [T.RESHOOT_REQUESTED]: C.REQUEST_ACTIVITY,
  [T.VIDEO_REQUESTER_REJECTED]: C.REQUEST_ACTIVITY,

  [T.ESCROW_RESERVED]: C.PAYMENT_WALLET,
  [T.PAYMENT_RELEASED]: C.PAYMENT_WALLET,
  [T.REFUND_ISSUED]: C.PAYMENT_WALLET,
  [T.PAYMENT_COMPLETED]: C.PAYMENT_WALLET,
  [T.TIP_RECEIVED]: C.PAYMENT_WALLET,

  [T.RATING_REMINDER]: C.REQUEST_ACTIVITY,
  [T.RATING_RECEIVED]: C.REQUEST_ACTIVITY,

  [T.REPORT_SUBMITTED]: C.PLATFORM_ALERTS,
  [T.REPORT_UPDATED]: C.PLATFORM_ALERTS,
  [T.REPORT_RESOLVED]: C.PLATFORM_ALERTS,

  [T.BADGE_EARNED]: C.PLATFORM_ALERTS,
  [T.TRUST_SCORE_UPDATED]: C.PLATFORM_ALERTS,
  [T.VERIFICATION_GRANTED]: C.PLATFORM_ALERTS,

  [T.DISPUTE_CREATED]: C.PLATFORM_ALERTS,
  [T.NEW_EVIDENCE]: C.PLATFORM_ALERTS,
  [T.ADMIN_ASSIGNED]: C.PLATFORM_ALERTS,
  [T.DISPUTE_MESSAGE]: C.PLATFORM_ALERTS,
  [T.DISPUTE_RESOLVED]: C.PLATFORM_ALERTS,
  [T.DISPUTE_REOPENED]: C.PLATFORM_ALERTS,
  [T.REFUND_COMPLETED]: C.PAYMENT_WALLET,

  [T.PAYOUT_REQUEST]: C.PAYMENT_WALLET,
  [T.PAYOUT_APPROVED]: C.PAYMENT_WALLET,
  [T.PAYOUT_REJECTED]: C.PAYMENT_WALLET,

  [T.ACCOUNT_DELETION_SCHEDULED]: C.PLATFORM_ALERTS,
  [T.ACCOUNT_DELETION_CANCELLED]: C.PLATFORM_ALERTS,
  [T.DATA_EXPORT_READY]: C.PLATFORM_ALERTS,
  [T.RECONSENT_REQUIRED]: C.PLATFORM_ALERTS,

  [T.ACCOUNT_SUSPENDED]: C.PLATFORM_ALERTS,
  [T.ACCOUNT_HARD_DELETED]: C.PLATFORM_ALERTS,
};

/**
 * Safety-critical types (PRD §8.2: "suspension, payment failure") — never suppressed by a
 * user's category preference, even if they've disabled that whole category. Enforced in
 * `notificationService.notifyUser`, not left to client-side hiding.
 */
export const SAFETY_CRITICAL_TYPES: ReadonlySet<NotificationTypeValue> = new Set([
  T.ACCOUNT_SUSPENDED,
  T.PAYOUT_REJECTED,
  T.ACCOUNT_HARD_DELETED,
]);

/** Deep-link screen keys mobile's notification-tap router (`navigationRef.ts`) understands. */
export const NotificationScreen = {
  REQUEST_DETAIL: 'RequestDetail',
  CREATOR_REQUEST_DETAIL: 'CreatorRequestDetail',
  CHAT: 'Chat',
  VIDEO_REVIEW: 'VideoReview',
  DISPUTE_DETAIL: 'DisputeDetail',
  TRUST_PROFILE: 'TrustProfile',
  WALLET: 'Wallet',
  NOTIFICATIONS: 'Notifications',
  PRIVACY_SETTINGS: 'PrivacySettings',
} as const;
