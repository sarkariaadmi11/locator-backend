# Locator Backend — Master Execution Plan

**Strictly derived from `Locator_App_PRD_v4.pdf` (Unified MVP PRD v2.0, Phase 1).** This replaces all prior execution-plan content (the earlier "Location Discovery" plan tracked here was for a feature outside this PRD's scope — see `docs/CLAUDE.md` §6 "Out of PRD scope"). Every phase below cites the PRD section(s) it implements. Do not add scope that isn't traceable to a PRD section.

This plan assumes the existing generic scaffold (auth, wallet ledger, admin shell, notifications, profile) documented in `docs/CLAUDE.md` §6 "Reusable as foundation" stays in place and is extended, not rewritten.

---

## Phase 0 — Decisions, Infra Provisioning, Open Questions (blocking, do first)

**PRD refs:** §1.3, §12.2, §12.3, tagging key.

The PRD explicitly tags a number of values `[REVIEW]` — meaning "must be confirmed before development begins." Do not proceed past Phase 1 on any item below without either a client answer or an explicit interim decision documented in `docs/CLAUDE.md` §7.

- [ ] Confirm: proximity radius (default assumption: 500m), request expiry window (24h), acceptance timer (suggested 15 min), re-shoot window (suggested 24h), platform commission (15%), high-value review threshold (₹1,000), chat/video/moderation-log retention windows.
- [ ] Confirm RazorpayX feasibility, payout charges, commission structure (§1.3, §5.2.1).
- [x] Restricted Location Engine implemented (2026-07-01): manual admin-curated list (`RestrictedLocation` model + `/admin/restricted-locations` CRUD) always wins; if no manual match and `GOOGLE_PLACES_API_KEY` is set, a Google reverse-geocode keyword check is used as a best-effort assist via the same `locationCategoryService.classify()` interface — usable today via `GET /location/classify`, and the exact call Phase 2's `POST /requests` will make once it exists. **Interim decision, flag to client**: Google's assist only ever yields `PUBLIC`/`RESTRICTED`, never `PROHIBITED` — hard blocks remain manual-list-only to avoid false-positive auto-blocking. See `docs/API.md` "Restricted Location Engine".
- [x] Provision: Redis instance (Creator mutex lock — §5.5, §12.2) — done 2026-07-03 (local Docker `redis:7-alpine` for dev; `REDIS_URL` in `.env`/`.env.example`, `src/config/redis.ts`). Still open: AWS S3 bucket for ephemeral video (§12.2), SMS/OTP gateway account (MSG91/Twilio — primary phone-OTP channel, §3.1/§5.1.1), RazorpayX merchant setup, WebRTC/managed streaming service selection (§12.2, §14 — "finalise before Week 3").
- [ ] Decide Moderator implementation: a role/capability flag on the existing `Admin` model (recommended, matches §3.1 "Moderator is a role/view within the Admin panel — not a separate portal or system account") vs. a new table. Do not build a third JWT namespace.

**Exit criteria:** infra credentials in `.env` (validated via `config/env.ts`), open numeric questions have interim values documented, Moderator model decided.

---

## Phase 1 — Data Model & State Machine Foundation

**PRD refs:** §5.13 (state machine, exact 15 states), §2, §5.2–§5.10, §9.1.

1. [x] Prisma migration: `Request` model with the full state enum and transition-relevant timestamp fields (2026-07-01, migration `add_request_domain`). Do not add convenience states not in the PRD's table.
2. [ ] `RequestEscrow` — **not built** (out of scope for the Request-domain pass; needs its own phase — see Phase 8). `Request` stores `rewardAmount`/`highValueReviewRequired` but no wallet debit happens on creation yet.
3. [ ] `RequestVideo`, `RequestChat`/`ChatMessage`, `Rating`, `Report`, `Dispute`, `ConsentRecord`, `AdminAuditLog` — still not built. `RestrictedLocation` was already done in Phase 0.
4. [ ] Extend `User`: trust-score badge field, KYC fields, consecutive-rejection counter — not done.
5. [ ] Extend `PayoutRequest`: `viaRazorpayX`, `autoPayoutSnapshot` — not done.
6. [x] Pure state-machine module: `src/services/requestStateMachine.ts` (2026-07-01). Encodes all 15 PRD §5.13 states as data (`assertTransition`/`canTransition`/`getValidNextStatuses`). **Caveat:** the exact PRD §5.13 transition table PDF was not available in the environment this was built in — the table was reconstructed from the CLAUDE.md/MASTER_EXECUTION_PLAN.md lifecycle narrative and should be diffed against the source PRD before Phase 3+ starts wiring the transitions this phase doesn't exercise (`CREATOR_ASSIGNED`, `TEMPORARY_CHAT`, `RECORDING`, etc.).

**Exit criteria:** ~~migrations applied~~ done for `Request`/enums only (escrow/chat/video/rating/report/dispute/consent/audit-log models remain Phase 1 follow-up work); state machine module has a transition table (pending PRD-PDF diff per the caveat above), and is unit-tested indirectly via `assertTransition` throwing on every endpoint call — a dedicated no-DB assertion script is still TODO.

---

## Phase 2 — Request Creation & Basic Lifecycle

**PRD refs:** §4.2, §4.3, §5.3, §7.3, §8.1 (creation-adjacent notifications).

**Status: done except escrow/high-value-admin-queue/notifications (2026-07-01).** Built as part of the same pass as Phase 1 above, deliberately excluding escrow/chat/Creator-matching/recording per an explicit scope cut for this build — see `src/services/requestService.ts`, `src/controllers/requestController.ts`, `src/routes/requestRoutes.ts`, `src/validations/requestValidation.ts`, `src/repositories/requestRepository.ts`.

1. [x] `POST /requests` — field validation per §5.3.1 (description 10-300, duration ∈ {1,2,5,10,15}, reward ₹10-2000, category enum, instructions ≤500). Supports `IMMEDIATE` (auto-publishes unless high-value) and `SCHEDULED` (stays `DRAFT` until `scheduledAt`, published by the lifecycle sweep).
2. [x] Location categorization at creation time — wired to the existing `locationCategoryService.classify(lat, lng)` (Phase 0). `PROHIBITED` → `422` hard block. `RESTRICTED` → stored and allowed, but the "Admin flag" queue itself is not built (no moderation queue exists yet — Phase 6).
3. [ ] Escrow reservation on creation — **not built**, `RequestEscrow` doesn't exist (see Phase 1 note above; deferred to Phase 8 by explicit scope decision, not an oversight).
4. [x] High-value flag (reward ≥ ₹1,000) computed and stored (`highValueReviewRequired`); request is kept `DRAFT` instead of auto-publishing. [ ] The actual mandatory-Admin-review queue/action is not built (Phase 6).
5. [ ] Requester declaration capture → `ConsentRecord` row — **not built** (`ConsentRecord` model doesn't exist yet); the boolean is validated at the API boundary and `requesterDeclarationAt` is stamped on the `Request` row itself as an interim substitute.
6. [x] Scheduled job: `src/services/requestLifecycleJob.ts`, run via `setInterval` every 5 minutes from `src/server.ts` (no job-queue lib in this stack). Publishes due `SCHEDULED` requests and expires `DRAFT`/`PUBLISHED` requests past `expiresAt`. **Auto-refund is not wired** (no escrow to refund yet) — only the `status → EXPIRED` transition happens.
7. [x] `POST /requests/:id/cancel` — pre-acceptance only (`DRAFT`/`PUBLISHED`), no penalty. **No refund** (no escrow yet).
8. [x] `GET /requests/mine` — Requester's own requests, paginated, optional `status` filter.

Also built, not originally itemized here: `GET /requests/:id` (owner-only detail) and `PATCH /requests/:id` (DRAFT-only field edits) for CRUD completeness.

**Exit criteria:** a Requester can create, view, edit (while DRAFT), and cancel a request; prohibited locations blocked; restricted locations flagged and stored. Escrow reserve/refund is intentionally **not** met by this pass — tracked as the Phase 1/2 remainder above, to be picked up when the escrow domain is built (Phase 8, or pulled forward if the client wants escrow ahead of Chat/Creator-matching).

---

## Phase 3 — Discovery & Fulfilment (Creator side)

**PRD refs:** §5.5, §5.11, §4.4, §8.1.

**Status: Discovery half done (2026-07-03), Fulfilment half done (2026-07-03).** Built
as `src/services/creatorMatchingService.ts` (eligibility/visibility/ordering — no matching
logic in controllers, per `docs/CLAUDE.md`), `src/services/creatorService.ts`
(location/status/dashboard), `src/repositories/{requestRepository,userRepository}.ts`
discovery query additions, `src/utils/geo.ts#boundingBox`. See `docs/API.md` "Creator
Discovery & Matching", "Request Acceptance & Fulfilment", and "Creator Profile" for the exact
endpoint shapes.

1. [x] `GET /requests/nearby` — proximity query (radius 100-2000m, default 500m per PRD) around the Creator's current location (passed as query params, not stored-location — the Creator can query any point), filtered to `PUBLISHED` status only (excludes DRAFT and CREATOR_ASSIGNED+ — those are already locked), sorted nearest-first, with category/reward-range/type filters (§5.11.1–§5.11.2). Haversine-over-bounding-box (`src/utils/geo.ts`), not PostGIS — sufficient at MVP scale per this file's original note.
   - [x] `GET /requests/available` — no-GPS fallback feed (same filters, newest-first, no distance) — PRD §5.11.1's fallback case, not itemized in this plan originally but required by the mobile spec (`locator-mobile/docs/CLAUDE.md` §1 "Falls back to city-filtered results if GPS permission denied").
   - [x] `GET /requests/:id/details` — Creator-facing detail view (any authenticated user, non-DRAFT only) — not itemized originally but required so the mobile Request Detail screen has a non-owner-gated endpoint to call (`GET /requests/:id` is owner-only).
2. [x] `PATCH /creator/location`, `PATCH /creator/status` (`ONLINE`/`OFFLINE`/`BUSY` — new `User.availabilityStatus` field), `GET /creator/dashboard` (extended 2026-07-03 with `activeRequest`, `acceptanceCountdownSeconds`, `pendingRequests` preview, `acceptedRequests`). Only `ONLINE` creators are matched by `creatorMatchingService`'s reverse lookup.
3. [x] Push broadcast on publish (§8.1 "New Request Near You") — wired 2026-07-03 into both `requestService.create`'s immediate-publish path and `requestLifecycleJob.publishDueScheduled`, via `creatorMatchingService.findEligibleCreatorsForRequest()` + `fcmService.sendToMultiple`. Best-effort — never blocks creation/publication.
4. [x] `POST /requests/:id/accept` — built 2026-07-03. Redis-based atomic mutex lock (`ioredis`, `SET key value NX PX ttl`, TTL = `ACCEPTANCE_TIMER_MINUTES`, safe compare-and-delete release via a Lua script keyed on a per-acquisition token), GPS proximity check (rejects outside `radiusMeters` with the PRD's exact error string), sets status → `CREATOR_ASSIGNED`, starts acceptance timer. `src/services/creatorLockService.ts`'s in-memory placeholder was replaced with a real Redis-backed implementation (`src/config/redis.ts`, `REDIS_URL` env var, retry/health-check/graceful-shutdown wired into `startupChecks.ts`/`server.ts`) — no callers changed except the interface itself (added a `token`-based `release`/`forceRelease` split for cross-process safety, since nothing called the old `acquire`/`release` signature yet). Full business-rule order (published/not-expired/not-own/online/prohibited-block/distance/idempotent-retry/conflict) documented in `docs/API.md`.
5. [x] Scheduled job: `src/services/acceptanceTimerJob.ts`, swept every 30s from `src/server.ts`. Acceptance timer expiry → force-releases the Redis lock (safety net; Redis's own TTL almost always already evicted it), status → back to `PUBLISHED` (re-enters discovery), notifies Requester ("Still searching for a Creator").
6. [ ] 5-minutes-before-expiry push to the Creator (§8.1) — **not built this pass**; the countdown is visible client-side (dashboard/detail screen), but no dedicated "5 minutes left" push notification exists yet. Minor gap, flagged for a follow-up pass rather than blocking this milestone.

**Exit criteria (Discovery half):** an `ONLINE` creator sees `PUBLISHED` requests within their
radius, nearest-first, correctly excluding their own requests and already-locked ones;
filters (category/reward/type) narrow results correctly; a creator without GPS gets the
`/available` fallback feed. **(Fulfilment half, done 2026-07-03):** two Creators racing to
accept the same request — exactly one wins, the other gets the PRD's exact rejection string
(verified via a concurrent-accept integration test); an accepted-but-inactive Creator
correctly releases the lock and request after the timer (verified by forcing
`acceptanceTimerExpiresAt` into the past and running the sweep). Chat/Recording (Phases 4-5)
remain the explicit next dependency-ordered step and are out of scope for this pass.

---

## Phase 4 — Temporary Chat

**PRD refs:** §5.4.

1. Chat opens automatically on GPS-validated acceptance (state → `TEMPORARY_CHAT`), closes automatically (permanently, per-request) on Start Recording.
2. Server-side content filter (§5.4.2 patterns: phone numbers, +91 prefixes, email, WhatsApp/Telegram/Instagram handles, UPI VPAs, URLs) — reject with the PRD's exact error string; log the blocked attempt regardless.
3. >3 blocked attempts in one session → flag for Moderator review.
4. Retention job: purge chat logs 90 days [REVIEW] after request close.

**Exit criteria:** blocked-content patterns from §5.4.2 are all rejected server-side (not just client-side); chat is fully visible to Moderator/Admin at all times per request.

---

## Phase 5 — Recording & Upload Pipeline

**PRD refs:** §5.6, §4.4.

1. `POST /requests/:id/recording/start` — closes chat, records `Creator declaration` consent, transitions state → `RECORDING`.
2. Video upload endpoint → S3 (ephemeral bucket), embeds GPS+timestamp metadata captured at recording time, enforces minimum duration (matches the Requester's selected duration) — reject with "Stream too short" if under.
3. Upload retry handling (network loss mid-recording/upload): resume on reconnect, up to 3 attempts; flag for Admin review if all fail (§7.3 wallet-state-machine row "Creator loses internet mid-recording").
4. On successful upload → state → `MODERATOR_REVIEW`, notify Moderator portal.

**Exit criteria:** a video with correct duration/GPS/timestamp lands in the moderation queue; a too-short recording is rejected client-visibly with no payment implication yet.

---

## Phase 6 — Moderation Workflow (Admin Sub-Module)

**PRD refs:** §5.9, §4.5, §5.14.7.

1. Pre-publish queue: `GET/PATCH /admin/moderation/requests` — approve → broadcast (Phase 3's push); reject with mandatory reason → Requester notified + escrow refunded.
2. Video queue: `GET/PATCH /admin/moderation/videos` — video player data, GPS map view (Creator GPS vs request pin), timestamp check, approve → state → `REQUESTER_REVIEW`; reject with reason (Content violation/Prohibited location/GPS mismatch/Duration mismatch/Fake recording/Other) → escrow handling per §7.3's exact rejection-reason table, Creator notified, optional Suspend User.
3. Escalate-to-Dispute-Center action, chat-log viewer for the request.
4. Admin override of Moderator decisions (§5.14.7) — same underlying queue, Admin-level access.

**Exit criteria:** every rejection reason maps to the exact escrow outcome specified in PRD §7.3's wallet state machine table — do not invent a single blanket "reject = refund" rule; content-violation and minor-quality rejections are documented as having distinct (currently `[REVIEW]`) outcomes and must be flagged, not merged.

---

## Phase 7 — Requester Review & Re-shoot

**PRD refs:** §5.10, §4.6.

1. `POST /requests/:id/accept-video` → escrow release triggers Phase 8's payment flow.
2. `POST /requests/:id/request-reshoot` (once only, reason required) → Creator notified, state → `RESHOOT_REQUESTED`; re-shoot video re-enters the full Phase 5/6 pipeline; after re-shoot, only Accept/Reject are available (no second re-shoot).
3. `POST /requests/:id/reject` (with reason) → `Dispute` row created, escrow frozen, routes into Phase 11's Dispute Center.
4. Scheduled job: re-shoot window (suggested 24h [REVIEW]) miss → auto-escalate to Dispute Center.

**Exit criteria:** the one-free-re-shoot rule is enforced server-side (not just a UI affordance); a missed re-shoot window auto-escalates without manual intervention.

---

## Phase 8 — Payment Release & Escrow Finalization

**PRD refs:** §7.1, §7.2, §5.2, §5.14.5.

1. On Requester Accept: commission calculation (15% [REVIEW], snapshot the rate used at release time onto `RequestEscrow`, not recomputed later if the global rate changes), Creator wallet credited (reuses existing atomic ledger pattern), state → `PAYMENT_RELEASED` → `COMPLETED`.
2. Auto-Payout Toggle (ON/OFF), Admin-controlled, visible on Finance Management (§5.14.5): ON → RazorpayX disbursement automatically; OFF → existing `PayoutRequest` admin-approval path, now linked to specific completed `Request`s where applicable.
3. RazorpayX integration for automatic payouts (blocked on Phase 0's feasibility confirmation).
4. Refund Management (§5.14.5): full/partial manual refunds from escrow with logged reason — needed for Dispute Center partial-split resolutions (Phase 11).

**Exit criteria:** a completed request correctly moves reward-minus-commission into the Creator's wallet and is fully reflected in transaction history; toggling Auto-Payout changes payout behavior without code changes.

---

## Phase 9 — Ratings & Reports

**PRD refs:** §5.12, §4.6 step "Rate your experience".

1. `POST /requests/:id/rate` (mutual: Requester→Creator and Creator→Requester), optional comment, prompted on `COMPLETED`.
2. `POST /reports` (categories per §5.12), routes to Admin panel.
3. Scheduled/triggered check: 3 reports within 30 days → auto-suspend pending Admin review.

**Exit criteria:** rating aggregates feed directly into Phase 10's Trust Profile; report auto-suspend fires without manual polling.

---

## Phase 10 — Requester Trust Profile

**PRD refs:** §5.8.

1. Computed fields exposed on request-detail responses for Creators: overall rating (avg of Creator→Requester ratings), completion % (completed/total created), cancellation % (cancelled-after-acceptance/total), report count (hidden if 0), account age.
2. Trust badge (Low/Medium/High) — PRD explicitly defers the *algorithmic* formula to Phase 2; for MVP, display the underlying attributes individually rather than inventing a composite score (§5.8 note). Do not build a scoring algorithm that isn't in the PRD.

**Exit criteria:** a Creator viewing a request detail sees every attribute in §5.8's table, sourced correctly, with no invented composite trust algorithm.

---

## Phase 11 — Admin: Dispute Center, Live Monitoring, Commission Settings, Audit Logs

**PRD refs:** §5.14.2, §5.14.3, §5.14.6, §5.14.8, §5.14.10, §4.9.

1. Dispute Center: view video/chat/GPS/reasons, resolve (Requester favour/Creator favour/partial split with entered percentage), all decisions logged.
2. Live Monitoring Dashboard: real-time active-request view (Searching/Creator Assigned/Recording/Upload), map view, alert feed (GPS spoofing, high-value requests, blocked chat attempts).
3. Active Request Dashboard: filterable list (status/date/city/category).
4. Commission Settings: configurable %, changes audit-logged.
5. Restricted Location management UI (from Phase 2's fallback model).
6. Audit Logs: immutable, every Admin/Moderator action logged — this does not exist at all today even for the current block/suspicious toggles; backfill those too while building this.
7. Update Dashboard KPI tiles to PRD §5.14.1's set (Total Users, Total Requests Today, Active Requests, Wallet Inflow/Outflow Today, Pending Payouts, Videos in Moderation Queue) — replace the current generic user/revenue-only KPIs.

**Exit criteria:** every admin/moderator mutating action (block, suspend, approve, reject, resolve, toggle) writes an audit log row; Dispute Center resolutions correctly move escrow per the chosen resolution type including partial splits.

---

## Phase 12 — Notifications (Full Trigger Matrix)

**PRD refs:** §8.1, §8.2.

1. Wire every trigger in §8.1's table (new request created, creator assigned, acceptance-timer 5-min warning, recording started, video uploaded [Moderator portal alert], video approved/rejected, re-shoot requested, payment released, request expired, withdrawal processed/failed, account suspended, wallet top-up success/failed) — reuse the existing FCM/in-app infra, just add the missing call sites.
2. Notification preferences: 3 independently toggleable categories (request activity / payment & wallet / platform alerts); safety-critical notifications (suspension, payment failure) cannot be disabled — add the toggle state and enforce it server-side at send time, not just client-side hiding.

**Exit criteria:** every row in §8.1's table has a real trigger wired, verified against the "Do Not Send If" column's suppression conditions.

---

## Phase 13 — Compliance, Consent, Data Retention

**PRD refs:** §9, §5.7.3, §5.11b.

1. Consent capture endpoints/records for ToS/Community Guidelines/Recording Policy (first login) and Requester/Creator declarations (per-request) — immutable `ConsentRecord` rows, never updated/deleted.
2. Re-consent flow if ToS materially updated.
3. Data retention scheduled jobs: fulfilled-video deletion (2h post-acceptance [REVIEW]), rejected/expired-video deletion (24h [REVIEW]), chat purge (90 days [REVIEW]), transaction/GPS-metadata retention (7 years), moderation-decision-log retention (3 years [REVIEW]).
4. Tutorial re-prompt trigger: 3-consecutive-rejections counter on `User`, resets on any approved submission, triggers welcome-video re-show (§5.11b.3) — the counter/trigger logic is backend-owned even though the video itself plays client-side.

**Exit criteria:** consent rows are provably immutable (no update/delete code path exists); retention jobs actually delete/purge on schedule, verified against a seeded test dataset with past-due timestamps.

---

## Phase 14 — Non-Functional Hardening (carries forward prior "Phase 3/4" scope)

**PRD refs:** §11 (all rows), §12.2, §12.3.

Everything previously tracked as "Phase 3 (Docs/DX)" and "Phase 4 (Production Hardening)" in this repo's history is still valid and now additionally scoped to cover the new PRD modules:
1. Automated test framework + coverage for the state machine (Phase 1), escrow flows (Phase 8), and mutex/GPS edge cases (Phase 3) especially — these are the highest-risk-of-silent-bug areas.
2. CI pipeline (build + test gate), currently absent entirely.
3. `docs/API.md` full catch-up — must document every module built in Phases 1–13, not just the pre-PRD auth/wallet/admin surface.
4. Monitoring/alerting per §11 (queue depth > 50 pending moderation, payout queue > 20 pending, failed webhook > 5/hour).
5. Backup/point-in-time recovery, uptime target (99.5%), API response time targets (<500ms p95).
6. Security items already flagged in `docs/CLAUDE.md`'s inherited technical-debt list (mailService API-key log leak, `firebase-service-account.json` gitignore, Razorpay signature timing-safety) — confirm these pre-PRD fixes are still in place before layering new payment logic (Phase 8) on top.

---

## Explicitly Not In This Plan (PRD Appendix A — Phase 2/3, do not build)

Live Video Marketplace (public streams/price slabs/viewer purchase), Business Accounts, Social features (follow/likes/comments/leaderboards), Referral & Rewards, Creator Levels/Badges/Gamification, AI Moderation/Fraud Detection, algorithmic Trust Scoring, Right-to-Delete flow, Government Requests handling, Fake-GPS automated detection, Analytics Dashboard for Creators/Requesters, multi-language/international expansion, Appeal System, AI Review Queue, promotional campaigns/premium plans/enterprise APIs. If any of these surface as a request mid-build, treat it as an explicit out-of-band ask (like the pre-existing Location Discovery module) — not part of this plan.

---

## Sequencing Note

Phases 1→8 are strictly sequential (each depends on the previous phase's data/state existing). Phases 9–13 can proceed in parallel once Phase 8 is stable, since they mostly read from or annotate the core lifecycle rather than gating it. Phase 14 is continuous, not a final gate — but Phase 1's state-machine correctness and Phase 8's escrow correctness deserve test coverage before, not after, the rest of the phases pile on top.
