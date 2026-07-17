import {complianceConfigRepository} from '../repositories/complianceConfigRepository';
import {HttpError} from '../utils/httpError';
import {adminAuditLogService} from './adminAuditLogService';

/**
 * Admin-configurable retention windows / consent versions / grace periods (PRD §5.14.8-style
 * "configurable Admin setting, not a hardcoded number" pattern, per docs/CLAUDE.md §4/§11 — do
 * not silently invent values for anything the PRD tags `[REVIEW]`). Every numeric default below
 * is an interim engineering value pending client confirmation, exactly like
 * `ACCEPTANCE_TIMER_MINUTES`/`COMMISSION_RATE_PERCENT` elsewhere in this codebase — the
 * difference here is these are DB-backed (`ComplianceConfig`) so an Admin can adjust them without
 * a redeploy, per this milestone's explicit "Retention configuration" ask.
 *
 * Self-seeding: `ensureSeeded()` inserts every key below with `skipDuplicates: true` — safe to
 * call on every cold read, and idempotent across repeated app restarts/multiple instances.
 */
export const ComplianceConfigKey = {
  // PRD §9 [REVIEW]. `ChatMessage` rows for a terminal Request older than this are purged.
  CHAT_RETENTION_DAYS: 'CHAT_RETENTION_DAYS',
  // PRD §9 [REVIEW]. Fulfilled (COMPLETED/PAYMENT_RELEASED) video asset deleted this long after
  // moderation approval — the Request row/metadata are kept forever, only the Cloudinary asset
  // itself is purged.
  VIDEO_FULFILLED_RETENTION_HOURS: 'VIDEO_FULFILLED_RETENTION_HOURS',
  // PRD §9 [REVIEW]. Rejected/expired/cancelled/disputed video assets purged this long after the
  // Request reached a terminal state.
  VIDEO_TERMINAL_RETENTION_HOURS: 'VIDEO_TERMINAL_RETENTION_HOURS',
  // Not PRD-numbered — this milestone's own explicit "Notification retention" ask. Read
  // notifications older than this are purged; unread ones are never purged by this job.
  NOTIFICATION_RETENTION_DAYS: 'NOTIFICATION_RETENTION_DAYS',
  // PRD §9 (informational only — Transaction rows are never purged by any job in this codebase;
  // exposed here purely so Admin can see/document the retention commitment).
  TRANSACTION_RETENTION_YEARS: 'TRANSACTION_RETENTION_YEARS',
  // PRD §9 (informational only — AdminAuditLog/moderation-decision rows are never purged).
  MODERATION_LOG_RETENTION_YEARS: 'MODERATION_LOG_RETENTION_YEARS',
  // Not PRD-numbered — how long a soft-deleted account stays reversible before
  // `retentionJob.executeScheduledHardDeletes` anonymizes it.
  ACCOUNT_DELETION_GRACE_DAYS: 'ACCOUNT_DELETION_GRACE_DAYS',
  // Not PRD-numbered — how long an account must be untouched before the inactive-account cleanup
  // job purges its stale ephemeral data (expired OTPs, stale FCM token).
  INACTIVE_ACCOUNT_DAYS: 'INACTIVE_ACCOUNT_DAYS',
  // Not PRD-numbered — safety-net grace window before the expired-draft cleanup job force-expires
  // a DRAFT request the lifecycle sweep should already have caught.
  DRAFT_CLEANUP_GRACE_HOURS: 'DRAFT_CLEANUP_GRACE_HOURS',
  // PRD §5.11b.3 — how many consecutive Requester rejections trigger the welcome-video re-prompt.
  CONSECUTIVE_REJECTIONS_REPROMPT_THRESHOLD: 'CONSECUTIVE_REJECTIONS_REPROMPT_THRESHOLD',
  // Consent versions (PRD §9.1, §5.7.3) — bumping one of these is what triggers the mobile
  // re-acceptance gate for every user whose latest ConsentRecord for that type is older.
  TERMS_OF_SERVICE_VERSION: 'TERMS_OF_SERVICE_VERSION',
  PRIVACY_POLICY_VERSION: 'PRIVACY_POLICY_VERSION',
  COMMUNITY_GUIDELINES_VERSION: 'COMMUNITY_GUIDELINES_VERSION',
  RECORDING_POLICY_VERSION: 'RECORDING_POLICY_VERSION',
  // Commission Settings (PRD §5.2, §7.1, §5.14.8 [REVIEW — this is the only number the PRD
  // gives], backend Phase 11). Snapshotted onto each `RequestEscrow` row at reservation time
  // (see escrowService.reserve) so an Admin changing this later never retroactively alters an
  // already-reserved escrow's split — same pattern as every other "configurable, not hardcoded"
  // value in this file.
  COMMISSION_RATE_PERCENT: 'COMMISSION_RATE_PERCENT',
  // PRD §5.9.2 "Pending Videos queue... SLA countdown vs. 2h target" — the Moderation queue's
  // per-video overdue indicator counts against this, off `RequestVideo.createdAt`.
  VIDEO_REVIEW_SLA_HOURS: 'VIDEO_REVIEW_SLA_HOURS',
} as const;

export type ComplianceConfigKeyValue = (typeof ComplianceConfigKey)[keyof typeof ComplianceConfigKey];

const DEFAULTS: Record<ComplianceConfigKeyValue, {value: string; description: string}> = {
  [ComplianceConfigKey.CHAT_RETENTION_DAYS]: {
    value: '90',
    description: '[REVIEW] Days after a request closes before its chat log is purged (PRD §9, §5.4).',
  },
  [ComplianceConfigKey.VIDEO_FULFILLED_RETENTION_HOURS]: {
    value: '2',
    description: '[REVIEW] Hours after acceptance before a fulfilled video asset is deleted (PRD §9).',
  },
  [ComplianceConfigKey.VIDEO_TERMINAL_RETENTION_HOURS]: {
    value: '24',
    description: '[REVIEW] Hours after rejection/expiry/cancellation before a video asset is deleted (PRD §9).',
  },
  [ComplianceConfigKey.NOTIFICATION_RETENTION_DAYS]: {
    value: '180',
    description: 'Days a read notification is kept before purge (this milestone\'s own interim default, not PRD-numbered).',
  },
  [ComplianceConfigKey.TRANSACTION_RETENTION_YEARS]: {
    value: '7',
    description: 'PRD §9 — informational only. Transactions are never purged by any job.',
  },
  [ComplianceConfigKey.MODERATION_LOG_RETENTION_YEARS]: {
    value: '3',
    description: '[REVIEW] PRD §9 — informational only. Moderation/audit logs are never purged.',
  },
  [ComplianceConfigKey.ACCOUNT_DELETION_GRACE_DAYS]: {
    value: '30',
    description: 'Days a soft-deleted account can still be logged into to cancel deletion (interim, not PRD-numbered).',
  },
  [ComplianceConfigKey.INACTIVE_ACCOUNT_DAYS]: {
    value: '365',
    description: 'Days of inactivity before stale OTP rows/FCM token are cleaned up (interim, not PRD-numbered).',
  },
  [ComplianceConfigKey.DRAFT_CLEANUP_GRACE_HOURS]: {
    value: '1',
    description: 'Safety-net grace window past expiresAt before the draft-cleanup sweep force-expires a DRAFT request.',
  },
  [ComplianceConfigKey.CONSECUTIVE_REJECTIONS_REPROMPT_THRESHOLD]: {
    value: '3',
    description: 'PRD §5.11b.3 — consecutive Requester rejections before the welcome video re-prompts.',
  },
  [ComplianceConfigKey.TERMS_OF_SERVICE_VERSION]: {value: '1.0', description: 'Current Terms of Service version.'},
  [ComplianceConfigKey.PRIVACY_POLICY_VERSION]: {value: '1.0', description: 'Current Privacy Policy version.'},
  [ComplianceConfigKey.COMMUNITY_GUIDELINES_VERSION]: {
    value: '1.0',
    description: 'Current Community Guidelines version.',
  },
  [ComplianceConfigKey.RECORDING_POLICY_VERSION]: {value: '1.0', description: 'Current Recording Policy version.'},
  [ComplianceConfigKey.COMMISSION_RATE_PERCENT]: {
    value: '15',
    description: '[REVIEW] Platform commission %, snapshotted onto each escrow at reservation time (PRD §5.2, §7.1).',
  },
  [ComplianceConfigKey.VIDEO_REVIEW_SLA_HOURS]: {
    value: '2',
    description: 'PRD §5.9.2 target hours for a Moderator to review a pending video before it counts as overdue.',
  },
};

/** Keys whose `value` must be a plain number, validated in `adminUpdate` before it's persisted. */
const NUMERIC_KEYS: ReadonlySet<ComplianceConfigKeyValue> = new Set([
  ComplianceConfigKey.CHAT_RETENTION_DAYS,
  ComplianceConfigKey.VIDEO_FULFILLED_RETENTION_HOURS,
  ComplianceConfigKey.VIDEO_TERMINAL_RETENTION_HOURS,
  ComplianceConfigKey.NOTIFICATION_RETENTION_DAYS,
  ComplianceConfigKey.TRANSACTION_RETENTION_YEARS,
  ComplianceConfigKey.MODERATION_LOG_RETENTION_YEARS,
  ComplianceConfigKey.ACCOUNT_DELETION_GRACE_DAYS,
  ComplianceConfigKey.INACTIVE_ACCOUNT_DAYS,
  ComplianceConfigKey.DRAFT_CLEANUP_GRACE_HOURS,
  ComplianceConfigKey.CONSECUTIVE_REJECTIONS_REPROMPT_THRESHOLD,
  ComplianceConfigKey.COMMISSION_RATE_PERCENT,
  ComplianceConfigKey.VIDEO_REVIEW_SLA_HOURS,
]);

let seeded = false;

async function ensureSeeded() {
  if (seeded) return;
  await complianceConfigRepository.createMany(
    Object.entries(DEFAULTS).map(([key, {value, description}]) => ({key, value, description})),
  );
  seeded = true;
}

export const complianceConfigService = {
  async getString(key: ComplianceConfigKeyValue): Promise<string> {
    await ensureSeeded();
    const row = await complianceConfigRepository.findByKey(key);
    return row?.value ?? DEFAULTS[key].value;
  },

  async getNumber(key: ComplianceConfigKeyValue): Promise<number> {
    const raw = await this.getString(key);
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : Number(DEFAULTS[key].value);
  },

  async listAll() {
    await ensureSeeded();
    const rows = await complianceConfigRepository.findMany();
    return rows.map(row => ({
      key: row.key,
      value: row.value,
      description: row.description,
      updatedAt: row.updatedAt.toISOString(),
    }));
  },

  async adminUpdate(adminId: string, key: string, value: string) {
    if (!(key in DEFAULTS)) {
      throw new HttpError(404, `Unknown compliance config key "${key}".`);
    }
    if (NUMERIC_KEYS.has(key as ComplianceConfigKeyValue)) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new HttpError(422, `"${key}" must be a non-negative number.`);
      }
      if (key === ComplianceConfigKey.COMMISSION_RATE_PERCENT && parsed > 100) {
        throw new HttpError(422, 'Commission rate cannot exceed 100%.');
      }
    }
    await ensureSeeded();
    const updated = await complianceConfigRepository.upsert(key, value, DEFAULTS[key as ComplianceConfigKeyValue].description);
    await adminAuditLogService.log(adminId, 'COMPLIANCE_CONFIG_UPDATED', 'ComplianceConfig', key, {key, value});
    return {
      key: updated.key,
      value: updated.value,
      description: updated.description,
      updatedAt: updated.updatedAt.toISOString(),
    };
  },
};
