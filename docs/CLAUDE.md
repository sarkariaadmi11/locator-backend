# Locator Backend — Development Guide

**Source of truth: `../../docs/PRD_TRD_SUMMARY.md`** (consolidated summary of PRD v2.1 + TRD — read that file in full before making product-behavior decisions here). Full source texts: `../../docs/Locator_App_PRD_v2.1.md` (PRD v2.1, "Final — Ready for Development", July 2026) and `../../docs/Locator_App_TRD.txt` (TRD, "Draft — Ready for Engineering Review"), plus a formatted copy at `../../docs/Locator_App_PRD_v2.1.md`.

**PRD v2.0 (`Locator_App_PRD_v4.pdf`) is superseded and must not be treated as authoritative for anything.** The previous revision of this file cited v2.0 as source of truth; that was correct at the time it was written but is now stale. Where this document and `PRD_TRD_SUMMARY.md` ever disagree, the summary (and the v2.1/TRD source texts behind it) wins — update this file, not the other way around.

This file has two halves:
1. **What Locator Actually Is** and the backend's module boundaries, per v2.1/TRD.
2. **Current Implementation vs v2.1 Spec** — an honest, file-referenced audit of what exists in `locator-backend/src` today against that spec. The codebase is **not** a blank scaffold — it is a mature, largely-complete implementation of a **different, superseded design (v2.0)**. Read this section as "what must migrate," not "what must be built from zero."

---

# 0. What Locator Actually Is (per PRD v2.1)

> A **Requester** posts a request for a live video to be captured from a specific GPS location. A nearby **Creator** fulfils it by recording live (in-app camera only, no gallery uploads) from that exact location. The Creator may ask the Requester up to 3 short clarifying questions **before** accepting (Pre-Acceptance Query) — there is no chat after acceptance in the default (Moderation ON) path. The video is manually moderated by default — an Admin-controlled **Moderation Toggle** can disable this, in which case an informal **Post-Submission Chat** opens instead. Value moves through a **dual-currency, non-cash Beta economy by default** (Locator Credits spent by Requesters, Locator Connects spent by Creators) — the full INR real-money economy (Razorpay top-up → escrow → RazorpayX payout, 15% commission) is fully built into the same codebase and switched on later via `ENABLE_REAL_MONEY`, with no re-architecture.

Two load-bearing facts every engineer on this codebase must internalize before touching the Request/Wallet/Moderation modules:

1. **Beta Mode is the default launch mode, not real money.** Every "wallet debit," "escrow reservation," "payout" concept in the existing v2.0-era code was built real-money-only (`User.walletBalance: Decimal`, `Transaction` CREDIT/DEBIT in rupees, `RequestEscrow` in rupees). None of that is wrong forever — it's the `ENABLE_REAL_MONEY=true` path — but it cannot be the *only* path, and today it is.
2. **Chat before acceptance, not after.** v2.1 replaced v2.0's post-acceptance `TEMPORARY_CHAT` entirely with a **Pre-Acceptance Query** (Creator↔Requester Q&A, max 3 exchanges of ≤200 chars, happens *before* the Creator commits a Connect and locks the request) plus, only when Moderation is OFF, an unrelated **Post-Submission Chat** on the video-review screen. The `ChatMessage`/`TEMPORARY_CHAT` model in this codebase today is the old, superseded design and is the single largest state-machine migration this backend needs.

**Both roles live on one account** — no separate Creator/Requester signup (already correctly modelled: `User.requestsCreated`/`requestsFulfilled`).

---

# 1. Backend Module Boundaries (TRD 4.1 / PRD_TRD_SUMMARY.md §5.1)

Modular monolith, Node.js + Express, **not** microservices — internal modules talk through TypeScript service classes, never HTTP, so ledger-writing code stays singular and auditable. Target module list: `AuthModule, UserModule, WalletModule, RequestModule, QueryModule, AcceptanceModule, RecordingModule, ModerationModule, ReviewModule, RatingModule, ReportModule, GeoModule, NotificationModule, SettingsModule, AdminModule, AuditModule`.

Mapping onto this codebase's actual `src/services/*` today (module → current file(s), or "missing"):

| TRD module | Current implementation |
|---|---|
| AuthModule | `authService.ts` (phone OTP + email/password, JWT + refresh rotation) — solid |
| UserModule | `profileService.ts`, `trustScoreService.ts` (needs de-scoping, see §2.6) |
| WalletModule | `walletService.ts`, `transactionRepository.ts` — real-money only, needs Credits/Connects (see §2.1) |
| RequestModule | `requestService.ts`, `requestStateMachine.ts`, `requestLifecycleJob.ts` |
| QueryModule (Pre-Acceptance Query) | **missing** — `chatService.ts`/`ChatMessage` is the old post-acceptance model instead (see §2.2) |
| AcceptanceModule | `creatorLockService.ts`, part of `requestService.ts` (First Accepted only, see §2.3) |
| RecordingModule | `recordingService.ts`, `src/services/storage/*` (Cloudinary, not S3 — see §2.7) |
| ModerationModule | `moderationService.ts` — always-on, no Moderation Toggle (see §2.4) |
| ReviewModule | `requesterReviewService.ts` |
| RatingModule | `ratingService.ts` |
| ReportModule | `reportService.ts` |
| GeoModule | `locationCategoryService.ts`, `restrictedLocationService.ts`, `creatorMatchingService.ts`, `geo.ts` — solid |
| NotificationModule | `notificationService.ts`, `notificationTypes.ts`, `fcmService.ts` — solid, needs new v2.1 event types |
| SettingsModule | `complianceConfigService.ts` — retention/consent/commission only, not the v2.1 economy/feature-flag surface (see §2.5) |
| AdminModule | `adminService.ts` + the `admin*Controller.ts` family — solid RBAC pattern, extend |
| AuditModule | `adminAuditLogService.ts`, `AdminAuditLog` — solid, reusable as-is |

---

# 2. Current Implementation vs v2.1 Spec — Concrete Gaps

Every gap below cites the exact file(s)/model(s) involved. "Conflicts" = implements the *superseded v2.0 design* and must be migrated, not merely extended. "Missing" = no code exists at all.

## 2.1 Wallet economy — **RESOLVED** (backend Phase 2, complete 2026-07-14)
`User` now carries `earnedCredits`/`bonusCredits`/`purchasedCredits`/`creatorConnects`/`lastDailyConnectGrantDate` alongside the untouched `walletBalance` (INR, not migrated to paisa — see Phase 1 item 2's note on why that conversion was deferred). `LedgerEntry` is the new append-only table with the full `LedgerReasonCode` taxonomy, written exclusively through `ledgerService.ts` (guarded `updateMany` per-currency, bonus→purchased→earned spend order, idempotency-key replay safety). `ENABLE_REAL_MONEY` (`src/config/env.ts`, default `false`, i.e. **Beta/Credits mode is the default**) gates `walletService.createOrder`/`verifyPayment`/`withdraw`. Signup bonus (300 Credits/30 Connects) and the Daily Free Connects grant (5/day, capped at 50) are wired and tested. `RequestEscrow.currency` (`CREDIT|INR`) makes `escrowService.reserve/release/refund` currency-aware, and `requestService.create` derives `currencyMode` from `ENABLE_REAL_MONEY` — a Beta-mode request now creates, gets fulfilled, and pays out end-to-end through `ledgerService`, verified by `src/services/__tests__/{ledger,tip,escrowCredit}.integration.test.ts`.

**Known remaining gap:** `disputeService.resolve`'s delta-based split-settlement math is still INR/`walletBalance`-only — a dispute raised against a CREDIT-mode request would currently misbehave (money-movement math assumes rupees). Not fixed in Phase 2 (disputes are Phase 11 territory); revisit when disputes are next touched.

## 2.2 Chat model — **RESOLVED** (backend Phase 4, 2026-07-14)
`queryService.ts` + `POST/GET /requests/:id/queries` (+ `/reply`, `/decline`) implement Pre-Acceptance Query per PRD_TRD_SUMMARY.md §4.6: a Creator asks ≤3 questions of ≤200 chars **before** accepting, doesn't lock the request, reuses `chatContentFilter.ts`. `requestService.accept` no longer chains through `TEMPORARY_CHAT` — it closes all open query threads directly from `CREATOR_ASSIGNED` via `queryService.closeAllForRequest`. The old `ChatMessage`/`TEMPORARY_CHAT` code (`chatService.ts`, `/requests/:id/chat` routes) is left in place but orphaned — no new row can reach `TEMPORARY_CHAT` anymore, so it's unreachable dead code, not a maintained parallel system; safe to delete outright in a later cleanup pass.

**Still open:** v2.1's **Post-Submission Chat** (only active when Moderation Toggle is OFF, lives on the video-review screen) is a different, still-nonexistent feature — depends on Phase 5's Moderation Toggle to ever become reachable. `post_submission_chat_messages` table already exists (Phase 1); no service built on it yet.

## 2.3 Acceptance Mode — **RESOLVED** (backend Phase 4, 2026-07-14)
`creatorLockService.ts` still implements First Accepted (Redis `SET NX PX` mutex, 15-min timer) per v2.1 §5.5/TRD 8.1, now with a previously-missing fix: it actually debits the Creator's Connect on Accept (`ledgerService.debitConnects`, reason `ACCEPT_SPEND`) — this was schema/settings-only before this pass despite `SettingsKey.ACCEPT_REQUEST_CONNECTS` existing since Phase 6. **Highest Rated Creator** mode is now built: `matchingWindowService.ts`/`matchingWindowJob.ts`, `POST /requests/:id/respond`, `Request.acceptanceMode`/`matchingWindowClosesAt` actually read/written by `requestService.create`. **Scoped down from the TRD's exact design in one way**: responses go straight to Postgres (`MatchingWindowResponse`) instead of a Redis sorted-set reservation during the window — still correct (no premature `LedgerEntry` write, which is the invariant that actually matters), just not the Redis-first optimization TRD 7.2.1 describes. Window-close is a 15s `setInterval` sweep (`matchingWindowJob`), not a BullMQ delayed job — see §2.18 below, still an open scheduler decision, same tradeoff every other sweep job here already makes.

## 2.4 Moderation Toggle — **RESOLVED for video moderation; request-level still open** (backend Phase 5, 2026-07-14)
`settingsService.ts` (new, on top of Phase 1's `PlatformSetting`/`PlatformSettingVersion`) + `GET/PATCH /admin/settings/moderation-toggle`. `recordingService.completeUpload` now branches `UPLOAD → MODERATOR_REVIEW` (ON) vs `UPLOAD → REQUESTER_REVIEW` directly (OFF). Post-Submission Chat (`postSubmissionChatService.ts`) is wired to this same toggle. **Escalate-to-Dispute is now built** (2026-07-14): `POST /admin/moderation/videos/:videoId/escalate` (`disputeService.adminEscalate`) freezes escrow and opens a Dispute case attributed to the Requester with `raisedByRole: 'ADMIN'`, `caseOwnerAdmin` pre-assigned to the escalating staff member. **Still missing:** the pre-publish (request-level) moderation gate — `requestService.create` still always publishes directly; there's no `GET/POST /admin/moderation/requests` queue for it to gate. That's the one remaining item, tracked in `MASTER_EXECUTION_PLAN.md` Phase 5 items 2/5, deliberately deferred (genuinely net-new surface, not a quick follow-on).

## 2.5 Feature Flags / Economy Settings admin surface — **MOSTLY RESOLVED** (backend Phase 6, 2026-07-14)
`settingsService.ts` (new, on top of Phase 1's `PlatformSetting`/`PlatformSettingVersion`, Redis-cached read-through with a fast-fail-on-Redis-down path) now covers every economy value key (`REQUEST_COST_CREDITS`, `ACCEPT_REQUEST_CONNECTS`, `CREATOR_REWARD_CREDITS`, `SIGNUP_VIDEO_CREDITS`, `SIGNUP_CONNECTS`, `DAILY_CONNECT_BONUS`(_CAP), `TIP_MIN`/`TIP_MAX`/`TIP_WINDOW_DAYS`, `VIDEO_CREDIT_VALUE_INR`, `CREATOR_CONNECT_VALUE_INR`) and all 6 wired-but-inactive feature flags, plus `GET/PATCH /admin/settings`. The economy keys are actually wired into the code that used to hardcode them (`ledgerService`, `escrowService.reserve`, `requestService.create`, `tipService`) — this isn't just a settings table nobody reads.

**Still open:** `ComplianceConfig` remains a separate, un-consolidated mechanism (not migrated into `PlatformSetting`); operational timers (proximity radius, acceptance timer, request expiry hours, high-value threshold) are still hardcoded/env-var, not in `settingsService`; no Launch-Stage Presets; `settingsVersionId` is not yet generalized onto every request/ledger write beyond the one column that already exists on `Request` from Phase 1.

## 2.6 Trust Score shown to users — **RESOLVED** (backend Phase 7, 2026-07-14)
`trustScoreService.getUserFacingProfile()` strips the composite `trustScore` before it reaches any `User`-namespace endpoint — wired into `GET /trust-profile/me`/`:userId`, `GET /auth/me`, `GET /requests/:id`'s embedded trust summaries, and the Creator Discovery feed. Individual badges (Verified Creator, Top Creator, etc.) and every underlying data point (rating, completion %, cancellation %, response rate, account age) are kept — those ARE the v2.1 Trust Profile, not scope to remove. `trustScoreService.getProfile()` (unstripped) still exists for Admin surfaces and internal change-detection bookkeeping — never call it from a `User`-namespace controller. The "Your Trust Score is now X" notification was removed entirely.

## 2.7 Verified Creator Badge — **RESOLVED** (backend Phase 7, 2026-07-14)
New `verifiedCreatorService.evaluate()`, event-driven from `requesterReviewService.acceptVideo` (every Completed transition) and `ratingService.rate` (every new Creator-directed rating) — auto-award at a configurable completed-count threshold (default 50), auto-revoke on suspension or a rolling-window average rating below a configurable minimum (default 3.5 over the last 20), auto-reinstate when the condition clears. Backed by the `VerifiedCreatorStatus` table (Phase 1); `User.isVerified` kept in sync as the read-optimized boolean every existing consumer already expects.

## 2.8 Request expiry — **CONFLICTS with v2.1**
Every doc/comment in this codebase (the prior `CLAUDE.md`, `MASTER_EXECUTION_PLAN.md`, `API.md`) states Immediate requests expire after **24 hours**, matching v2.0. v2.1 changed this to **5 hours** for Immediate requests (all 24-hour references explicitly removed, PRD_TRD_SUMMARY.md §10 item 5), admin-configurable, and Scheduled requests now require a **minimum 4-hour** lead time (was 30 minutes in v2.0) with a 2-4h configurable acceptance-window-open offset. `requestLifecycleJob.ts`'s actual hardcoded/env-driven expiry constant needs verification and correction as part of the migration (see execution plan Phase 3).

## 2.9 Tipping — **RESOLVED** (backend Phase 2, 2026-07-14)
`tipService.ts` + `POST/GET /requests/:id/tips`. 10-500 Credits or ₹10-500 depending on `request.currencyMode`, 100% to Creator, zero commission in any mode, 7-day window from `requesterDecisionAt`, one tip per request (`Tip.requestId` unique). Tested end-to-end in both currency branches (`src/services/__tests__/tip.integration.test.ts`).

## 2.10 Estimated Response Time — **RESOLVED** (backend Phase 4, 2026-07-14)
`GET /requests/estimated-response-time?category=` — `requestService.estimatedResponseTimeMinutes`, averages the last 50 accepted requests in the same category (`acceptedAt - requesterDeclarationAt`), falls back to a fixed 5-minute default with `isEstimate: true` when fewer than 5 samples exist (new category, or early Beta launch). **Scoped-down versus a fully location-aware estimate** — no per-city/per-radius breakdown, category-level global average only; flagged as a deliberate v1 simplification, not an oversight.

## 2.11 Network Quality Indicator — **N/A to backend**
Purely client-side (pre-recording bandwidth probe); no backend work implied beyond leaving `duration_seconds`/upload validation as-is. Not a gap.

## 2.12 Public identity model (`@username`-only) — **NEEDS VERIFICATION, LIKELY PARTIAL**
v2.1 §10 item 1 requires `@username` as the *sole* public-facing identifier everywhere a user is visible to another user; `full_name` must never appear on any endpoint another user can read (Admin/KYC-view only). `User.name` exists as a plain field with no visibility gating built around it — several presenters (e.g. `GET /admin/dashboard/active-requests`'s `{id, name, username}`) intentionally expose it to Admins, which is correct, but there has been no systematic audit of every participant-facing payload (`requestPresenter`, `ratingPresenter`, `disputePresenter`, notification payloads) to confirm `name` never leaks to the *other party* in a transaction. Treat as an explicit audit item, not a confirmed pass.

## 2.13 KYC / bank details — **SCHEMA DONE, FLOW MISSING**
`bankAccountNumber`/`bankIfsc`/`kycStatus` fields exist on `User` since Phase 1 (schema-only — no encryption, no endpoints). Still no `PUT /users/me/bank-details`, no full-KYC-at-₹50k-trigger. Required before v2.1's real-money withdrawal path can exist; not required for Beta launch. Low priority until `ENABLE_REAL_MONEY`/`ENABLE_WITHDRAWAL` are being built out (Phase 9).

## 2.14 GPS spoofing / mock-location — **RESOLVED (server-side check)** (backend Phase 8, 2026-07-14)
`gpsSpoofingService.ts` — server-side impossible-velocity check between consecutive GPS reads, wired at accept-time and upload-complete. Flag-and-queue only (Admin FCM alert), never auto-block, per v2.1's explicit policy. **Still missing**: client-side mock-location detection itself (Android `isFromMockProvider()`/iOS jailbreak heuristics) is a mobile-side item (mobile Phase 7), not backend's to build — this section only ever covered the backend's server-side velocity check.

## 2.15 Idempotency-Key header — **RESOLVED** (backend Phase 8, 2026-07-14)
`src/middlewares/idempotency.ts` — generic `Idempotency-Key` middleware, Redis-backed `{key -> response}`, 24h TTL, fails open if Redis is unreachable. Wired onto every wallet mutation and the highest-risk request-state-mutating routes (create/accept/cancel/tips).

## 2.16 API versioning — **CONFLICTS with TRD convention**
Base URL is `http://localhost:4000/api` (see `src/routes/index.ts`, mounted with no `/v1/` segment). TRD 4.2 requires every endpoint under `/api/v1/`. Low-risk, high-churn rename — coordinate with mobile before changing.

## 2.17 Video storage: Cloudinary, not S3 — **DOCUMENTED DEVIATION, not necessarily a defect**
`src/services/storage/IVideoStorageProvider.ts` cleanly abstracts storage; `CloudinaryVideoStorageProvider.ts` is the only implementation. TRD specifies AWS S3 with private bucket, multipart pre-signed-URL direct-to-S3 upload, and lifecycle-rule-based retention as a defense-in-depth backstop. The abstraction makes an `S3VideoStorageProvider` a bounded addition, not a rewrite — but today's upload path (multipart form to the API tier, which then forwards to Cloudinary) does not match TRD 12's "client uploads parts directly to S3, bypassing the API tier" performance/cost design. Flag for a deliberate decision (keep Cloudinary vs. migrate to S3) rather than silently carrying it forward — see execution plan Phase 0.

## 2.18 Job scheduling: `setInterval`, not BullMQ/node-cron — **DEVIATION**
Every "background job" in this codebase (`requestLifecycleJob`, `acceptanceTimerJob`, `retentionJob`, `notificationReminderJob`, `monitoringJob`) is a plain `setInterval` loop started in `src/server.ts`, not `node-cron` (TRD wants node-cron for fixed-interval sweeps) or BullMQ (TRD wants BullMQ specifically for per-request delayed jobs like `matching_window_close` and the promotional-preset revert). This works for fixed-interval sweeps but has no mechanism for a **per-request delayed job**, which the new Highest Rated matching window (§2.3) and settings-preset revert require. `ioredis` is already installed, making BullMQ a low-friction addition.

## 2.19 What is genuinely solid and should NOT be rewritten
To be explicit about what to keep, since a wholesale-rewrite instinct would waste real work:
- **Auth**: phone OTP (primary) + email/password (secondary), JWT 24h access / 30d refresh with rotation-on-use and hashed-in-DB refresh tokens (`RefreshToken` model) — matches TRD 11 exactly.
- **Redis mutex** (`creatorLockService.ts`) — matches TRD 8.1's pseudocode almost verbatim (SET NX PX, compare-and-delete release via Lua, force-release on timer sweep).
- **Restricted Location Engine** (`locationCategoryService.ts`, `RestrictedLocation` model) — manual-list-first, Google-assist-fallback, fail-safe-to-non-PROHIBITED-on-API-failure pattern matches TRD 10 closely.
- **GPS proximity check** (`geo.ts#haversineMeters`, 500m default, admin-configurable) — matches spec.
- **Dispute Center** (`Dispute`/`DisputeMessage`/`DisputeEvidence`, delta-based resolution against a money snapshot) — structurally sound arbitration engine; only its *triggers* (which statuses can raise a dispute) need updating once the state machine changes.
- **Notification architecture** (`notificationService.ts` as sole `fcmService` caller, type/category matrix, safety-critical bypass) — matches TRD 13's event-bus-after-commit pattern; needs new event types for query/tip/moderation-toggle/highest-rated, not a redesign.
- **Admin Audit Log** (`AdminAuditLog`, immutable, insert-only) — directly reusable as (part of) the v2.1 `audit_log` table.
- **Compliance/consent/retention machinery** (`ConsentRecord`, `ComplianceConfig`, `retentionJob.ts`, `DataDeletionLog`) — matches PRD §9/TRD 12.3 closely; retention *numbers* need re-confirming against v2.1 (unchanged from v2.0 in this area per the summary) but the mechanism is right.

---

For the concrete, sequenced migration plan derived from this audit, see [MASTER_EXECUTION_PLAN.md](./MASTER_EXECUTION_PLAN.md). For the current endpoint-by-endpoint compliance status, see [API.md](./API.md).
