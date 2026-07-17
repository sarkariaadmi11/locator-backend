/**
 * v2.1 Beta Credits/Connects economy defaults (PRD_TRD_SUMMARY.md §7.3 — the summary's own
 * guidance treats §7.3 as authoritative over the TRD appendix's garbled formatting, see
 * PRD_TRD_SUMMARY.md §11 item 8).
 *
 * Interim hardcoded constants (backend Phase 2). Phase 6 ("Feature Flags / Economy Settings")
 * moves every one of these into the `PlatformSetting` table (schema landed in Phase 1) so an
 * Admin can change them at runtime without a deploy, each request/ledger row pinning the
 * `settingsVersionId` in force at creation time. Until then, this module is the single place
 * these numbers live — do not hardcode them a second time elsewhere.
 */
export const BETA_ECONOMY_DEFAULTS = {
  /** PRD §7.2 "Signup Bonus (Beta default)" — Video Credits: 300, Creator Connects: 30. */
  SIGNUP_VIDEO_CREDITS: 300,
  SIGNUP_CONNECTS: 30,
  /** PRD §7.3 — Request Cost = 150 Credits, Creator Reward = 150 Credits (closed-loop, zero-sum). */
  REQUEST_COST_CREDITS: 150,
  CREATOR_REWARD_CREDITS: 150,
  /** PRD §7.3 — Accept Request Cost = 1 Connect. */
  ACCEPT_REQUEST_CONNECTS: 1,
  /** PRD §5.5/§7.3 — 5 free Connects/day (IST calendar day), capped so daily bonus alone never
   * pushes the balance above 50 (PRD §5.5 "[CONFIRMED — v2.1 Assumption]"). */
  DAILY_CONNECT_BONUS: 5,
  DAILY_CONNECT_BONUS_CAP: 50,
  /** PRD §7.3 — Connect refunded on successful completion by default. */
  REFUND_CONNECTS_ON_SUCCESS: true,
  /** PRD §5.15 Tipping — 10-500 Credits (Beta) or ₹10-500 (real-money), 100% to Creator, zero
   * commission in any mode, 7-day window post-Completed. */
  TIP_MIN: 10,
  TIP_MAX: 500,
  TIP_WINDOW_DAYS: 7,
  /** PRD_TRD_SUMMARY.md §5.6/§5.7 — Highest Rated acceptance mode's response window, 30-300s. */
  HIGHEST_RATED_WINDOW_SECONDS: 90,
} as const;
