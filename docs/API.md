# Locator API Documentation

Base URL: `http://localhost:4000/api` (**not** `/api/v1/` — TRD 4.2 requires versioning; this codebase has none yet, see `docs/CLAUDE.md` §2.16).

Protected endpoints require:
```http
Authorization: Bearer <jwt>
```

This document lists every route actually mounted in `src/routes/*` today (verified against `src/routes/index.ts`, `authRoutes.ts`, `adminRoutes.ts`, `requestRoutes.ts`, etc. — not the TRD's proposed list). Each section is tagged against `docs/PRD_TRD_SUMMARY.md` §5.5 (TRD Section 6 REST surface):

- ✅ **Compliant** — shape and behavior match v2.1/TRD.
- 🟡 **Partial** — endpoint exists and is on-spec in outline but has a v2.0-shaped gap (see note).
- 🔴 **Conflicts (v2.0 shape)** — implements the superseded v2.0 design; needs migration, not extension.
- ⬜ **Missing** — required by v2.1/TRD, no route exists.

---

## Auth (`/auth`) — ✅ Compliant

Matches TRD 6 Auth Module closely (phone OTP primary, email/password secondary, refresh rotation).

- `POST /auth/register`, `POST /auth/register/verify-otp` — email+password signup, email OTP-gated.
- `POST /auth/login` — email+password.
- `GET /auth/me` — protected, returns current user (now merged with rating/trust summaries — see Trust Profile section, which needs the v2.1 trust-score-removal fix, `docs/CLAUDE.md` §2.6).
- `POST /auth/phone/register/request-otp`, `POST /auth/phone/register/verify-otp` — phone OTP registration (TRD's primary path). `POST /auth/phone/login/request-otp`, `POST /auth/phone/login/verify-otp` — phone OTP login.
- `POST /auth/refresh` — refresh-token rotation (30-day opaque tokens, SHA-256 hashed in `RefreshToken`, reuse-detection revokes the whole `familyId` chain). `POST /auth/logout`.
- `POST /auth/forgot-password`, `POST /auth/forgot-password/verify-otp`, `POST /auth/reset-password`.

TRD equivalents not present: `POST /auth/otp/request`/`verify` naming differs (functionally equivalent, cosmetic). No gap of substance here.

---

## Profile (`/profile`) — 🟡 Partial

- `PUT /profile/update` — name/username/bio. **No enforcement of "username changeable exactly once"** (`User.username_changed_count` per PRD_TRD_SUMMARY.md §4.2 doesn't exist on the schema) — username can be changed unlimited times today. ⬜ gap.
- `POST /profile/upload-image` — multipart.

---

## Location Discovery (`/places`) — ⬜ Out of v2.1 scope, do not extend

`GET /places/nearby`, `/search`, `/details/:id`, `/reverse-geocode`, favorites/history CRUD. This is a standalone Google Places proxy module built on an ad-hoc request unrelated to the PRD — it is **not** the Restricted Location Engine (that's `/location/*` below) and has no analogue in TRD 6. Keep as-is; do not build v2.1 features on top of it.

## Restricted Location Engine (`/location`, `/admin/restricted-locations`) — ✅ Compliant

`GET /location/classify` (manual-list-first, Google-reverse-geocode-assist fallback, fail-safe to `PUBLIC`/`RESTRICTED` never `PROHIBITED` on the automated path); `/admin/restricted-locations` CRUD. Matches TRD 10's Restricted Location Engine design closely. `PROHIBITED` classification hard-blocks request creation.

---

## Wallet (`/wallet`) — 🟡 Dual-currency `GET /wallet` done; top-up/withdraw still real-money-only

- **`GET /wallet` (new, backend Phase 2/6, mobile-consumable, no admin role required)** — `{earnedCredits, bonusCredits, purchasedCredits, videoCredits, creatorConnects, inrBalance, realMoneyEnabled}`. `videoCredits` = earned+bonus+purchased, computed at read time. `realMoneyEnabled` mirrors `env.ENABLE_REAL_MONEY` — this is the mobile client's mode-detection signal (mobile Phase 0's previously-open gap, closed here) for branching Beta-vs-real-money wallet UI without a build-time flag. Also opportunistically grants the Daily Free Connects bonus if due today.
- `POST /wallet/create-order`, `POST /wallet/verify-payment`, `POST /wallet/withdraw` — **still real-money/INR-only**, gated behind `ENABLE_REAL_MONEY` (403 when off). Not yet currency-aware; Credits/Connects have no top-up/withdraw concept in Beta Mode by design (PRD: not purchasable, not cash-convertible, at MVP).
- `POST /wallet/webhook` — Razorpay `payment.captured`/`payment.failed`, HMAC-verified, idempotent.
- `GET /wallet/transactions` — still `Transaction`-backed (INR-only history); does not yet include `LedgerEntry` (Credits/Connects) rows. **Still missing**: a per-currency transaction history endpoint that includes Credits/Connects ledger entries — flagged, not built.
- `POST /admin/transactions/reconcile-pending` — stranded-transaction recovery.

**Still missing**: RazorpayX payout integration (payouts today are `PayoutRequest` + Admin-manual-approval only), KYC/bank-details endpoints, `POST /wallet/withdraw` behind `ENABLE_WITHDRAWAL` specifically (currently just behind `ENABLE_REAL_MONEY`). See `docs/CLAUDE.md` §2.1 and execution plan Phase 9.

---

## Requests (`/requests`) — 🟡 Partial / 🔴 state machine conflicts with v2.1

Core CRUD and the pre-fulfilment lifecycle are solid; the *state machine itself* is v2.0-shaped.

### ✅ Compliant / reusable as-is
- `POST /requests` — creation, field validation (description 10-300 chars, duration ∈ {1,2,5,10,15}, reward ₹10-2,000, category enum, instructions ≤500) matches v2.1's field table. Restricted Location Engine wired in at creation (`PROHIBITED` → `422`).
- `GET /requests/mine`, `GET /requests/:id` (owner-only), `PATCH /requests/:id` (DRAFT-only), `POST /requests/:id/cancel` (pre-acceptance only).
- `GET /requests/nearby`, `GET /requests/available` (no-GPS fallback), `GET /requests/:id/details` (creator-facing, non-owner) — Nearby Request Feed equivalent (TRD 6 Request Module `GET /feed/nearby`), missing only the 30-second-poll contract (client concern) and the acceptance-mode/reward/duration filter completeness check.
- `POST /requests/:id/accept` — Redis mutex, GPS proximity re-check at accept time, idempotent retry, correct conflict semantics. This *is* v2.1's First Accepted mode (PRD_TRD_SUMMARY.md §5.6) — keep entirely. Now also correctly debits the Creator's Connect (backend Phase 4, 2026-07-14 — see CLAUDE.md §2.3).
- `POST /requests/:id/respond`, `POST/PATCH` internal (`matchingWindowJob`) — Highest Rated acceptance mode (backend Phase 4, 2026-07-14). See CLAUDE.md §2.3 for the scoped-down-vs-TRD notes.
- `GET /requests/estimated-response-time?category=` — backend Phase 4, 2026-07-14 (CLAUDE.md §2.10).
- `POST /admin/moderation/videos/:videoId/escalate` — Escalate to Dispute Center (backend Phase 5, 2026-07-14).

### 🔴 Conflicts with v2.1 — the state machine
`RequestStatus` enum (`prisma/schema.prisma`): `DRAFT, PUBLISHED, CREATOR_ASSIGNED, TEMPORARY_CHAT, RECORDING, UPLOAD, MODERATOR_REVIEW, REQUESTER_REVIEW, RESHOOT_REQUESTED, ACCEPTED, PAYMENT_RELEASED, COMPLETED, REJECTED, DISPUTED, EXPIRED, CANCELLED`.

v2.1's required set (PRD_TRD_SUMMARY.md §4.5/§5.6): `draft, pending_moderation, published_searching, matching_window, creator_assigned, recording, upload, moderator_review, requester_review, reshoot_requested, accepted, payment_released, completed, tipping, rejected, disputed, expired, cancelled`.

Differences:
- `TEMPORARY_CHAT` must be removed — it's the superseded post-acceptance chat state (`docs/CLAUDE.md` §2.2). `CREATOR_ASSIGNED → RECORDING` should transition directly once acceptance completes (no chat state in between).
- `PENDING_MODERATION` (pre-publish request review, gated by the Moderation Toggle) does not exist — today `POST /requests` either auto-publishes or stays `DRAFT` for high-value review, with no generic "awaiting pre-publish moderation" state distinct from the high-value-only gate.
- `PUBLISHED` should become `PUBLISHED_SEARCHING` (naming-only, not fixed — cosmetic, low priority). `MATCHING_WINDOW` **now exists and is wired** (backend Phase 4, 2026-07-14) — a `HIGHEST_RATED` request transitions `PUBLISHED → MATCHING_WINDOW` on publish; see CLAUDE.md §2.3.
- `TIPPING` (optional, non-blocking, terminal — after `COMPLETED`) doesn't exist; no `tips` table (`docs/CLAUDE.md` §2.9).

### ⬜ Missing
- Pre-publish (request-level) moderation queue — `GET/POST /admin/moderation/requests` — the one remaining gap in this module, deliberately deferred (CLAUDE.md §2.4).

Estimated Response Time, Highest Rated mode/`POST /requests/:id/respond`, and `POST /requests/:id/tips` were all listed here as missing in an earlier pass — all three are now built (backend Phase 2/4, 2026-07-14); see CLAUDE.md §2.3/§2.9/§2.10.

### Lifecycle sweep (internal, no endpoint)
`requestLifecycleJob.ts`, `setInterval`-based (not `node-cron`/BullMQ, see CLAUDE.md §2.18), every 5 minutes: publishes due `SCHEDULED` requests, expires `DRAFT`/`PUBLISHED` requests past `expiresAt`. **`expiresAt` is currently computed against the v2.0 24-hour window, not v2.1's 5-hour window — verify and fix as part of the state-machine migration (CLAUDE.md §2.8).**

---

## Pre-Acceptance Query Module — ⬜ **Missing entirely**

Required by v2.1 (PRD_TRD_SUMMARY.md §4.6, §5.6): `POST /requests/:id/queries`, `POST /requests/:id/queries/:threadId/reply`, `GET /requests/:id/queries`, `POST /requests/:id/queries/:threadId/decline`. No `pre_acceptance_queries` table, no route, no service. The existing `chatContentFilter.ts` blocked-content regex chain (phone/email/social-handle/UPI/URL patterns) is directly reusable for this module's message validation — do not rewrite it, just point a new `queryService` at it.

## Temporary Chat (`/requests/:id/chat`) — 🔴 **Conflicts with v2.1, scheduled for removal/replacement**

Currently implemented exactly as described in the superseded v2.0 design: opens automatically the instant `POST /requests/:id/accept` succeeds (`status → TEMPORARY_CHAT`), closes permanently once `POST /requests/:id/recording/start` is called. Server-side content filter (`chatContentFilter.ts`) correctly blocks phone/email/social/UPI/URL patterns and persists blocked attempts for audit (`ChatMessage.blocked`/`blockReason`); 3+ blocked attempts flags `Request.chatFlaggedForReview`.

**Disposition per v2.1**: this entire chat-opens-on-accept model must be removed. Its *content-filter infrastructure* survives into two new features: (1) Pre-Acceptance Query (above), (2) **Post-Submission Chat** (below) — but the `TEMPORARY_CHAT` request-state wiring itself does not survive.

## Post-Submission Chat — ⬜ **Missing entirely** (depends on Moderation Toggle, CLAUDE.md §2.4)

v2.1 requires an informal chat between Requester and Creator once a video is in Requester Review, **only when the Moderation Toggle is OFF** (`post_submission_chat_messages` table, PRD_TRD_SUMMARY.md §4.10). Does not itself trigger a re-shoot — the Requester must explicitly tap "Request a Rework." No code exists for this; blocked by the Moderation Toggle not existing yet.

---

## Recording & Upload (`/requests/:id/recording/*`, `/requests/:id/video/*`) — 🟡 Partial

`POST /requests/:id/recording/start` (mandatory declaration checkbox), `POST /requests/:id/video/session`, `GET /requests/:id/video`, `GET /requests/:id/video/history`, `POST /requests/:id/video/:videoId/complete` (multipart upload, min/max duration validation, GPS+timestamp embed), `.../retry` (3-attempt cap), `.../cancel`, `DELETE .../:videoId`.

**Behavior matches TRD 12's pipeline semantics** (min-duration re-validation server-side, 3-retry resumable-ish handling, GPS/timestamp/duration embedded as metadata) but the **transport mechanism differs**: TRD 12 specifies client-direct-to-S3 multipart pre-signed-URL upload bypassing the API tier; this codebase uploads through the Express API tier via `multer`, which then forwards to Cloudinary (`CloudinaryVideoStorageProvider`). Storage is Cloudinary, not S3 (`docs/CLAUDE.md` §2.17) — a deliberate, documented substitution, not an oversight, but unresolved as a final decision.

On successful upload, the request **always** chains to `MODERATOR_REVIEW` — there is no Moderation-OFF branch to `REQUESTER_REVIEW` directly, because the Moderation Toggle doesn't exist (CLAUDE.md §2.4).

---

## Moderation (`/admin/moderation/*`) — 🟡 Partial

`GET /admin/moderation/videos` (FIFO queue), `/videos/history`, `/stats`, `GET /videos/:videoId` (GPS map comparison + timestamp check), `PATCH /videos/:videoId/approve`, `PATCH /videos/:videoId/reject` (mandatory reason enum matching PRD_TRD_SUMMARY.md §4.9's `moderation_decisions` taxonomy exactly: `CONTENT_VIOLATION|PROHIBITED_LOCATION|GPS_MISMATCH|DURATION_MISMATCH|FAKE_RECORDING|OTHER`), `POST .../bulk-approve`/`bulk-reject`.

**Compliant**: reject-reason taxonomy, GPS/timestamp verification data, mandatory-reason enforcement, FIFO queue ordering, Admin-can-override-Moderator (trivially true since Moderator is a JWT capability, not a separate principal — matches TRD 14's RBAC model exactly).

**Gaps**:
- No pre-publish (request-level, not video-level) moderation queue — `GET/POST /moderation/requests/queue`, `.../approve`, `.../reject` (TRD 6 Moderation Module) don't exist; only video moderation is built.
- Rejecting a video sends the request back to `RECORDING` unconditionally — v2.1's moderator-review transitions (`moderator_review → requester_review | rejected | escalated-with-dispute-row`) include a straight-to-terminal-`rejected` path and an escalate-to-dispute path that aren't wired (`POST /moderation/videos/:id/escalate` is missing).
- No Moderation Toggle to gate this module's existence at all (CLAUDE.md §2.4) — today it is unconditionally in the pipeline.

---

## Requester Review & Re-shoot (`/requests/:id/accept-video`, `/request-reshoot`, `/reject`) — ✅ Compliant in outline

One-free-re-shoot rule server-enforced (`Request.reshootUsed`), reason required on both reshoot and reject, chains through the state machine correctly for the v2.0 states it uses. Needs re-pointing at the v2.1 state names (`requester_review`/`reshoot_requested`/`accepted`) but the *business logic* (48h auto-accept guard is **missing** — no `requester_review_auto_accept` job exists at all; TRD 9 requires one every 15 min) needs building, not rewriting.

⬜ **Missing**: `requester_review_auto_accept` background job (48h auto-accept, 42h warning push) — TRD 9. Today a Requester who never reviews leaves the request stuck in `REQUESTER_REVIEW` indefinitely.

---

## Escrow & Payment Release (`/requests/:id/escrow`, `/admin/escrow/*`) — 🟡 Partial, reusable structure

`RequestEscrow` (RESERVED/RELEASED/REFUNDED/FROZEN/SPLIT), commission-rate snapshotting at reservation time (the *correct* pattern v2.1's `settings_version_id` concept should be generalized from, see CLAUDE.md §2.5), atomic `$transaction`-wrapped reserve/release/refund, Admin manual-override release/refund. This is a **genuinely reusable hold/release/split state machine** — the concept transfers directly to Beta-mode Credits holds once the amount type changes from paisa to Credits (see execution plan Phase 2). Currently real-money (`walletBalance`)-only.

⬜ **Missing**: Auto-Payout Toggle + RazorpayX (payouts land as a plain wallet credit, withdrawable only via the pre-existing `PayoutRequest` Admin-approval flow — that flow is the "Toggle OFF" path already, functionally, but the Toggle field and the "ON" branch don't exist).

---

## Ratings, Reports (`/requests/:id/rate`, `/reports`) — ✅ Compliant

Mutual ratings, direction derived server-side, one-per-participant enforced by DB constraint, no edit/delete path. Reports: exact v2.1 category taxonomy (`PRIVACY_ISSUE|WRONG_LOCATION|ABUSE|FAKE_RECORDING|COPYRIGHT|OTHER`), duplicate-prevented, 3-in-30-days → suspend-recommendation flag (matches v2.1's "auto-suspend pending review" phrasing — an Admin still acts on the flag, which is the correct MVP posture per PRD_TRD_SUMMARY.md §5.10's flag-and-review policy).

🟡 **Gap**: Rating visibility does not implement v2.1's **double-blind reveal** rule (visible once both submit, or after 7 days — PRD_TRD_SUMMARY.md §4.11 `ratings.visible_at`). `GET /requests/:id/rating` currently returns both rows unconditionally to either participant as soon as either exists.

---

## Trust Profile (`/trust-profile/*`, `/admin/trust-profiles/*`) — 🔴 Conflicts with v2.1

`GET /trust-profile/me`, `GET /trust-profile/:userId` return a composite **0-100 Trust Score** and 5 named badges to end users. **v2.1 explicitly removes Trust Score from MVP user-facing display** (`docs/CLAUDE.md` §2.6) — this must be stripped from every response reachable by a `User`-namespace JWT (`GET /auth/me`, `GET /trust-profile/*`, `GET /requests/:id`, `GET /requests/nearby`, etc.), while the underlying individual data points (rating, completion %, cancellation %, response rate, account age, report count) stay and are exactly what v2.1 wants displayed instead.

`Verified Creator Badge` (`User.isVerified`) is manual-Admin-toggle-only; v2.1 requires auto-award/revoke/reinstate logic keyed off `completed_count`/rating (CLAUDE.md §2.7) — currently missing.

---

## Dispute Center (`/disputes/*`, `/admin/disputes/*`) — ✅ Structurally compliant, triggers need updating

Delta-based resolution against a money snapshot taken at dispute-creation time (correctly reverses an already-`COMPLETED`/paid-out or already-`REJECTED`/refunded request, not just a still-frozen one) — this is a sound arbitration engine, matches TRD's spirit even where TRD doesn't specify implementation detail this precisely. Evidence upload, case-owner assignment, internal notes, full audit trail via `AdminAuditLog` all present.

🟡 **Gap**: no SLA tracking against v2.1's "first Admin decision within 24h" requirement (PRD_TRD_SUMMARY.md §4.14) — no due-date field, no queue-depth alert tied to dispute age specifically (only overall queue-depth alerting exists, `monitoringJob.ts`). Which request statuses can raise a dispute needs re-deriving once the state machine changes (§ above).

---

## Admin Dashboard, Live Monitoring, Active Requests (`/admin/dashboard*`) — ✅ Compliant in outline

KPI tiles, per-status live counts, active-request list — matches PRD_TRD_SUMMARY.md §6.1 items 1-3 in spirit. Tile set will need updating once new states (`matching_window`, `pending_moderation`, `tipping`) and new KPIs (Credits Issued/Redeemed Today, Connects Spent Today) exist.

## Commission Settings — 🟡 Partial, see CLAUDE.md §2.5
`COMMISSION_RATE_PERCENT` lives on `ComplianceConfig`, correctly snapshotted onto `RequestEscrow` at reservation time. Needs to become one key among many on the unified Feature Flags / Economy Settings surface, not a standalone key.

## Feature Flags / Economy Settings — ⬜ **Missing entirely.** See `docs/CLAUDE.md` §2.5.

## Audit Logs (`/admin/audit-logs`) — ✅ Compliant, directly reusable as v2.1's `audit_log` table foundation.

## Notifications (`/notifications/*`) — ✅ Compliant, extend with new v2.1 event types (query received/answered, tip received, moderation-toggle-changed, matching-window-opened/closed) as those features are built.

## Compliance, Consent, Privacy, Data Retention (`/consent/*`, `/privacy/*`, `/account/*`, `/admin/compliance/*`) — ✅ Compliant

Consent capture/versioning, retention sweep jobs, account deletion (soft delete + grace period + irreversible-anonymization hard delete), data export. Retention *windows* (2h fulfilled-video, 24h terminal-video, 90-day chat/query, 7-year transaction/ledger, 3-year moderation-decision) are unchanged between v2.0 and v2.1 per PRD_TRD_SUMMARY.md §8.5 — no migration needed here, just re-point the chat-purge job at the new Pre-Acceptance Query / Post-Submission Chat tables once they exist instead of (or alongside) `ChatMessage`.

---

## Admin Auth & general Admin (`/admin/auth/*`, `/admin/users/*`, `/admin/transactions/*`, `/admin/payouts/*`) — ✅ Compliant

Separate `Admin` JWT namespace, Moderator modelled as an Admin-namespace capability (not a third principal) — matches TRD 14/PRD Section 3's explicit "one Admin Panel, RBAC, not two systems" correction from v2.0. User block/suspicious toggle, transaction list/export/reconcile, payout list/process (manual-approval-only, no Auto-Payout Toggle branch).

---

## Error Shape

```json
{
  "success": false,
  "message": "Validation failed.",
  "details": []
}
```

No change needed here — compatible with TRD 4.2's RFC7807-style intent even though field names differ (`error_code` vs `message`/`details`); low-priority cosmetic alignment, not a functional gap.
