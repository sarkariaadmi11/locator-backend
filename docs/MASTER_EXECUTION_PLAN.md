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

**Note (2026-07-03, Phase 4 pass):** acceptance now advances straight through `CREATOR_ASSIGNED`
into `TEMPORARY_CHAT` within the same `accept()` call (chat opens automatically per PRD §5.4) —
`CREATOR_ASSIGNED` is a transient intermediate state, not one a client will typically observe.
The acceptance-timer sweep and dashboard's `acceptanceCountdownSeconds` were updated to key off
`TEMPORARY_CHAT` accordingly (see Phase 4 below and `docs/API.md`).

**Exit criteria (Discovery half):** an `ONLINE` creator sees `PUBLISHED` requests within their
radius, nearest-first, correctly excluding their own requests and already-locked ones;
filters (category/reward/type) narrow results correctly; a creator without GPS gets the
`/available` fallback feed. **(Fulfilment half, done 2026-07-03):** two Creators racing to
accept the same request — exactly one wins, the other gets the PRD's exact rejection string;
an accepted-but-inactive Creator correctly releases the lock and request after the timer.
**Correction (2026-07-03 audit):** no automated test file actually backs these claims — there
is no test framework installed in this repo at all (Phase 14 item 1 is accurate: "currently
absent entirely"). These behaviors were manually verified via live end-to-end runs against the
running dev server, not via a committed test suite — do not cite "verified via ... test" as if
a regression-preventing test exists until Phase 14 actually builds one. Chat/Recording (Phases 4-5)
remain the explicit next dependency-ordered step and are out of scope for this pass.

---

## Phase 4 — Temporary Chat

**PRD refs:** §5.4.

**Status: done except retention job (2026-07-03).** Built as `ChatMessage` Prisma model,
`src/repositories/chatRepository.ts`, `src/services/chatService.ts`,
`src/utils/chatContentFilter.ts`, `GET/POST /requests/:id/chat` (in `requestController.ts`/
`requestRoutes.ts` alongside the rest of the Requests module, matching how Discovery/Fulfilment
were added in Phase 3). See `docs/API.md` "Temporary Chat".

1. [x] Chat opens automatically on GPS-validated acceptance (state → `TEMPORARY_CHAT`) — wired directly into `requestService.accept()`, immediately following the mutex-guarded `CREATOR_ASSIGNED` transition (see Phase 3's note above). Closes automatically (permanently, per-request) on Start Recording — enforced today via the `TEMPORARY_CHAT`-only gate on `POST /requests/:id/chat` (`409` once status advances); the actual Start Recording transition itself is Phase 5, not built yet.
2. [x] Server-side content filter (§5.4.2 patterns: phone numbers, +91 prefixes, email, WhatsApp/Telegram/Instagram handles, UPI VPAs, URLs) — `src/utils/chatContentFilter.ts`, rejects with `422` and logs the blocked attempt regardless (`ChatMessage.blocked`/`blockReason`, never returned by `GET .../chat` to the other participant). **The exact PRD §5.4.2 rejection string wasn't available in this environment — shipped an interim, clearly-flagged placeholder pending client confirmation, same pattern used for other undocumented exact PRD strings in this codebase.**
3. [x] >3 blocked attempts on one request → `Request.chatFlaggedForReview = true` (no Moderator queue exists yet to act on this — Phase 6 — but the flag is captured now so that phase has data to work with).
4. [ ] Retention job: purge chat logs 90 days [REVIEW] after request close — **not built this pass**, per explicit scope decision (the number itself is unconfirmed `[REVIEW]`, and nothing yet depends on the purge happening). Tracked for Phase 13 (Compliance/Retention) alongside the rest of the retention jobs.

**Exit criteria (met except retention):** blocked-content patterns from §5.4.2 are all rejected server-side (verified via a live end-to-end run: phone number, email, and URL patterns all correctly blocked and excluded from the participant-facing list; a non-participant gets `403`; the 3-blocked-attempts flag fires correctly) — not just client-side (mobile also runs the same patterns client-side for instant feedback, Phase 6 mobile). Moderator/Admin visibility into chat at all times isn't meaningfully testable yet since no Moderator/Admin chat viewer exists (Phase 6, Admin sub-module) — the data model supports it (nothing is ever hard-deleted), but there's no read surface for it yet.

---

## Phase 5 — Recording & Upload Pipeline

**PRD refs:** §5.6, §4.4.

**Status: done (2026-07-03), Cloudinary substituted for S3 per this milestone's explicit scope
decision.** Built as `RequestVideo` Prisma model (+ `VideoUploadStatus` enum), a
storage-provider abstraction (`src/services/storage/IVideoStorageProvider.ts` +
`CloudinaryVideoStorageProvider.ts` — **only** file in the codebase that imports the
`cloudinary` SDK for video; `recordingService`/`requestService` depend solely on the
interface), `src/repositories/requestVideoRepository.ts`, `src/services/recordingService.ts`,
`src/controllers/recordingController.ts`, routes registered in `requestRoutes.ts`,
`src/validations/recordingValidation.ts`, `videoUpload` multer config in
`middlewares/upload.ts`. See `docs/API.md` "Recording & Upload".

1. [x] `POST /requests/:id/recording/start` — closes chat (chat's own `409` gate already keys
   off `status !== 'TEMPORARY_CHAT'`), stamps `creatorDeclarationAt` (mandatory
   `{declaration: true}` body field — the PRD's "records Creator declaration consent" is met
   as an inline timestamp on `Request`, matching the same interim pattern used for
   `requesterDeclarationAt` in Phase 2, since `ConsentRecord` doesn't exist yet — Phase 13),
   transitions `TEMPORARY_CHAT → RECORDING`.
2. [x] Video upload → **Cloudinary** (not S3 — see "Important storage decision" below),
   embeds GPS+timestamp+duration metadata **as reported by the client at upload time** (same
   trust model as the Creator's GPS at Accept time, §5.5 — there is no independent
   server-side verification), enforces minimum duration (matches the Requester's selected
   duration, `durationMinutes*60 - 2s` tolerance) — rejects `422` `"Stream too short."` if
   under. **Also enforces a maximum duration** (`+30s` grace) — not itemized in this plan
   originally, but explicitly requested by this milestone's scope ("Maximum duration" listed
   alongside "Maximum size"/"Allowed mime types" as required validations) — rejects `422`
   `"Recording is too long for the selected duration."` if over.
3. [x] Upload retry handling: `POST /requests/:id/video/:videoId/retry` resets a `FAILED`
   session to `PENDING` so the client can re-call `complete`, up to 3 total attempts
   (`RequestVideo.uploadAttempts`); the 3rd failure returns "flagged for review" copy and
   blocks further retries (no dedicated Admin flag/queue exists yet — Phase 6 — this is the
   client-visible terminal state only). `POST /requests/:id/video/:videoId/cancel` (not-yet-
   uploaded sessions) and `DELETE /requests/:id/video/:videoId` (withdraw an uploaded draft,
   reverts `Request.status → RECORDING`) round out the upload lifecycle — not itemized
   originally, added because "Generate upload session / Retry / Cancel / Fetch / Delete draft"
   was this milestone's explicit endpoint list.
4. [x] On successful upload → chains `RECORDING → UPLOAD → MODERATOR_REVIEW` in one call
   (mirrors how `accept()` chains `CREATOR_ASSIGNED → TEMPORARY_CHAT` in Phase 3/4) — **"notify
   Moderator portal" is not built**, since no Moderator portal/queue exists yet (Phase 6, out
   of this milestone's explicit stop condition). The request correctly lands in and waits at
   `MODERATOR_REVIEW`.
5. [x] Automatic thumbnail generation — Cloudinary `eager` transformation requested at upload
   time (`400x400` JPEG, `eager_async: false` so the thumbnail URL is available in the same
   response), not a separate polling step.

**Important storage decision (explicit, this milestone):** the PRD's target is AWS S3 (§12.2),
but this pass uses **Cloudinary only** — it was already configured in the project, and S3 was
never provisioned (Phase 0 still lists it as open infra). Storage is fully abstracted behind
`IVideoStorageProvider` so introducing `S3VideoStorageProvider` later is a new file + a
one-line swap in `src/services/storage/index.ts`, not a `recordingService`/`requestService`
rewrite.

**Exit criteria:** a video with correct duration/GPS/timestamp lands in the moderation queue
(verified live against the running dev server: start recording → create session → upload
succeeds through a real Cloudinary round-trip on the failure path, retry/cancel/max-attempts
all verified — see `docs/API.md`); a too-short recording is rejected client-visibly with no
payment implication (escrow doesn't exist yet regardless). **Not independently verified this
pass:** a full *successful* Cloudinary video upload with a genuine media file (the dev sandbox
this was built in has no `ffmpeg`/sample-video asset to construct one) — the failure/retry/
max-attempts path *was* verified against real Cloudinary API calls (a malformed file correctly
round-tripped a `400` from Cloudinary into our `FAILED` state), and the upload code path itself
was reviewed, but a first-person "thumbnail rendered correctly for a real video" observation is
still outstanding. Flag this as the one open verification gap for a follow-up pass with a real
device/emulator recording.

---

## Phase 6 — Moderation Workflow (Admin Sub-Module)

**PRD refs:** §5.9, §4.5, §5.14.7.

**Status: Video moderation queue done (2026-07-03); pre-publish (high-value DRAFT) queue and
Dispute-Center escalation explicitly deferred — see below.** Built as `RequestVideo.moderationStatus`/
`moderationRejectionReason`/`moderationRemarks`/`moderatedAt`/`moderatedByAdminId` (extends the
Phase 5 model — moderation decision fields were explicitly reserved for this phase, see
`docs/CLAUDE.md` §2's `RequestVideo` note), a new `AdminAuditLog` model, `src/services/moderationService.ts`,
`src/repositories/{requestVideoRepository,adminAuditLogRepository}.ts` additions,
`src/controllers/{adminModerationController,adminAuditLogController}.ts`, routes registered in
`adminRoutes.ts` under `/admin/moderation/*` and `/admin/audit-logs`. See `docs/API.md`
"Moderation" and "Audit Logs" for exact shapes.

1. [ ] Pre-publish queue (`GET/PATCH /admin/moderation/requests` for high-value DRAFT requests) —
   **not built this pass**, per this milestone's explicit scope (video moderation only was
   requested; the pre-publish queue is a separate PRD §5.9 sub-feature with no escrow to refund
   yet regardless, since `RequestEscrow` doesn't exist — Phase 8). Tracked as a follow-up, not an
   oversight.
2. [x] Video queue: `GET /admin/moderation/videos` (live queue, FIFO), `GET
   /admin/moderation/videos/history` (past decisions), `GET /admin/moderation/videos/:videoId`
   (video player data — asset URLs — plus a GPS map comparison — Creator GPS vs request pin,
   `distanceMeters`/`withinRadius` — and a timestamp check), `PATCH .../approve` → `Request.status:
   MODERATOR_REVIEW → REQUESTER_REVIEW`, `PATCH .../reject` (mandatory `reason` enum:
   `CONTENT_VIOLATION`/`PROHIBITED_LOCATION`/`GPS_MISMATCH`/`DURATION_MISMATCH`/`FAKE_RECORDING`/`OTHER`)
   → **`Request.status: MODERATOR_REVIEW → RECORDING`** (this milestone's explicit instruction:
   rejection sends the Creator back to re-record, not to a terminal state — `REJECTED` remains
   reserved for the Requester-side Phase 7 dispute path). `recordingService.createUploadSession`
   was extended (additive, not rewritten) to also accept a fresh session once the latest video's
   `moderationStatus` is `REJECTED`, alongside the pre-existing `FAILED` case.
   - [ ] Escrow handling per §7.3's rejection-reason table — **not built**, `RequestEscrow`
     doesn't exist yet (Phase 8); each rejection reason is captured and audit-logged today, but
     there is no escrow outcome to route it to yet. Do not treat this as "reject = refund" being
     implemented — it isn't, because there is no escrow to refund.
   - [x] Bulk moderation: `POST /admin/moderation/videos/bulk-approve` / `/bulk-reject` — best-
     effort per item (`Promise.allSettled`), one failure never blocks the rest.
3. [ ] Escalate-to-Dispute-Center action, chat-log viewer for the request — **not built**, out of
   this milestone's explicit scope (Disputes is a later, separate phase). The data model doesn't
   block adding either later (chat rows and moderation decisions are never hard-deleted).
4. [x] Admin override of Moderator decisions (§5.14.7) — trivially satisfied: Moderator is a
   capability of the existing Admin JWT namespace, not a separate principal (docs/CLAUDE.md §1/§7
   decision, reaffirmed here rather than re-litigated) — every Admin account already has full
   access to the one underlying queue; there is no separate lesser Moderator principal whose
   decisions would need "overriding" by a different role.
5. [x] Requester video-visibility gate (mobile requirement, not originally itemized in this
   phase but necessary once moderation exists to enforce it): `recordingService.getVideo`
   (Phase 5) now nulls `secureUrl`/`thumbnailUrl` for the Requester until `moderationStatus ===
   'APPROVED'` — the Creator always sees their own upload regardless. This is a small, additive
   extension of already-shipped Phase 5 code, not a rewrite.
6. [x] Immutable Admin Audit Log (`AdminAuditLog`, `GET /admin/audit-logs`) — this pass only
   writes Moderation actions (`VIDEO_APPROVED`/`VIDEO_REJECTED`); backfilling other existing
   Admin actions (user block/suspicious toggle, payout approve/reject) remains a later Phase 11
   item, not done here.

**Exit criteria (met for video moderation; escrow/pre-publish/dispute-escalation explicitly
deferred, see above):** every rejection reason is captured as a distinct, audit-logged value
(not merged into a single blanket "reject" reason) and correctly reverts the request to
`RECORDING` for a re-shoot; approve correctly advances to `REQUESTER_REVIEW`; the Requester
cannot fetch the video asset until approved (verified live against the running dev server: a
full create → accept → record → upload(simulated) → reject → re-open-session → upload(simulated)
→ approve cycle, including the Requester-gate check before and after approval — see this
session's completion report for the exact commands run). Escrow outcomes per §7.3's table remain
unimplemented pending Phase 8 (`RequestEscrow` doesn't exist yet) — do not cite this phase as
having wired escrow refunds; it has not.

---

## Phase 7 — Requester Review & Re-shoot

**PRD refs:** §5.10, §4.6.

**Status: done except Dispute-routing/auto-escalation (2026-07-03), by this milestone's explicit
scope cut.** Built as `src/services/requesterReviewService.ts`,
`src/controllers/requesterReviewController.ts`, routes registered in `requestRoutes.ts`
alongside the rest of the Requests module, `src/validations/requesterReviewValidation.ts`. New
`Request` fields: `reshootCount`, `requesterReviewRemarks`, `requesterRejectionReason`,
`reshootReason` (migration `requester_review_reshoot`) — `reshootUsed`/`requesterDecisionAt`
already existed from Phase 1. See `docs/API.md` "Requester Review & Re-shoot".

1. [x] `POST /requests/:id/accept-video` → `REQUESTER_REVIEW → ACCEPTED`. Escrow release itself
   is Phase 8 (not built — `RequestEscrow` doesn't exist), but the state correctly lands at
   `ACCEPTED`, ready for that phase to pick up.
2. [x] `POST /requests/:id/request-reshoot` (once only, reason required) → Creator notified,
   chains `REQUESTER_REVIEW → RESHOOT_REQUESTED → RECORDING` in one call (mirrors the
   `accept()` chaining pattern from Phase 3); re-shoot video re-enters the Phase 5/6 pipeline via
   the existing `POST /requests/:id/video/session` (its guard was extended, additively, to allow
   a fresh session once the request is back in `RECORDING` even if the latest video is
   `APPROVED`, not just `FAILED`/`REJECTED`); `reshootUsed` enforced server-side blocks a second
   `request-reshoot` call, so after a re-shoot only Accept/Reject are reachable on the next
   `REQUESTER_REVIEW`.
3. [x] `POST /requests/:id/reject` (with reason) → **this milestone's explicit instruction:
   lands on the existing terminal `REJECTED` state, not a `Dispute` row/escrow freeze** — the
   master plan's original item 3 (Dispute Center routing) is explicitly out of scope for this
   pass (Disputes/Escrow are separate, not-yet-built phases). Revisit when Phase 11 exists.
4. [ ] Scheduled job: re-shoot window (suggested 24h [REVIEW]) miss → auto-escalate to Dispute
   Center — **not built this pass**, depends on the Dispute Center (Phase 11), which is out of
   this milestone's explicit scope.

**Exit criteria (met for accept/re-shoot/reject; Dispute-routing and the re-shoot-window
auto-escalation explicitly deferred, see above):** the one-free-re-shoot rule is enforced
server-side (not just a UI affordance) — verified live against the running dev server (create →
accept → record → upload(simulated) → moderate-approve → REQUESTER_REVIEW → request-reshoot →
back in RECORDING → record again → upload(simulated) → moderate-approve → REQUESTER_REVIEW →
a second `request-reshoot` call correctly `409`s → accept-video → `ACCEPTED`; a separate run
verified `reject` → `REJECTED` terminal, and that the Creator/a third party cannot call any of
the three endpoints). A missed re-shoot window does **not** auto-escalate — that requires the
Dispute Center (Phase 11), out of this pass's scope.

---

## Phase 8 — Payment Release & Escrow Finalization

**PRD refs:** §7.1, §7.2, §5.2, §5.14.5.

**Status: done except Auto-Payout Toggle/RazorpayX and partial-split refunds (2026-07-03).** Built
as `RequestEscrow` Prisma model + `EscrowState` enum, `src/repositories/requestEscrowRepository.ts`,
`src/services/escrowService.ts`, `src/utils/requestEscrowPresenter.ts`,
`src/validations/escrowValidation.ts`, `GET /requests/:id/escrow` (participant-only, in
`requestController.ts`/`requestRoutes.ts`), `src/controllers/adminEscrowController.ts` (mounted
in the single existing `adminRoutes.ts`, matching this codebase's one-file-per-domain-group
admin routing convention). `Transaction` gained a `requestId` FK so every escrow-driven ledger
row is traceable back to its originating request (CLAUDE.md §2's explicit instruction).

1. [x] Escrow reservation moved forward from its originally-deferred Phase 1/2 gap: `POST
   /requests` (`requestService.create`) now debits the Requester's wallet for the full
   `rewardAmount` and creates a `RESERVED` `RequestEscrow` row in the same call (`402` if the
   balance is insufficient) — this was explicitly listed as deferred-to-Phase-8 work in Phases
   1/2 above, not a new addition beyond this phase's scope.
2. [x] On Requester Accept (`POST /requests/:id/accept-video`): commission calculated at 15%
   `[REVIEW — PRD's only given number, not yet client-confirmed, flagged per CLAUDE.md §8 rule
   11]` and **snapshotted onto the escrow row at reservation time**, not recomputed at release —
   Creator wallet credited via the same atomic `transactionRepository.runTransaction` pattern
   `walletService`/`adminService.processPayout` already use, chains `ACCEPTED → PAYMENT_RELEASED
   → COMPLETED` in one call (both edges already existed in `requestStateMachine.ts`, untouched).
3. [x] Refund path: `POST /requests/:id/reject`, `POST /requests/:id/cancel` (pre-acceptance),
   and the expiry sweep (`requestLifecycleJob.expireDueRequests`, 24h no-Creator-assigned) all
   now refund the locked escrow back to the Requester's wallet — this closes Phase 2's
   originally-deferred "no refund" gaps on both cancel and expiry.
4. [x] Admin (PRD §5.14.5 Refund Management / Finance Management): `GET /admin/escrow` (list,
   filters `state`/`requestId`), `GET /admin/escrow/summary` (financial audit totals), `GET
   /admin/escrow/:id`, `POST /admin/escrow/:id/release` / `.../refund` — **manual override**:
   the same `escrowService.release`/`refund` functions the automatic flows use, reusable as-is
   for Admin discretion since they only gate on the escrow's own state (`RESERVED`), not the
   Request's current status. Audit-logged (`ESCROW_RELEASED_MANUAL`/`ESCROW_REFUNDED_MANUAL`)
   via the existing `AdminAuditLog`/`adminAuditLogService` from Phase 6 — no new audit
   infrastructure needed.
5. [ ] **Not built this pass** (explicitly out of scope, per this milestone's stop condition):
   Auto-Payout Toggle + RazorpayX automated disbursement (Creator payouts still land as a
   regular wallet-balance credit, withdrawable via the existing `PayoutRequest` admin-approval
   flow — items 2/3 of this phase's original text) and partial-split refunds tied to Dispute
   Center resolutions (the `SPLIT`/`FROZEN` `EscrowState` values are declared per the target spec
   but no code path produces them — Phase 11, Disputes, doesn't exist yet).

**Exit criteria (met for reserve/release/refund/admin-override; Auto-Payout Toggle/RazorpayX and
partial-split explicitly deferred, see above):** verified live end-to-end against the running
dev server — request creation debits escrow (and correctly `402`s on insufficient balance);
accept-video releases `amountLocked - commissionAmount` to the Creator and chains the request to
`COMPLETED`; cancel, reject, and an admin manual-refund override all correctly restore
`amountLocked` to the Requester; a second release/refund attempt on an already-settled escrow
`409`s; a non-participant fetching `GET /requests/:id/escrow` gets `403`; admin escrow
list/summary/detail and the audit-log entries for manual overrides were all confirmed. Backend
`tsc --noEmit` clean.

---

## Phase 9 — Ratings & Reports

**PRD refs:** §5.12, §4.6 step "Rate your experience".

**Status: done (2026-07-03).** Built as `Rating`/`Report` Prisma models (+ `RatingRole`/
`ReportCategory`/`ReportStatus` enums, migration `ratings_reports`), `src/repositories/
{ratingRepository,reportRepository}.ts`, `src/services/{ratingService,reportService}.ts`,
`src/controllers/{ratingController,reportController,adminReportController}.ts`,
`src/validations/{ratingValidation,reportValidation}.ts`, `src/utils/{ratingPresenter,
reportPresenter}.ts`. See `docs/API.md` "Ratings, Reviews & Reporting" for exact shapes.

1. [x] `POST /requests/:id/rate` (mutual: Requester→Creator and Creator→Requester — direction
   derived server-side from the caller, never client-supplied), optional comment, only reachable
   once `COMPLETED`. `GET /requests/:id/rating` added (not originally itemized) so both sides can
   see what's been submitted so far.
2. [x] `POST /reports` (categories per §5.12), tied to a specific request (reporter/reportedUser
   must be the two opposite participants — `403` otherwise), duplicate-prevented via
   `@@unique([reporterId, reportedUserId, requestId])`. Admin queue: `GET /admin/reports`
   (`/stats`, `/:id`), `PATCH /admin/reports/:id/resolve`\|`/dismiss` (audit-logged, reusing the
   existing `AdminAuditLog`).
3. [x] Suspend-recommendation hook: 3 reports within 30 days → the existing `User.isSuspicious`
   flag is set (reused as-is, not a new suspension mechanism) — runs inline at report-creation
   time, no scheduled job. **Interim decision**: this is a recommendation surfaced to Admin (the
   flag Admin already reviews/toggles), not a hard auto-suspend that blocks the user itself —
   the PRD's "auto-suspend pending Admin review" phrasing already implies Admin stays the actor.

**Also built, not originally itemized** — "show average rating everywhere" (this milestone's
explicit mobile ask): `ratingService.getSummaryForUser`/`attachRatingSummaries` merged into
`GET /auth/me` (own average), `GET /creator/dashboard` (`myRating`), and `GET /requests/:id`\|
`GET /requests/:id/details` (`requesterRating`/`creatorRating`) — computed on demand, no
denormalized field on `User`.

**Exit criteria (met):** verified live end-to-end against the running dev server — mutual rating
submission, duplicate-rating rejection, non-participant rejection, both ratings visible via
`GET /requests/:id/rating`, `GET /auth/me`/`GET /creator/dashboard`/`GET /requests/:id` all
correctly reflect the new aggregate; report submission, duplicate-report rejection, non-
participant rejection, admin queue/stats/resolve/dismiss (with 409 on a second decision) and
audit-log entries all confirmed; a 3rd distinct report against one user within 30 days correctly
flipped `isSuspicious` and the admin report-detail endpoint's `suspendRecommended` field. Backend
`tsc --noEmit` and `npm run build` both clean. **Rating aggregates do not yet feed a Trust
Profile** (Phase 10, not built this pass — completion %/cancellation %/trust badge remain
unimplemented; only the raw average/count is exposed, per this phase's own explicit scope).

---

## Phase 10 — Requester & Creator Trust Profile

**PRD refs:** §5.8.

**Status: done (2026-07-03), scope expanded beyond this section's original text by explicit
milestone instruction — confirmed with the user before building, since it directly contradicts
item 2 below.** Built as `src/services/trustScoreService.ts` (centralized calculation),
`src/repositories/trustProfileRepository.ts`, `src/controllers/{trustProfileController,
adminTrustProfileController}.ts`, `GET /trust-profile/me`\|`/:userId`, full Admin sub-module
(`/admin/trust-profiles*`). Two additive `Request` columns (`lastAssignedCreatorId`,
`creatorTimedOut`) let a Creator's fulfilment history survive the acceptance-timer sweep nulling
`creatorId`. See `docs/API.md` "Trust Profile" for the exact response shape/endpoint list.

1. [x] Computed fields, expanded well beyond the original list here: overall rating (reused
   as-is from `ratingService`, not recomputed), completed/successful requests, cancellation rate,
   re-shoot rate, acceptance rate, response rate, report count (received/resolved), profile
   completion %, member-since/account age — for **both** a Requester profile and a Creator
   profile (this milestone's explicit ask went beyond "Requester Trust Profile" to include the
   Creator side too), exposed on `GET /auth/me`, `GET /creator/dashboard`, `GET /requests/:id`\|
   `/details`, and `GET /requests/nearby`\|`/available` (Creator Discovery).
2. [x] **Composite Trust Score (0-100) and 5 named badges (Verified/Top Creator/Trusted
   Requester/Low Cancellation/Fast Response) — built anyway, by explicit milestone instruction,
   despite this line originally reading "do not build a scoring algorithm that isn't in the
   PRD."** The PRD itself still defers the exact algorithm to a later phase; every weight/
   threshold is a transparent, documented interim default (`src/validations/
   trustProfileValidation.ts`), not a black box — flagged for client confirmation the same way
   every other undocumented-PRD-number in this codebase is, not silently invented.
3. [x] Verification Status (`User.isVerified`, new field, Admin-toggled — no automated KYC
   exists) and manual Admin review notes (reuses the existing immutable `AdminAuditLog`, action
   `TRUST_REVIEW_NOTE_ADDED` — no new table) — both beyond this section's original scope,
   explicitly requested this milestone.

**Exit criteria (met, scope expanded per above):** a Creator viewing a request detail sees every
attribute in §5.8's table, sourced correctly (verified live end-to-end against the running dev
server — see this session's completion report), **plus** the composite score/badges/
verification/notes this milestone explicitly asked for beyond the PRD's own §5.8 text.

---

## Phase 11 — Admin: Dispute Center, Live Monitoring, Commission Settings, Audit Logs

**PRD refs:** §5.14.2, §5.14.3, §5.14.6, §5.14.8, §5.14.10, §4.9.

**Status: fully built.** Item 1 (Dispute Center) built 2026-07-03; items 2, 3, 4, 6, 7 (Live
Monitoring, Active Request Dashboard, Commission Settings, Audit Logs backfill, Dashboard KPI
tiles) built 2026-07-04, closing out this phase's remainder. Item 5 (Restricted Location
management **UI**) remains not built — the API existed already (Phase 0/2), but no Admin
frontend exists in this repo at all (every Admin feature, before and after this pass, is
API-only — see backend `docs/CLAUDE.md` §6's "Moderation Workflow" note for the same precedent).

1. [x] Dispute Center: `Dispute`/`DisputeMessage`/`DisputeEvidence` models + enums, evidence
   upload (Requester/Creator/Admin, Cloudinary-backed), case owner assignment, Admin notes
   (reuses `AdminAuditLog`), full timeline/resolution history (same reuse), resolve
   (Requester favour/Creator favour/partial split with entered percentage — delta-based against
   a creation-time money snapshot so it correctly reverses an already-`COMPLETED`/`REJECTED`
   settled outcome, not just a still-`RESERVED`/`FROZEN` one), close, reopen (interim decision,
   flagged — PRD doesn't explicitly rule on it). All decisions logged via `AdminAuditLog`. See
   `docs/API.md` "Dispute Center" for the full endpoint list and this session's completion report
   for live-verified wallet-balance deltas across all three resolution types.
2. [x] Live Monitoring Dashboard — **built 2026-07-04**: `GET /admin/dashboard/live-monitoring`
   (`adminService.getLiveMonitoring`) — per-status counts across every non-terminal PRD §5.13
   state (`requestRepository.countGroupedByLiveStatus`), online-Creator count, moderation queue
   depth (reuses `moderationService.getStats`), open/under-review dispute counts (reuses
   `disputeService.adminStats`), flagged-chat count — composed from the same per-domain
   services/repositories their own dedicated screens already use, no second parallel aggregation
   path. See `docs/API.md` "Admin Dashboard".
3. [x] Active Request Dashboard — **built 2026-07-04**: `GET /admin/dashboard/active-requests`
   (`adminService.getActiveRequests`, `requestRepository.findManyActiveForAdmin`) — paginated,
   optional single-status filter, reuses the existing participant-facing `presentRequest` shape
   plus lightweight `requester`/`creator` identity. See `docs/API.md` "Admin Dashboard".
4. [x] Commission Settings (configurable %) — **built 2026-07-04**: `COMMISSION_RATE_PERCENT` is
   now a `ComplianceConfig` key (reuses backend Phase 13's Admin-editable, self-seeding,
   audit-logged config infrastructure rather than a new parallel settings mechanism — same "don't
   hardcode a `[REVIEW]` number" pattern), validated 0-100 server-side.
   `escrowService.reserve` reads it dynamically and still snapshots the value onto each
   `RequestEscrow` row at reservation time, so a later change never retroactively alters an
   already-reserved escrow. The old hardcoded constant in `src/validations/escrowValidation.ts`
   was removed (its doc comment now points at the new mechanism); a pre-existing duplicated
   `round2` commission-split calculation (present separately in both `escrowService.ts` and
   `disputeService.ts`) was also consolidated into a new shared, unit-tested
   `src/utils/money.ts` as part of this change. See `docs/API.md` "Commission Settings".
5. [ ] Restricted Location management UI — **not built this pass** (the API existed already, Phase 0/2).
6. [x] Audit Logs backfill (block/suspicious/payout actions) — **built 2026-07-04**:
   `adminService.toggleBlock`/`toggleSuspicious`/`processPayout` now write
   `USER_BLOCKED`/`USER_UNBLOCKED`/`USER_FLAGGED_SUSPICIOUS`/`USER_UNFLAGGED_SUSPICIOUS`/
   `PAYOUT_APPROVED`/`PAYOUT_REJECTED` rows via the existing `adminAuditLogService`. This is a
   **prospective** backfill (every toggle/payout action from this point forward is logged) — it
   is not possible to retroactively manufacture audit rows for actions taken before
   `AdminAuditLog` existed (backend Phase 6).
7. [x] Dashboard KPI tiles update — **built 2026-07-04**: `GET /admin/dashboard` extended with
   the PRD §5.14.1-named tiles (`totalRequestsToday`, `activeRequests`, `moderationQueueDepth`,
   `pendingDisputes`, `onlineCreators`) alongside the pre-existing generic user/revenue tiles,
   sourced from the same services the dedicated Moderation/Dispute/Live-Monitoring screens use.

**Exit criteria (met):** every admin dispute-mutating action (assign, message, note, resolve,
close, reopen) writes an audit log row; Dispute Center resolutions correctly move escrow per the
chosen resolution type including partial splits (verified live end-to-end, see the Phase 11
completion report). Live Monitoring/Active Request Dashboard/Commission Settings/Audit Logs
backfill/KPI tiles all verified live against the running dev server 2026-07-04 (commission
update to 20%, rejection of a >100% value, and a suspicious-toggle round-trip through
`GET /admin/audit-logs` were each exercised directly — see this session's completion report).

---

## Phase 12 — Notifications (Full Trigger Matrix)

**PRD refs:** §8.1, §8.2.

**Status: done (2026-07-04).** Built as `src/services/notificationTypes.ts` (canonical
`NotificationType` matrix + 3-category mapping + safety-critical set) and
`src/services/notificationService.ts` (the single centralized entry point every service now
calls — `notifyUser`/`notifyMultiple`/`notifyAdmins` — wrapping the pre-existing `fcmService`,
not replacing it). Every trigger this milestone's matrix asked for was wired across
`authService`, `requestService`, `chatService`, `recordingService`, `moderationService`,
`requesterReviewService`, `escrowService`, `ratingService`, `reportService`, `trustScoreService`,
`disputeService`, `walletService`, `adminService`, `requestLifecycleJob`, `acceptanceTimerJob`,
and a new `notificationReminderJob.ts` (recording/review/rating reminders — see `docs/API.md`
"Notifications" for the exact per-type trigger-site table and every interim-decision note).

1. [x] Full §8.1 trigger matrix wired — see `docs/API.md` "Notifications" for the complete
   type-by-type table. Three pre-existing ad hoc type strings were renamed to match this
   milestone's matrix naming exactly (`REQUEST_ACCEPTED`→`CREATOR_ACCEPTED`,
   `ACCEPTANCE_EXPIRED`→`CREATOR_TIMED_OUT`, `DISPUTE_RAISED`→`DISPUTE_CREATED`) — safe, since
   `type` was always an opaque JSON string with no other reader. Every notification's `data` now
   also carries a `screen` key for mobile's deep-link router.
2. [x] Notification preferences: `User.notifyRequestActivity`/`notifyPaymentWallet`/
   `notifyPlatformAlerts` (flat booleans, default `true`), `GET`/`PATCH /notifications/preferences`.
   Safety-critical types (`ACCOUNT_SUSPENDED`, `PAYOUT_REJECTED`) bypass the gate unconditionally
   in `notificationService.notifyUser` (`SAFETY_CRITICAL_TYPES`), verified live (see completion
   report) — not just a client-side hide.
3. [x] `GET /notifications/unread-count` — added (not in the original plan text, but required by
   the mobile tab-bar badge this milestone also asked for).

**Exit criteria (met):** every row in this milestone's matrix has a real trigger wired to an
actual business event (verified live: notification-row creation, preference-gating suppression,
and safety-critical bypass all confirmed via a direct-service test against a real user row — see
completion report). Reminder thresholds (recording/review/rating) and the trust-score/badge
change-detection check-point are interim engineering decisions, explicitly flagged in
`docs/API.md`, not silently invented per docs/CLAUDE.md §8 rule 11.

---

## Phase 13 — Compliance, Consent, Data Retention

**PRD refs:** §9, §5.7.3, §5.11b.

**Status: done (2026-07-04).** Built as `ConsentRecord`/`ComplianceConfig`/`DataExportRequest`/
`DataDeletionLog` Prisma models (+ `ConsentType`/`DataExportStatus`/`DeletionLogAction` enums,
migration `add_compliance_consent_privacy`), `src/services/{complianceConfigService,
consentService,accountDeletionService,dataExportService,privacyService,retentionJob}.ts`,
`src/controllers/{consentController,accountController,privacyController,
adminComplianceController}.ts`, routes `src/routes/{consentRoutes,accountRoutes,
privacyRoutes}.ts` (mounted at `/consent`, `/account`, `/privacy`) plus an admin sub-module
appended into the existing `adminRoutes.ts` (`/admin/compliance/*`, this codebase's established
one-file-per-domain-group admin routing convention — no new `adminComplianceRoutes.ts` file).
See `docs/API.md` "Compliance, Consent, Privacy & Data Retention" for the full endpoint list and
every `[REVIEW]`-tagged default.

1. [x] Consent capture: `POST /consent/accept`, `GET /consent/status`\|`/history` for the four
   first-login/re-consent document types (ToS/Privacy Policy/Community Guidelines/Recording
   Policy) — immutable `ConsentRecord` rows (insert-only, no update/delete code path anywhere in
   this codebase). Requester/Creator per-request declarations (`REQUESTER_DECLARATION`/
   `CREATOR_DECLARATION`) are now **also** logged as `ConsentRecord` rows, additively, from
   `requestService.create`/`recordingService.startRecording` — alongside, not replacing, the
   pre-existing `Request.requesterDeclarationAt`/`creatorDeclarationAt` interim timestamps from
   Phases 2/5 (best-effort, non-blocking — a logging failure never breaks request creation or
   recording start, both already-shipped flows).
2. [x] Re-consent flow: consent **versions** live in `ComplianceConfig` (DB-backed, Admin-editable
   without a redeploy — `TERMS_OF_SERVICE_VERSION` etc.), and `GET /consent/status`'s
   `needsAnyReacceptance` flag drives mobile's `ConsentGate` auth-gate step, which re-shows
   whichever document version changed. Bumping a version config key is the entire "materially
   updated" trigger — no separate re-consent-specific code path exists, by design (one mechanism
   serves both first-login consent and later re-consent).
3. [x] Data retention scheduled jobs (`retentionJob.ts`, swept hourly by default,
   `RETENTION_SWEEP_INTERVAL_MINUTES`): fulfilled-video asset deletion
   (`VIDEO_FULFILLED_RETENTION_HOURS`, default 2h `[REVIEW]`), rejected/expired-video asset
   deletion (`VIDEO_TERMINAL_RETENTION_HOURS`, default 24h `[REVIEW]`), chat purge
   (`CHAT_RETENTION_DAYS`, default 90 `[REVIEW]`), notification purge (this milestone's own
   explicit ask, not PRD-numbered, default 180 days, read-only). Transaction/GPS-metadata 7-year
   retention and moderation-decision-log 3-year retention are exposed in
   `GET /admin/compliance/config` **for documentation purposes only** — per this file's explicit
   "do not delete money/audit records" rule, no job in this codebase purges `Transaction` or
   `AdminAuditLog` rows; only the retention *commitment* is configurable/visible, not an actual
   purge (these two rows must survive forever regardless of any config value).
4. [x] Tutorial re-prompt trigger: `User.consecutiveRejections`/`welcomeVideoRepromptPending`,
   wired into `requesterReviewService.reject` (increment, flip the flag + reset the counter at
   `CONSECUTIVE_REJECTIONS_REPROMPT_THRESHOLD`, default 3) and `.acceptVideo` (reset to 0 on any
   approval). `POST /account/welcome-video-ack` clears the flag once mobile re-shows the video.
   **The welcome-video screen itself is not built this pass** — it's mobile Phase 1's scope
   (Onboarding Overhaul, not started); only the backend-owned counter/trigger/endpoint exist,
   exactly as this line specifies ("backend-owned even though the video itself plays
   client-side").

**Also built, beyond this section's original text (explicit milestone ask, "Data Management"):**
Delete Account workflow (`POST /account/delete-request`\|`/delete-cancel`, `GET
/account/delete-status`) — soft delete with a `ComplianceConfig`-configurable grace period
(default 30 days) during which the account stays fully usable so the user can log back in and
cancel; blocked (`409`) while any non-terminal Request (either side) or pending `PayoutRequest`
exists. Hard delete (`retentionJob.executeScheduledHardDeletes`) is **irreversible PII
anonymization + deactivation, not a literal row delete** — `Transaction`/`Rating`/`Dispute`/
`AdminAuditLog` all FK-reference `User` and must survive per this file's own 7-year retention
rule, so cascade-deleting the row would violate it. Data export (`POST /account/export`, `GET
/account/export`\|`/:id`) generates a JSON bundle synchronously (no job-queue lib in this stack)
and uploads it to Cloudinary as a `raw` resource (one-off inline uploader, mirrors
`profileService`/`disputeService`'s pattern, not `IVideoStorageProvider` — a JSON export isn't a
swappable-provider concern), link expires after 7 days. Privacy Settings hub (`GET
/privacy/settings`) aggregates consent status + deletion status + retention windows for mobile's
Privacy Settings screen, without duplicating the pre-existing notification-preference endpoints
(backend Phase 12). Admin sub-module: `GET /admin/compliance/config`, `PATCH
/admin/compliance/config/:key` (audit-logged via the existing `AdminAuditLog`), `GET
/admin/compliance/deletion-logs` (a new, separate immutable `DataDeletionLog` table — most Phase
13 actions are system/scheduled-job driven with no Admin actor, so they don't fit
`AdminAuditLog`'s `actorId: Admin` shape).

**Exit criteria (met):** verified live end-to-end against the running dev server — consent
accept/status/history round-trip correctly (a fresh user needed re-acceptance on all four types,
accepting flipped `needsReacceptance` to false and recorded the current config version); account
deletion request correctly scheduled a 30-day-out hard delete, `delete-status` reflected it, and
cancel correctly cleared both fields; a real data export round-tripped through Cloudinary (the
generated JSON bundle was fetched back and confirmed to contain the correct profile/consent
data); admin `compliance/config` list/update (audit-logged) and `deletion-logs` (showing both the
deletion-request and cancellation entries) were confirmed; a direct `retentionJob.runSweep()` run
correctly purged 10 expired registration-OTP rows and 1 expired password-reset-OTP row (no other
candidates existed in the seeded dev database, so chat/video/notification purge counts were
correctly 0, not silently skipped — the query logic itself was verified separately by hand
against the repository methods' `where` clauses). Backend `tsc --noEmit`/`npm run build` clean;
server boots cleanly (Redis/Brevo unavailability are pre-existing sandbox limitations, unrelated
to this pass, consistent with prior sessions' notes). **Explicitly out of scope per this
milestone's stop condition:** Production Hardening (Phase 14) and a Final PRD Audit.

---

## Phase 14 — Non-Functional Hardening (carries forward prior "Phase 3/4" scope)

**PRD refs:** §11 (all rows), §12.2, §12.3.

**Status: partially built (2026-07-04, hardened further 2026-07-04 audit pass) — see item-by-item
notes below.** This phase was never a single all-or-nothing gate (per this file's own "Sequencing
Note"); the items below that are genuinely achievable without new infra provisioning (a real
Postgres/Redis-backed CI runner, managed monitoring/alerting SaaS, a load-testing environment)
were built this pass. Items that require infra this codebase has never had provisioned
(backup/PITR, a load-testing harness against a real production-shaped dataset) remain explicitly
open — see item 5.

1. [x] **Automated test framework** — Jest + ts-jest (`jest.config.js`, `npm test`), 30 tests
   across 6 suites (up from 25/4 — see the two new DB/Redis-backed suites below, added in a
   2026-07-04 fresh-audit pass that verified every prior claim in this file against the actual
   codebase rather than trusting it):
   - `src/services/__tests__/requestStateMachine.test.ts` — every documented PRD §5.13 happy-path
     transition, the terminal-state/dispute-reachable-from-terminal-state distinction, and
     `assertTransition`'s `HttpError(409)` behavior.
   - `src/utils/__tests__/geo.test.ts` — `haversineMeters` (including a known real-world
     landmark-to-landmark distance) and `boundingBox`.
   - `src/utils/__tests__/chatContentFilter.test.ts` — every PRD §5.4.2 blocked-pattern category
     (phone/UPI/email/social/URL) plus a clean-message pass-through.
   - `src/utils/__tests__/money.test.ts` — the new shared `splitCommission`/`round2` helpers (see
     item 4 of Phase 11 above), including a "commission + earnings always sums back to the
     input" property check across several amounts.
   - **`src/services/__tests__/escrow.integration.test.ts` (new)** — closes the previously-flagged
     gap. Runs against a real Postgres database (`DATABASE_URL`), exercising
     `escrowService.reserve/release/refund` end-to-end: wallet-balance debits/credits,
     `Transaction` ledger rows, and the double-release/double-refund `409` guards — not just the
     escrow row's `state` field in isolation.
   - **`src/services/__tests__/acceptMutex.integration.test.ts` (new)** — closes the previously-
     flagged mutex/GPS gap. Runs two concurrent `requestService.accept()` calls against a real
     Redis lock (not a mocked lock service) for the same `PUBLISHED` request and asserts exactly
     one wins with the PRD's exact conflict string; a second test asserts the GPS distance-gate
     rejects an out-of-radius Creator before the lock is ever touched, leaving the request
     untouched and the lock unheld.
   - Verified live this pass: all 30 tests pass against the real local Postgres/Redis instances
     (`npm test`); `forceExit: true` added to `jest.config.js` since the Firebase Admin SDK's
     persistent gRPC channel (imported transitively via `notificationService`) has no per-test
     teardown hook and otherwise keeps the process alive after the suite finishes.
2. [x] **CI pipeline** — `.github/workflows/backend-ci.yml` (repo root, not under
   `locator-backend/`): installs deps, generates the Prisma client, `tsc --noEmit`, applies
   migrations against a Postgres service container, runs the Jest suite, then `npm run build` —
   gates on all four. Triggers on push/PR touching `locator-backend/**`. **Updated this pass**: a
   `redis:7-alpine` service container was added (previously only Postgres was provisioned) so the
   new mutex integration test above actually has a real Redis to run against in CI, not just
   locally.
3. [x] `docs/API.md` full catch-up — already current through Phase 13 from prior sessions; this
   pass added the "Admin Dashboard" and "Commission Settings" sections and updated "Audit Logs"/
   "Escrow & Payment Release" for Phase 11's remainder (see above).
4. [x] **Monitoring/alerting** — `src/services/monitoringJob.ts`, swept every 5 minutes from
   `server.ts`, checks the PRD §11-named thresholds (moderation queue depth > 50, pending-payout
   queue > 20, failed Razorpay webhook calls > 5/hour — the last tracked by a new in-memory
   `webhookHealthTracker.ts` rolling window, incremented from `walletController.webhook`'s
   signature-failure/missing-config/processing-error paths) and pushes a new admin-only
   `SYSTEM_THRESHOLD_ALERT` notification (reuses `notificationService.notifyAdmins`, the same
   path `LARGE_REFUND`/`HIGH_PRIORITY_REPORT` already use) when breached, alongside an `info`-level
   structured log line every sweep regardless of breach.
5. [ ] Backup/point-in-time recovery, uptime target (99.5%), API response time targets
   (<500ms p95) — **not built this pass**, genuinely infra-provisioning/managed-service items
   (a managed Postgres provider's PITR settings, an APM/load-testing setup) rather than
   application code — tracked as an open deployment-time task, not an oversight.
6. [x] Security items — re-confirmed still in place (`firebase-service-account.json` gitignored,
   Razorpay signature verification already `crypto.timingSafeEqual`-based, mailService never logs
   the raw Brevo API key). **New this pass**: `src/config/env.ts` now fails fast at boot if
   `NODE_ENV=production` and any of `BREVO_API_KEY`/`BREVO_SENDER_EMAIL`,
   `RAZORPAY_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT_PATH` are unset, `CORS_ORIGIN` is still
   the wildcard `*`, or `ADMIN_PASSWORD` is still the `.env.example` placeholder — these are
   fine to leave unset in development (documented fallbacks already exist for each) but must be
   explicit before production traffic. A new `src/middlewares/authRateLimit.ts` (20 req/15min,
   tighter than the app-wide 100 req/15min limiter) was added to every auth/OTP/admin-login route
   to reduce brute-force/OTP-spam exposure.
7. [x] **Docker** — `Dockerfile` (multi-stage: deps → build → runtime, non-root `node` user,
   container `HEALTHCHECK` against `/health`) and `docker-compose.yml` (Postgres + Redis + the
   API, for local/CI parity — not a production topology; managed Postgres/Redis/Cloudinary/
   Firebase/Razorpay credentials still come from a real `.env` in an actual deployment).
   Migrations are deliberately **not** run from the container's `CMD` — `prisma migrate deploy`
   is meant to run once per release (a CI/CD step), not once per container start, so scaling to
   multiple replicas can never race two containers migrating simultaneously. **Build-verified
   2026-07-04** (previous sessions' sandboxes had no Docker daemon available — this one did):
   `docker build` succeeded end-to-end (deps → `prisma generate` → `tsc` build → runtime image),
   and a full `docker compose up --build` correctly built and started the `postgres`/`redis`/`api`
   containers with healthchecks passing — the `api` container itself couldn't bind its ports in
   this run only because this machine's own local Postgres/Redis dev instances were already
   occupying `5432`/`6379` on the host (a local port collision, not a Dockerfile/compose defect).

---

## Explicitly Not In This Plan (PRD Appendix A — Phase 2/3, do not build)

Live Video Marketplace (public streams/price slabs/viewer purchase), Business Accounts, Social features (follow/likes/comments/leaderboards), Referral & Rewards, Creator Levels/Badges/Gamification, AI Moderation/Fraud Detection, algorithmic Trust Scoring, Right-to-Delete flow, Government Requests handling, Fake-GPS automated detection, Analytics Dashboard for Creators/Requesters, multi-language/international expansion, Appeal System, AI Review Queue, promotional campaigns/premium plans/enterprise APIs. If any of these surface as a request mid-build, treat it as an explicit out-of-band ask (like the pre-existing Location Discovery module) — not part of this plan.

---

## Sequencing Note

Phases 1→8 are strictly sequential (each depends on the previous phase's data/state existing). Phases 9–13 can proceed in parallel once Phase 8 is stable, since they mostly read from or annotate the core lifecycle rather than gating it. Phase 14 is continuous, not a final gate — but Phase 1's state-machine correctness and Phase 8's escrow correctness deserve test coverage before, not after, the rest of the phases pile on top.
