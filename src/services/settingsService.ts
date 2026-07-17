import {BETA_ECONOMY_DEFAULTS} from '../config/betaEconomy';
import {redis} from '../config/redis';
import {logger} from '../config/logger';
import {settingsRepository} from '../repositories/settingsRepository';
import {adminAuditLogService} from './adminAuditLogService';

const CACHE_PREFIX = 'settings:cache:';
// TRD 8.4's own "<60s hot-path propagation target" — this is also what bounds staleness if a
// `PlatformSetting` row is ever changed by something other than `writeValue` below (e.g. a
// direct DB write/delete, which bypasses cache invalidation entirely). Previously unset (no
// expiry at all), which meant a cached value could persist indefinitely — caught via a real
// integration-test failure where a prior test's `setNumber` call outlived that test's own DB
// cleanup and silently poisoned a later, unrelated test's "no row exists" assertion.
const CACHE_TTL_SECONDS = 60;

/**
 * Best-effort Redis read-through cache (TRD 8.4's <60s hot-path propagation target). Cache
 * misses/errors fall through to a direct DB read — Redis is a performance optimization for
 * this module, not a correctness dependency (unlike `creatorLockService`'s mutex, which must
 * fail hard if Redis is unreachable). If Redis is down, every setting read just costs one extra
 * DB round-trip; nothing breaks.
 *
 * Checks `redis.status` before attempting a command rather than letting ioredis's
 * `maxRetriesPerRequest`/backoff chain run to exhaustion on every call — with Redis unreachable,
 * that chain takes multiple seconds per call (fine for the mutex, which needs Redis to be
 * correct; unacceptable here, where a settings read should degrade to a fast DB fallback, not
 * a multi-second stall). `'ready'` is the only status where a command is likely to succeed
 * quickly; every other status (`connecting`, `reconnecting`, `close`, `end`) skips straight to
 * the DB fallback.
 */
function redisLikelyAvailable(): boolean {
  return redis.status === 'ready';
}

async function cacheGet(key: string): Promise<unknown> {
  if (!redisLikelyAvailable()) return undefined;
  try {
    const raw = await redis.get(CACHE_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch (err) {
    logger.warn(`[settingsService] Redis cache read failed for "${key}", falling back to DB: ${(err as Error).message}`);
    return undefined;
  }
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  if (!redisLikelyAvailable()) return;
  try {
    await redis.set(CACHE_PREFIX + key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn(`[settingsService] Redis cache write failed for "${key}" (DB write still succeeded): ${(err as Error).message}`);
  }
}

/**
 * v2.1 Feature Flags / Economy Settings (PRD_TRD_SUMMARY.md §4.15, §6.1 item 11, §5.7/TRD 8.4).
 * Single consolidated runtime-configuration surface on top of `PlatformSetting` +
 * `PlatformSettingVersion` (Phase 1) — Redis-cached read-through (this item, Phase 6) for the
 * <60s propagation target, source of truth always Postgres. Every write inserts an immutable
 * `PlatformSettingVersion` row (audit trail) and an `AdminAuditLog` row.
 *
 * `getNumber`/`getBoolean` fall back to a **code-supplied default** (never invented silently —
 * every default below traces to a specific PRD §7.3/§5.14.11 value or an existing engineering
 * constant it replaces) when no DB row exists yet — this means the full key set doesn't need an
 * explicit seed migration; the first Admin write is what actually creates a row. `listAll()`
 * merges the default set with any DB overrides so the Admin Panel can render every key even
 * before it's ever been touched.
 *
 * **Not yet done** (still Phase 6 scope): `settingsVersionId` is not yet generalized onto every
 * request-adjacent write (only `RequestEscrow.commissionRate`/the new `Request.settingsVersionId`
 * column from Phase 1 exist as the snapshot points so far), and Launch-Stage Presets
 * (Beta/Public/Promotional, diff-preview-before-commit) are not built.
 */
export const SettingsKey = {
  /** PRD §5.9.0 — platform-wide ON/OFF switch. ON by default (mandatory moderation, the PRD's stated default). */
  MODERATION_TOGGLE: 'MODERATION_TOGGLE',

  // --- Economy values (PRD §7.3, backend Phase 6 item 3) — defaults from BETA_ECONOMY_DEFAULTS,
  // now Admin-overridable at runtime instead of hardcoded. `betaEconomy.ts` remains the
  // documented-default source; this is the override layer on top of it.
  REQUEST_COST_CREDITS: 'REQUEST_COST_CREDITS',
  CREATOR_REWARD_CREDITS: 'CREATOR_REWARD_CREDITS',
  ACCEPT_REQUEST_CONNECTS: 'ACCEPT_REQUEST_CONNECTS',
  SIGNUP_VIDEO_CREDITS: 'SIGNUP_VIDEO_CREDITS',
  SIGNUP_CONNECTS: 'SIGNUP_CONNECTS',
  DAILY_CONNECT_BONUS: 'DAILY_CONNECT_BONUS',
  DAILY_CONNECT_BONUS_CAP: 'DAILY_CONNECT_BONUS_CAP',
  TIP_MIN: 'TIP_MIN',
  TIP_MAX: 'TIP_MAX',
  TIP_WINDOW_DAYS: 'TIP_WINDOW_DAYS',
  VIDEO_CREDIT_VALUE_INR: 'VIDEO_CREDIT_VALUE_INR',
  CREATOR_CONNECT_VALUE_INR: 'CREATOR_CONNECT_VALUE_INR',

  // --- Feature flags (PRD §3.9, backend Phase 6 item 5) — every one ships OFF at Beta MVP.
  // No UI/logic exists behind any of these beyond the flag itself defaulting correctly OFF, per
  // the plan's explicit instruction not to build ahead of them.
  ENABLE_REFERRALS: 'ENABLE_REFERRALS',
  ENABLE_CREATOR_LEVELS: 'ENABLE_CREATOR_LEVELS',
  ENABLE_PURCHASE_CONNECTS: 'ENABLE_PURCHASE_CONNECTS',
  ENABLE_PURCHASE_CREDITS: 'ENABLE_PURCHASE_CREDITS',
  ENABLE_WITHDRAWAL: 'ENABLE_WITHDRAWAL',
  ENABLE_DAILY_LOGIN_BONUS: 'ENABLE_DAILY_LOGIN_BONUS',

  // --- Verified Creator Badge automation (PRD_TRD_SUMMARY.md §3.5, §4.12, backend Phase 7). ---
  VERIFIED_CREATOR_THRESHOLD: 'VERIFIED_CREATOR_THRESHOLD',
  VERIFIED_CREATOR_MIN_RATING: 'VERIFIED_CREATOR_MIN_RATING',
  VERIFIED_CREATOR_RATING_WINDOW: 'VERIFIED_CREATOR_RATING_WINDOW',

  // --- Highest Rated acceptance mode (PRD_TRD_SUMMARY.md §5.6/§5.7, backend Phase 4 item 4). ---
  HIGHEST_RATED_WINDOW_SECONDS: 'HIGHEST_RATED_WINDOW_SECONDS',

  /**
   * Auto-Payout Toggle (PRD §5.14.5/§4.8/§9.2 "Auto-Payout Toggle. Payout approval queue when
   * OFF."). OFF by default — every withdrawal currently lands in the manual `PayoutRequest`
   * queue for Admin approval; ON makes `walletService.withdraw` call RazorpayX immediately.
   */
  AUTO_PAYOUT_ENABLED: 'AUTO_PAYOUT_ENABLED',
} as const;

export type SettingsKeyValue = (typeof SettingsKey)[keyof typeof SettingsKey];

/** Every key's default + a one-line description, for `listAll()`. Not a DB seed — see module doc. */
const REGISTRY: Record<SettingsKeyValue, {type: 'boolean' | 'number'; default: number | boolean; description: string}> = {
  [SettingsKey.MODERATION_TOGGLE]: {type: 'boolean', default: true, description: 'Manual moderation of pre-publish requests and uploaded videos (PRD §5.9.0).'},
  [SettingsKey.REQUEST_COST_CREDITS]: {type: 'number', default: 150, description: 'Credits deducted from the Requester when posting a request (Beta mode).'},
  [SettingsKey.CREATOR_REWARD_CREDITS]: {type: 'number', default: 150, description: 'Credits paid to the Creator on completion (Beta mode).'},
  [SettingsKey.ACCEPT_REQUEST_CONNECTS]: {type: 'number', default: 1, description: 'Connects deducted from a Creator on Accept.'},
  [SettingsKey.SIGNUP_VIDEO_CREDITS]: {type: 'number', default: 300, description: 'Signup bonus Credits granted once per account.'},
  [SettingsKey.SIGNUP_CONNECTS]: {type: 'number', default: 30, description: 'Signup bonus Connects granted once per account.'},
  [SettingsKey.DAILY_CONNECT_BONUS]: {type: 'number', default: 5, description: 'Free Connects granted per IST calendar day.'},
  [SettingsKey.DAILY_CONNECT_BONUS_CAP]: {type: 'number', default: 50, description: 'Daily bonus never pushes the Connect balance above this.'},
  [SettingsKey.TIP_MIN]: {type: 'number', default: 10, description: 'Minimum tip amount (Credits or INR).'},
  [SettingsKey.TIP_MAX]: {type: 'number', default: 500, description: 'Maximum tip amount (Credits or INR).'},
  [SettingsKey.TIP_WINDOW_DAYS]: {type: 'number', default: 7, description: 'Days after Completed a tip can still be sent.'},
  [SettingsKey.VIDEO_CREDIT_VALUE_INR]: {type: 'number', default: 1, description: 'INR value of 1 Video Credit (Public Launch conversion rate).'},
  [SettingsKey.CREATOR_CONNECT_VALUE_INR]: {type: 'number', default: 5, description: 'INR value of 1 Creator Connect (Public Launch conversion rate).'},
  [SettingsKey.ENABLE_REFERRALS]: {type: 'boolean', default: false, description: 'Referral & Rewards Programme (Phase 3 scope, wired but inactive).'},
  [SettingsKey.ENABLE_CREATOR_LEVELS]: {type: 'boolean', default: false, description: 'Creator Levels/Gamification beyond the Verified Badge (Phase 3 scope, wired but inactive).'},
  [SettingsKey.ENABLE_PURCHASE_CONNECTS]: {type: 'boolean', default: false, description: 'Purchase of Connects with real money (Public Launch, pending RBI sign-off).'},
  [SettingsKey.ENABLE_PURCHASE_CREDITS]: {type: 'boolean', default: false, description: 'Purchase of Credits with real money (Public Launch, pending RBI sign-off).'},
  [SettingsKey.ENABLE_WITHDRAWAL]: {type: 'boolean', default: false, description: 'Real-money withdrawal to bank (Public Launch).'},
  [SettingsKey.ENABLE_DAILY_LOGIN_BONUS]: {type: 'boolean', default: false, description: 'Daily login bonus beyond the Daily Free Connects grant (Phase 3 scope, wired but inactive).'},
  [SettingsKey.VERIFIED_CREATOR_THRESHOLD]: {type: 'number', default: 50, description: 'Completed requests as Creator required for auto-verification.'},
  [SettingsKey.VERIFIED_CREATOR_MIN_RATING]: {type: 'number', default: 3.5, description: 'Below this average rating (over the rolling window), a Verified Creator is auto-revoked.'},
  [SettingsKey.VERIFIED_CREATOR_RATING_WINDOW]: {type: 'number', default: 20, description: 'Number of most-recent Creator ratings averaged for the auto-revoke check.'},
  [SettingsKey.HIGHEST_RATED_WINDOW_SECONDS]: {type: 'number', default: 90, description: 'Seconds a Highest Rated request stays open for Creator responses before the window closes (30-300).'},
  [SettingsKey.AUTO_PAYOUT_ENABLED]: {type: 'boolean', default: false, description: 'ON: withdrawals call RazorpayX immediately. OFF: withdrawals wait in the manual Admin approval queue.'},
};

async function readValue(key: SettingsKeyValue): Promise<unknown> {
  const cached = await cacheGet(key);
  if (cached !== undefined) return cached;

  const row = await settingsRepository.findByKey(key);
  if (row) {
    await cacheSet(key, row.value);
    return row.value;
  }
  return undefined;
}

/**
 * Launch-Stage Presets (PRD §5.14.11 "Beta Launch / Public Launch / Promotional Campaign,
 * one-click with diff-preview before commit"). Fixed definitions in code, not admin-editable —
 * the PRD spec's these three named stages, not a user-defined-preset builder. Beta values mirror
 * `REGISTRY`'s defaults (the "reset to launch defaults" case); Public Launch flips the
 * `ENABLE_*` flags PRD §3.9 explicitly ties to Public Launch ("Purchase of Credits/Connects...
 * Public Launch, pending RBI sign-off", "real-money withdrawal to bank (Public Launch)").
 * Promotional Campaign's exact multipliers are an interim engineering decision — the PRD
 * mentions the concept but gives no specific numeric preset — flagged here rather than invented
 * silently elsewhere.
 */
export const LAUNCH_PRESETS = {
  BETA: {
    [SettingsKey.MODERATION_TOGGLE]: true,
    [SettingsKey.ENABLE_REFERRALS]: false,
    [SettingsKey.ENABLE_CREATOR_LEVELS]: false,
    [SettingsKey.ENABLE_PURCHASE_CONNECTS]: false,
    [SettingsKey.ENABLE_PURCHASE_CREDITS]: false,
    [SettingsKey.ENABLE_WITHDRAWAL]: false,
    [SettingsKey.ENABLE_DAILY_LOGIN_BONUS]: false,
    [SettingsKey.AUTO_PAYOUT_ENABLED]: false,
  },
  PUBLIC: {
    [SettingsKey.MODERATION_TOGGLE]: true,
    [SettingsKey.ENABLE_PURCHASE_CONNECTS]: true,
    [SettingsKey.ENABLE_PURCHASE_CREDITS]: true,
    [SettingsKey.ENABLE_WITHDRAWAL]: true,
  },
  // [REVIEW — interim, not PRD-numbered]: doubles the daily/signup Connect grants for the
  // campaign's duration. `promotional_preset_revert` (TRD §5.8 background job — scheduled
  // revert to pre-campaign values at campaign end) is not built; reverting today means manually
  // re-applying the BETA preset.
  PROMOTIONAL: {
    [SettingsKey.DAILY_CONNECT_BONUS]: BETA_ECONOMY_DEFAULTS.DAILY_CONNECT_BONUS * 2,
    [SettingsKey.SIGNUP_CONNECTS]: BETA_ECONOMY_DEFAULTS.SIGNUP_CONNECTS * 2,
  },
} satisfies Record<string, Partial<Record<SettingsKeyValue, number | boolean>>>;

export type LaunchPresetName = keyof typeof LAUNCH_PRESETS;

async function writeValue(key: SettingsKeyValue, value: unknown, adminId: string, reason: string): Promise<void> {
  const existing = await settingsRepository.findByKey(key);
  const oldValue = existing?.value ?? undefined;

  await settingsRepository.upsert(key, value as never, adminId);
  await settingsRepository.createVersion(key, oldValue as never, value as never, adminId, reason);
  await cacheSet(key, value);
  await adminAuditLogService.log(adminId, 'SETTINGS_CHANGED', 'PlatformSetting', key, {key, oldValue, newValue: value, reason});
}

export const settingsService = {
  async getBoolean(key: SettingsKeyValue, defaultValue: boolean): Promise<boolean> {
    const value = await readValue(key);
    return value === undefined ? defaultValue : value === true;
  },

  async setBoolean(key: SettingsKeyValue, value: boolean, adminId: string, reason: string): Promise<void> {
    return writeValue(key, value, adminId, reason);
  },

  async getNumber(key: SettingsKeyValue, defaultValue: number): Promise<number> {
    const value = await readValue(key);
    return value === undefined ? defaultValue : Number(value);
  },

  async setNumber(key: SettingsKeyValue, value: number, adminId: string, reason: string): Promise<void> {
    return writeValue(key, value, adminId, reason);
  },

  /** PRD §5.9.0 — the safety-critical convenience wrapper every moderation-gated call site uses. */
  async isModerationEnabled(): Promise<boolean> {
    return this.getBoolean(SettingsKey.MODERATION_TOGGLE, true);
  },

  async setModerationEnabled(enabled: boolean, adminId: string, reason: string): Promise<void> {
    return this.setBoolean(SettingsKey.MODERATION_TOGGLE, enabled, adminId, reason);
  },

  /** PRD §5.14.5 — the convenience wrapper `walletService.withdraw` branches on. */
  async isAutoPayoutEnabled(): Promise<boolean> {
    return this.getBoolean(SettingsKey.AUTO_PAYOUT_ENABLED, false);
  },

  /**
   * `POST /admin/settings/preset/:name/preview` — current vs. proposed value for every key the
   * named preset touches. Read-only, no write.
   */
  async previewPreset(name: LaunchPresetName) {
    const preset = LAUNCH_PRESETS[name];
    const entries = Object.entries(preset) as [SettingsKeyValue, number | boolean][];
    const diff = await Promise.all(
      entries.map(async ([key, proposed]) => {
        const meta = REGISTRY[key];
        const current = meta.type === 'boolean' ? await this.getBoolean(key, meta.default as boolean) : await this.getNumber(key, meta.default as number);
        return {key, current, proposed, changed: current !== proposed};
      }),
    );
    return diff;
  },

  /**
   * `POST /admin/settings/preset/:name/apply` — writes every key the preset touches via the
   * existing per-key `writeValue` (so each field change is individually audit-logged and
   * version-tracked, same as a manual edit), plus one additional consolidated `PRESET_APPLIED`
   * audit entry so the whole batch is discoverable as a single event too.
   */
  async applyPreset(name: LaunchPresetName, adminId: string, reason: string) {
    const preset = LAUNCH_PRESETS[name];
    const entries = Object.entries(preset) as [SettingsKeyValue, number | boolean][];
    const applied: Array<{key: SettingsKeyValue; value: number | boolean}> = [];

    for (const [key, value] of entries) {
      await writeValue(key, value, adminId, `Launch-Stage Preset: ${name} — ${reason}`);
      applied.push({key, value});
    }

    await adminAuditLogService.log(adminId, 'PRESET_APPLIED', 'PlatformSetting', name, {preset: name, reason, applied});
    return applied;
  },

  /** `GET /admin/settings` — every known key, its current effective value, and whether it's been overridden. */
  async listAll() {
    const keys = Object.values(SettingsKey);
    const rows = await Promise.all(
      keys.map(async key => {
        const meta = REGISTRY[key];
        const row = await settingsRepository.findByKey(key);
        const currentValue = row ? row.value : meta.default;
        return {
          key,
          type: meta.type,
          description: meta.description,
          default: meta.default,
          value: currentValue,
          isOverridden: Boolean(row),
          updatedAt: row?.updatedAt.toISOString() ?? null,
        };
      }),
    );
    return rows;
  },
};
