# Locator Backend — Development Guide

**Source of truth: `Locator_App_PRD_v4.pdf` (Unified MVP PRD v2.0, Phase 1 — Live Video Request Platform).** This document translates that PRD into a backend engineering spec. Where this document and the PRD ever disagree, **the PRD wins** — update this file, not the other way around.

This file has two halves:
1. **Target Spec** — what the backend must be, per the PRD, strictly.
2. **Current Implementation vs PRD Gap** — an honest audit of what exists in `locator-backend/src` today against that spec.

Do not treat the "Current Implementation" section as aspirational — it is a snapshot of the actual code. Do not treat the "Target Spec" section as already built — almost none of it exists yet (see Gap section).

---

# 0. What Locator Actually Is (per PRD)

Locator is **not** a generic social/wallet app. It is a single-purpose marketplace for one transaction type:

> A **Requester** posts a paid request for a live video from a specific GPS location. A nearby **Creator** fulfils it by recording live (in-app camera only, no uploads) from that exact location. The video is **manually moderated** before the Requester ever sees it. Payment moves through an **in-app escrow wallet**, released to the Creator (minus platform commission) only after the Requester accepts the video.

Everything in the PRD — chat, GPS proximity, mutex locking, moderation queue, dispute center, ratings — exists to make that one transaction safe, fast, and trustworthy. Any backend feature that isn't in service of this loop is out of PRD scope for Phase 1 (see §8).

**Both roles live on one account.** There is no separate Creator/Requester signup — "Registered User" can act as either, per request (PRD §3.1).

---

# 1. Target Spec — Roles & Permissions (PRD §3)

| Role | Provisioning | Key capabilities |
|---|---|---|
| Guest | Self-registers | Onboarding only — no requests, no wallet |
| Registered User | OTP phone (primary) or email+password (secondary) | Create/accept requests, wallet, chat, ratings, reports |
| Moderator | Admin-provisioned; **a view inside the Admin panel, not a separate account type** | Pre-publish request review, video review, payout approval (when Auto-Payout OFF), suspend users, escalate to Dispute Center |
| Admin | Manually provisioned | Everything Moderator can do, plus full user/finance/dispute/commission/audit management |

Enforce this with the existing `authenticate` (User) / `authenticateAdmin` (Admin) split — **do not** create a third JWT namespace for Moderator. Moderator is `Admin` + a capability flag/role column, not a new principal.

---

# 2. Target Spec — Core Data Model (net-new, on top of existing `User`)

The existing `User` model (name, username, email, password, profileImage, bio, city, latitude, longitude, walletBalance, fcmToken, isActive, isSuspicious) is **reusable as-is** as the account/wallet-ledger foundation. Everything below is new.

### `Request` — the central entity (state machine, PRD §5.13)
Fields needed: `requesterId`, `creatorId?`, `type` (`IMMEDIATE`|`SCHEDULED`), `scheduledAt?`, `latitude`, `longitude`, `locationCategory` (`PUBLIC`|`RESTRICTED`|`PROHIBITED`), `description` (10–300 chars), `durationMinutes` (enum 1/2/5/10/15), `rewardAmount` (₹10–₹2,000), `category` (Traffic/Events/Food & Dining/Public Space/Other), `instructions?` (≤500 chars), `requesterDeclarationAt`, `status` (see state machine table below), `acceptedAt?`, `acceptanceTimerExpiresAt?`, `recordingStartedAt?`, `uploadedAt?`, `moderatorDecisionAt?`, `moderatorRejectionReason?`, `requesterDecisionAt?`, `reshootUsed` (bool, default false), `expiresAt` (created + 24h), `highValueReviewRequired` (bool, reward ≥ ₹1,000), timestamps.

**Status enum** (PRD §5.13, exact 15 states): `DRAFT`, `PUBLISHED`, `CREATOR_ASSIGNED`, `TEMPORARY_CHAT`, `RECORDING`, `UPLOAD`, `MODERATOR_REVIEW`, `REQUESTER_REVIEW`, `RESHOOT_REQUESTED`, `ACCEPTED`, `PAYMENT_RELEASED`, `COMPLETED`, `REJECTED`, `DISPUTED`, `EXPIRED`, `CANCELLED`.

Valid transitions must match the PRD table exactly (§5.13) — do not add shortcut transitions. This state machine is the backbone of the entire product; get it right before building UI against it.

### `RequestEscrow`
One row per `Request`. `requestId`, `amount`, `commissionAmount` (15% at release time — snapshot the rate, don't recompute later if the rate changes), `state` (`RESERVED`|`RELEASED`|`REFUNDED`|`FROZEN`|`SPLIT`), `releasedAt?`, `refundedAt?`. Escrow reservation/release must reuse the existing `Transaction` ledger pattern (atomic `$transaction`, `Decimal` amounts) — do not invent a second money-movement mechanism.

### `RequestChat` / `ChatMessage` — **implemented 2026-07-03** (no separate `RequestChat` table needed)
`ChatMessage`: `requestId`, `senderId`, `body`, `blocked` (bool — logged even when blocked), `blockReason?`, `createdAt`. Opens automatically the instant `POST /requests/:id/accept` succeeds (`Request.status → TEMPORARY_CHAT`, wired directly into `requestService.accept()` right after the mutex-guarded `CREATOR_ASSIGNED` transition — chat "opening" needed no separate table/flag since the `Request.status` enum already is the source of truth). Closes permanently on `Start Recording` (enforced today via a `status !== 'TEMPORARY_CHAT'` → `409` gate on send; the Recording transition itself is Phase 5, not built). Server-side regex blocking is mandatory and implemented (`src/utils/chatContentFilter.ts`: phone numbers, email, WhatsApp/Telegram/Instagram mentions, UPI VPAs, URLs) — blocked rows are persisted for moderation audit but filtered out of `GET .../chat` for the two participants. 3+ blocked attempts on one request sets `Request.chatFlaggedForReview` (bool) for the not-yet-built Moderator queue to consume later. Retention (90 days from request close [PRD REVIEW-tagged], `ComplianceConfig`-configurable) is **implemented 2026-07-04 (backend Phase 13)** — see `retentionJob.ts`.

### `CreatorLock` (Redis, not Postgres)
Atomic mutex, TTL = acceptance timer window (`ACCEPTANCE_TIMER_MINUTES` env var, default 15 —
[PRD REVIEW — suggested 15 min], interim value in effect until client confirms). This is the
PRD's explicit implementation note (§5.5) — Redis `SET key value NX PX ttl`, not a DB row with
a unique constraint (DB-level locking won't give the TTL-based auto-release behavior the PRD
requires). **Redis-backed implementation shipped 2026-07-03**: `src/services/creatorLockService.ts`
defines `CreatorLockService` (`acquire`/`release`/`forceRelease`/`isLocked`) backed by
`ioredis` (`src/config/redis.ts`, `REDIS_URL` env var, retry/health-check/graceful-shutdown
wired into `startupChecks.ts`/`server.ts`). `acquire` returns a per-holder token; `release`
is a compare-and-delete Lua script keyed on that token (a process can only release a lock it
actually holds); `forceRelease` is an unconditional delete reserved for the acceptance-timer
sweep, which has independently confirmed via the DB row that the lock must not survive.
Called by `requestService.accept` (`POST /requests/:id/accept`) and
`acceptanceTimerJob` (expiry sweep).

### `RequestVideo` — **implemented 2026-07-03 (backend Phase 5)**
`requestId`, `creatorId`, `status` (`PENDING|UPLOADING|UPLOADED|FAILED|CANCELLED`),
`storageProvider` (`"cloudinary"` this milestone — see `IVideoStorageProvider` in §5),
`storagePublicId`, `secureUrl`, `thumbnailUrl`, `durationSeconds`/`width`/`height`/
`fileSizeBytes`/`mimeType` (all sourced from Cloudinary's upload response), `gpsLatitude`/
`gpsLongitude`/`recordedAt` (client-reported at upload time), `uploadAttempts`,
`failureReason`. Storage is Cloudinary, **not S3** — the PRD's ephemeral-S3-bucket + 2h/24h
deletion scheduled jobs are not built this pass (tracked for Phase 13's retention jobs
alongside chat retention). Moderation decision fields — **added 2026-07-03 (backend Phase 6)**:
`moderationStatus` (`PENDING|APPROVED|REJECTED`), `moderationRejectionReason` (PRD §7.3 reason
enum), `moderationRemarks`, `moderatedAt`, `moderatedByAdminId` — see `AdminAuditLog` below and
`docs/API.md` "Moderation".

### `Rating`
Mutual: `requestId`, `raterId`, `rateeId`, `stars` (1–5), `comment?`. One Requester→Creator and one Creator→Requester per completed request.

### `Report`
`reporterId`, `reportedUserId`, `requestId?`, `category` (Privacy issue/Wrong location/Abuse/Fake recording/Copyright/Other), `status`. 3 reports within 30 days → auto-suspend pending Admin review — this is a scheduled/triggered check, not a one-off.

### `Dispute`
`requestId`, `raisedBy`, `reason`, `status`, `resolution` (`REQUESTER_FAVOUR`|`CREATOR_FAVOUR`|`PARTIAL`), `splitPercentage?`, `resolvedByAdminId?`, `resolvedAt?`.

### `RestrictedLocation` (Admin-managed list) — **implemented 2026-07-01**
`latitude`, `longitude`, `radiusMeters`, `category` (`RESTRICTED`|`PROHIBITED`), `label?`. CRUD at `/admin/restricted-locations` (`src/repositories/restrictedLocationRepository.ts`, `src/services/restrictedLocationService.ts`, `src/controllers/adminRestrictedLocationController.ts`). Classification is exposed via `src/services/locationCategoryService.ts#classify(lat, lng)` (also reachable directly at `GET /location/classify`): manual-list radius match (haversine, `src/utils/geo.ts`) always wins; falls back to a Google reverse-geocode keyword assist (reusing `placesService.reverseGeocode`) when no manual match and `GOOGLE_PLACES_API_KEY` is set, else defaults to `PUBLIC`. The Google path can only ever produce `PUBLIC`/`RESTRICTED`, never `PROHIBITED` — documented decision, see `docs/MASTER_EXECUTION_PLAN.md` Phase 0.

### `ConsentRecord` — **implemented 2026-07-04 (backend Phase 13)**
Immutable. `userId`, `type` (`TERMS_OF_SERVICE`|`PRIVACY_POLICY`|`COMMUNITY_GUIDELINES`|`RECORDING_POLICY`|`REQUESTER_DECLARATION`|`CREATOR_DECLARATION`), `version`, `requestId?` (set for the two per-request declaration types), `ipAddress?`, `userAgent?`, `acceptedAt`. Never update or delete rows — insert-only, for DPDP audit (PRD §9.1, §5.7.3). `version` is stamped server-side from `ComplianceConfig` (see below), never client-supplied. See `src/services/consentService.ts`, `GET/POST /consent/*`.

### `ComplianceConfig` / `DataExportRequest` / `DataDeletionLog` — **implemented 2026-07-04 (backend Phase 13)**
`ComplianceConfig`: `key` (unique), `value`, `description` — self-seeding Admin-configurable retention windows/consent versions/grace periods (`src/services/complianceConfigService.ts`), the same "don't hardcode a `[REVIEW]` number" pattern already used for `ACCEPTANCE_TIMER_MINUTES`/commission elsewhere, now DB-backed so an Admin can adjust without a redeploy (`GET`/`PATCH /admin/compliance/config*`). `DataExportRequest`: `userId`, `status` (`PENDING`|`PROCESSING`|`READY`|`FAILED`), `fileUrl?`, `expiresAt?` — the right-to-access data export (`src/services/dataExportService.ts`, `POST`/`GET /account/export*`). `DataDeletionLog`: immutable, insert-only audit trail for every destructive/anonymizing Data Management action (account hard-delete, retention purges) — deliberately separate from `AdminAuditLog` since most of these are system/scheduled-job actions with no Admin actor.

### `AdminAuditLog` — **implemented 2026-07-03 (backend Phase 6)**
Immutable, read-only for all roles. Every Admin/Moderator action: `actorId`, `action`, `targetEntityType`, `targetEntityId`, `timestamp`, `metadata?`. `GET /admin/audit-logs`. This pass only writes Moderation actions (`VIDEO_APPROVED`/`VIDEO_REJECTED`) — backfilling existing Admin actions (user block/suspicious, payout approve/reject) is a later Phase 11 item.

### Extend existing models
- `User`: add `trustScoreBadge` (computed, `LOW`|`MEDIUM`|`HIGH`), KYC fields (`kycStatus`, `panNumber?`, `aadhaarNumber?` — only required past ₹50,000 cumulative annual payout, still not built). ~~consecutive-rejection counter (drives the tutorial re-prompt, PRD §5.11b.3)~~ — **implemented 2026-07-04 (backend Phase 13)**: `consecutiveRejections`/`welcomeVideoRepromptPending`, wired into `requesterReviewService`. Also added this phase: `deletionRequestedAt`/`deletionScheduledFor` (Account Deletion soft-delete/grace-period fields).
- `PayoutRequest`: add `viaRazorpayX` (bool), `autoPayoutSnapshot` (was the toggle ON/OFF at request time — for audit).
- `Transaction`: no schema change needed, but every `Request`-driven credit/debit must reference `requestId` via `RequestEscrow`, not float free.

---

# 3. Target Spec — API Surface (net-new modules, PRD §5–§8)

None of these exist today. Build in dependency order (see MASTER_EXECUTION_PLAN.md for sequencing):

| Module | Endpoints (indicative — finalize exact shapes against PRD field tables before coding) |
|---|---|
| Requests | `POST /requests` (create, immediate or scheduled), `GET /requests/:id`, `POST /requests/:id/cancel` (pre-acceptance only), `GET /requests/nearby` (feed, 500m radius, filters), `GET /requests/mine` |
| Fulfilment | `POST /requests/:id/accept` (mutex + GPS check), `POST /requests/:id/recording/start`, `POST /requests/:id/recording/upload` |
| Chat | `GET /requests/:id/chat`, `POST /requests/:id/chat` (server-side content filter) |
| Review | `POST /requests/:id/accept-video`, `POST /requests/:id/request-reshoot`, `POST /requests/:id/reject` |
| Ratings/Reports | `POST /requests/:id/rate`, `POST /reports` |
| Moderation (Admin sub-module) | `GET /admin/moderation/requests` (pre-publish queue), `PATCH /admin/moderation/requests/:id`, `GET /admin/moderation/videos`, `PATCH /admin/moderation/videos/:id`, `POST /admin/moderation/videos/:id/escalate` |
| Dispute Center | `GET /admin/disputes`, `PATCH /admin/disputes/:id/resolve` |
| Restricted Locations | `GET/POST/PATCH /admin/restricted-locations` |
| Commission | `GET/PATCH /admin/settings/commission` |
| Live Monitoring | `GET /admin/live-requests` |
| Audit Logs | `GET /admin/audit-logs` |

Reusable as-is: `/auth/*`, `/profile/*`, `/wallet/create-order`, `/wallet/verify-payment`, `/notifications/*`, `/admin/auth/*`, `/admin/dashboard`, `/admin/users/*`. **Extend, don't replace** `/wallet/withdraw` — it needs the Auto-Payout Toggle + RazorpayX branch added (PRD §5.2.1, §7.2).

---

# 4. Target Spec — Key Business Rules (do not deviate)

- Proximity radius: **500m** [PRD REVIEW — confirm before coding, but this is the only number given, use it as the default]
- Reward: min ₹10, max ₹2,000 (PRD CONFIRMED, Kapila CR-004)
- Platform commission: **15%** [PRD REVIEW — confirm before coding payout logic, but this is the only number given]
- High-value review threshold: reward ≥ ₹1,000 → mandatory Admin review before escrow reservation
- Request expiry: 24h with no Creator acceptance → full auto-refund
- Acceptance timer: Creator must start recording within window [PRD REVIEW — suggested 15 min] or request auto-releases to Searching (Redis TTL)
- Re-shoot: exactly once per request, Creator has [PRD REVIEW — suggested 24h] to re-record
- Minimum wallet top-up ₹10, minimum withdrawal ₹50
- KYC (PAN/Aadhaar) triggers only when cumulative annual payout > ₹50,000
- Video retention: fulfilled videos deleted within 2h of acceptance [REVIEW]; rejected/expired within 24h [REVIEW] — build as scheduled jobs from day one, not backfilled later
- Chat log retention: 90 days [REVIEW]
- All money mutations remain atomic `prisma.$transaction` pairing ledger + escrow state (existing Development Rule, still applies, now scoped to `RequestEscrow` too)
- Idempotency key discipline (existing `order_id` pattern) extends to any new Razorpay/RazorpayX call sites

Every `[REVIEW]`-tagged number above is an open question in the PRD itself — **flag it to the client before hardcoding**, per the PRD's own tagging key. Do not silently pick a value and ship it as final.

---

# 5. Target Spec — Third-Party Additions Required

| Service | Purpose | Status |
|---|---|---|
| RazorpayX | Automated payouts when Auto-Payout Toggle is ON | Not integrated — only base Razorpay (deposits) exists today |
| Redis | Creator mutex lock (TTL), session/webhook caching | Integrated 2026-07-03 (`ioredis`, `REDIS_URL`) — mutex lock only so far; session/webhook caching not needed yet |
| AWS S3 (or equivalent) | Ephemeral video storage pending moderation/delivery | **Not integrated — deliberate milestone substitution**: backend Phase 5 (2026-07-03) uses **Cloudinary** for request-video storage instead (already configured, S3 never provisioned). Fully abstracted behind `IVideoStorageProvider` (`src/services/storage/`) — `recordingService`/`requestService` never reference Cloudinary directly, so adding `S3VideoStorageProvider` later is a new file + a one-line swap in `src/services/storage/index.ts`, not a rewrite. |
| WebRTC / managed streaming service | Live in-app recording + upload | Not integrated — this milestone uses camera-only in-app recording (mobile: `react-native-vision-camera`) followed by a file upload, not live WebRTC streaming, matching the PRD's "record live in-app camera only, no uploads [of pre-existing files]" phrasing (§0) — recording happens in-app, only the finished file is uploaded. |
| Google Maps / Geocoding API | Restricted Location Engine (category classification), map pin, reverse geocode | Integrated 2026-07-01 as a best-effort assist behind the manual list (reuses the existing `GOOGLE_PLACES_API_KEY` and `placesService.reverseGeocode` — see §2 `RestrictedLocation`); this is intentionally the *same* key as the non-PRD Places module (§8) but a materially different call site/purpose — don't conflate the two modules themselves |

---

# 6. Current Implementation vs PRD Gap (audited against `locator-backend/src`, 2026-07-01)

**Bottom line: the current backend is a generic auth/wallet/admin scaffold for a *different* product. Zero PRD-domain features exist.** No `Request` model, no escrow-per-transaction, no chat, no moderation queue, no GPS proximity matching, no ratings, no disputes, no restricted-location engine, no RazorpayX, no Redis, no video storage/streaming.

### Reusable as foundation (keep, extend)
- **Tech stack** — Node 22, TypeScript strict, Express 5, PostgreSQL, Prisma 6, Zod 4, JWT, bcrypt, winston, helmet/cors/rate-limit. All matches PRD's confirmed stack (§14). No stack change needed.
- **Layering** — Route → validate → authenticate → Controller → Service → Repository/Prisma. Keep this pattern for all new PRD modules.
- **`User` model** — name/username/email/password/profileImage/bio/city/lat/lng/walletBalance/fcmToken/isActive/isSuspicious covers the "Registered User" account shape almost entirely (PRD §3.1, §5.1). Add trust-score/KYC/rejection-counter fields per §2 above.
- **Auth** — OTP-based registration (currently email OTP; PRD wants **phone OTP primary**, email+password secondary — flip the primary channel, see §7), JWT session, forgot/reset password. Reusable pattern, needs phone-OTP channel added.
- **Wallet ledger** — `Transaction` (CREDIT/DEBIT, Razorpay order/payment IDs, atomic `$transaction` balance updates), Razorpay deposit flow with HMAC verification. This is exactly the escrow *ledger mechanics* the PRD needs — reuse it, wrap it with `RequestEscrow` on top rather than replacing it.
- **Payout flow** — `PayoutRequest` (PENDING/APPROVED/REJECTED), admin approve/reject. This is the "Auto-Payout Toggle OFF" path already, half-built. Needs: the Toggle itself, RazorpayX branch for "ON", and linkage to `Request` completion instead of standalone withdrawal requests only.
- **Notifications** — FCM push + in-app feed (token registration / read / read-all / unread-count / preferences). **Full §8.1/§8.2 trigger matrix implemented 2026-07-04 (backend Phase 12)** — see §6 below and `docs/API.md` "Notifications" for the complete type-by-type table.
- **Admin auth + dashboard shell** — separate JWT namespace, KPI tiles, user block/suspicious toggle, transaction CSV export. Reusable shell; KPIs need to be redefined per PRD §5.14.1 (Total Requests Today, Active Requests, Moderation Queue depth, etc. — currently generic user/revenue counts).
- **Validation/error/logging conventions** — Zod + shared `validate` middleware, single `HttpError` + global handler, winston logging. Keep as-is for new modules.

### Not started (100% net-new against this codebase)
- `Request` entity + full 15-state lifecycle state machine (§5.13) — the single most important missing piece; nothing else in the PRD works without it
- ~~GPS proximity validation/matching (500m radius)~~ — **discovery-side implemented 2026-07-03**: `GET /requests/nearby`/`/available`/`/:id/details`, `src/services/creatorMatchingService.ts` (haversine-over-bounding-box, see `src/utils/geo.ts`). ~~Accept-time GPS validation (mutex acceptance) is still not built~~ — **implemented 2026-07-03**, see `POST /requests/:id/accept` below.
- ~~Creator Locking / mutex (Redis)~~ — **implemented 2026-07-03**: Redis (`ioredis`) is now in the stack (`REDIS_URL`, `src/config/redis.ts`), `src/services/creatorLockService.ts` is a real `SET NX PX` mutex (not the in-memory placeholder), and `POST /requests/:id/accept` is built (business rules: published/not-expired/not-own-request/online/prohibited-block/distance-gate/idempotent-retry/conflict-response), with an acceptance-timer expiry sweep (`src/services/acceptanceTimerJob.ts`) that releases the lock and republishes the request.
- ~~Temporary chat + server-side content filtering~~ — **implemented 2026-07-03**: `ChatMessage` model, `GET/POST /requests/:id/chat`, `src/utils/chatContentFilter.ts`. Chat retention purge job (90 days, configurable) — **implemented 2026-07-04, backend Phase 13** (`retentionJob.purgeExpiredChatMessages`).
- ~~Recording/upload pipeline (in-app camera only, GPS+timestamp metadata, minimum duration enforcement)~~ — **implemented 2026-07-03 (backend Phase 5)**: `RequestVideo` model, `src/services/recordingService.ts`, `POST /requests/:id/recording/start`, `POST/GET/DELETE /requests/:id/video[/...]`. Storage is **Cloudinary**, not S3 (S3 was never provisioned — see §5 below), behind `IVideoStorageProvider` (`src/services/storage/`) so a later S3 swap needs no business-logic changes. Moderator-portal notification is not built (Phase 6 doesn't exist yet) — see `docs/MASTER_EXECUTION_PLAN.md` Phase 5.
- ~~Manual Moderation workflow (pre-publish + video review queues, GPS map view, reject reasons)~~ — **video review queue implemented 2026-07-03 (backend Phase 6)**: `RequestVideo.moderationStatus`/`moderationRejectionReason`/`moderationRemarks`/`moderatedAt`/`moderatedByAdminId`, `src/services/moderationService.ts`, `GET /admin/moderation/videos`(`/history`), `GET .../videos/:videoId` (GPS map comparison + timestamp check), `PATCH .../approve`\|`/reject`, bulk approve/reject, `AdminAuditLog`. Approve → `REQUESTER_REVIEW`; reject (mandatory reason) → back to `RECORDING` for a re-shoot (this milestone's explicit instruction — not the terminal `REJECTED` state, which stays reserved for Phase 7's Requester-side dispute path). The **pre-publish (high-value DRAFT) queue and Escalate-to-Dispute-Center action are still not built** — explicitly out of this milestone's scope, see `docs/MASTER_EXECUTION_PLAN.md` Phase 6. Escrow handling per §7.3's rejection-reason table remains unbuilt (`RequestEscrow` doesn't exist — Phase 8).
- ~~Requester Review & Re-shoot workflow~~ — **implemented 2026-07-03 (backend Phase 7), excluding Dispute-routing/auto-escalation by this milestone's explicit scope cut**: `src/services/requesterReviewService.ts`, `POST /requests/:id/accept-video`\|`/request-reshoot`\|`/reject`, `Request.reshootCount`/`requesterReviewRemarks`/`requesterRejectionReason`/`reshootReason` (`reshootUsed`/`requesterDecisionAt` already existed). Accept → `ACCEPTED`; re-shoot (once only, server-enforced) chains `REQUESTER_REVIEW → RESHOOT_REQUESTED → RECORDING`; reject → the existing terminal `REJECTED` state (not a `Dispute` row — Disputes/Escrow are separate, unbuilt phases, out of this milestone). `GET /requests/:id/video/history` added (full recording-attempt audit trail, oldest-first) alongside this. See `docs/API.md` "Requester Review & Re-shoot".
- ~~Mutual Ratings, Report/Abuse workflow with 3-strikes auto-suspend~~ — **implemented
  2026-07-03 (backend Phase 9)**: `Rating`/`Report` models, `src/services/{ratingService,
  reportService}.ts`, `POST /requests/:id/rate`, `GET /requests/:id/rating`, `POST /reports`,
  full Admin Report Queue (`/admin/reports*`). "3-strikes" is implemented as a **suspend-
  recommendation** (reuses the existing `User.isSuspicious` flag, Admin still acts on it) rather
  than a literal auto-suspend, per this milestone's interim decision — see `docs/API.md`
  "Ratings, Reviews & Reporting".
- ~~Requester Trust Profile (rating/completion%/cancellation%/trust badge/report count/account age)~~ —
  **implemented 2026-07-03 (backend Phase 10), expanded to a Creator profile + composite Trust
  Score + 5 named badges + verification status/manual review notes by explicit milestone
  instruction** (beyond this section's original "no composite score" framing) —
  `src/services/trustScoreService.ts`, `GET /trust-profile/me`\|`/:userId`, full Admin sub-module
  (`/admin/trust-profiles*`). See `docs/API.md` "Trust Profile" and `docs/MASTER_EXECUTION_PLAN.md`
  Phase 10.
- ~~Restricted Location Engine (Public/Restricted/Prohibited classification + Admin-managed list)~~ — implemented 2026-07-01, see §2 above. Still not wired into request creation (Phase 1/2 don't exist yet).
- Auto-Payout Toggle (ON/OFF) + RazorpayX integration
- ~~Dispute Center (Admin arbitration, partial-refund splits)~~ — **implemented 2026-07-03
  (backend Phase 11)**: `Dispute`/`DisputeMessage`/`DisputeEvidence` models, `disputeService`,
  `POST /disputes`, `GET /disputes/mine`\|`/:id`, `POST /disputes/:id/messages`\|`/evidence`, full
  Admin sub-module (`/admin/disputes*` — queue/stats/detail/assign/messages/evidence/notes/
  audit-log/resolve/close/reopen). See `docs/API.md` "Dispute Center" and
  `docs/MASTER_EXECUTION_PLAN.md` Phase 11 item 1.
- ~~Live Monitoring Dashboard, Active Request Dashboard~~ — **implemented 2026-07-04 (backend
  Phase 11 remainder)**: `GET /admin/dashboard/live-monitoring`\|`/active-requests`
  (`adminService.getLiveMonitoring`/`getActiveRequests`), composed from the same
  moderation/dispute/request services their own dedicated screens already use. Moderation Queue
  itself was already built (backend Phase 6) — see above.
- ~~Commission Settings (configurable %, audit-logged)~~ — **implemented 2026-07-04**:
  `COMMISSION_RATE_PERCENT` moved from a hardcoded constant into the existing
  Admin-editable/audit-logged `ComplianceConfig` table (backend Phase 13's infrastructure,
  reused rather than duplicated) — `GET`/`PATCH /admin/compliance/config[/COMMISSION_RATE_PERCENT]`.
- ~~Admin Audit Logs (immutable action log)~~ — model/endpoint implemented 2026-07-03 (backend
  Phase 6); **backfilled 2026-07-04 (backend Phase 11 remainder)** for user block/suspicious
  toggles and payout approve/reject (`adminService.toggleBlock`/`toggleSuspicious`/
  `processPayout` now call `adminAuditLogService.log`) — prospective only, not retroactive.
- ~~Consent records for Recording Policy / Requester & Creator declarations~~ — **implemented
  2026-07-04 (backend Phase 13)**: `ConsentRecord` model (immutable, insert-only), `consentService`,
  `POST /consent/accept`, `GET /consent/status`\|`/history`. Requester/Creator per-request
  declarations are now also logged as `ConsentRecord` rows, additively, from
  `requestService.create`/`recordingService.startRecording` — alongside, not replacing, the
  pre-existing `requesterDeclarationAt`/`creatorDeclarationAt` timestamps.
- ~~Nearby Request Feed~~ — **implemented 2026-07-03**, see the GPS proximity note above. ~~Push-broadcast-on-publish to eligible creators is still not built~~ — **implemented 2026-07-03**: wired into `requestService.create`'s immediate-publish path and the scheduled-publish lifecycle sweep, via `creatorMatchingService.findEligibleCreatorsForRequest()` + `fcmService.sendToMultiple`.
- ~~Tutorial & Welcome Video trigger logic (first-login + 3-consecutive-rejections re-prompt)~~ —
  **backend half implemented 2026-07-04 (backend Phase 13)**: `User.consecutiveRejections`/
  `welcomeVideoRepromptPending`, wired into `requesterReviewService.reject`/`.acceptVideo`,
  `POST /account/welcome-video-ack`. The welcome-video screen itself remains unbuilt (mobile
  Phase 1, Onboarding Overhaul — not started), per this section's "backend-owned even though the
  video itself plays client-side" framing.
- ~~Data retention/deletion scheduled jobs (video 2h/24h deletion, chat 90-day purge)~~ —
  **implemented 2026-07-04 (backend Phase 13)**: `retentionJob.ts` (chat/video-asset/notification
  purges, inactive-account cleanup, expired-draft cleanup, scheduled hard-deletes), every window
  DB-configurable via a new `ComplianceConfig` model (Admin-editable, self-seeding defaults).
  Transaction/GPS-metadata (7yr) and moderation-decision-log (3yr) retention remain
  purge-exempt by explicit design — only their *commitment* is exposed in
  `GET /admin/compliance/config`, nothing ever deletes those rows. Also built, beyond this
  section's original scope: Delete Account (soft delete + grace-period + hard-delete scheduler,
  `accountDeletionService`), Data Export (`dataExportService`, Cloudinary-hosted JSON bundle),
  Privacy Settings hub (`privacyService`), and a new immutable `DataDeletionLog` audit table
  (separate from `AdminAuditLog`, since most Phase 13 actions have no Admin actor). See
  `docs/API.md` "Compliance, Consent, Privacy & Data Retention" and
  `docs/MASTER_EXECUTION_PLAN.md` Phase 13.
- Video/live-streaming infrastructure entirely (no WebRTC, no S3 video pipeline)
- ~~Notification Expansion (full §8.1/§8.2 trigger matrix + 3-category preferences)~~ —
  **implemented 2026-07-04 (backend Phase 12)**: `src/services/notificationService.ts`
  (centralized entry point, wraps the pre-existing `fcmService`) + `notificationTypes.ts`
  (canonical type/category matrix), every business-event trigger wired across the codebase, a
  new `notificationReminderJob.ts` (recording/review/rating reminders), `User.notifyRequestActivity`/
  `notifyPaymentWallet`/`notifyPlatformAlerts` preference flags (safety-critical types bypass
  them), `GET/PATCH /notifications/preferences`, `GET /notifications/unread-count`. See
  `docs/API.md` "Notifications" and `docs/MASTER_EXECUTION_PLAN.md` Phase 12.

### Out of PRD scope — exists today, not requested by PRD, do not expand
- **Location Discovery module** (`SavedPlace`, `SearchHistoryEntry`, Google Places nearby/search/details/favorites/history proxy, in-memory TTL cache, per-user rate limiting) — this was built on a separate, explicit ad-hoc request unrelated to this PRD. The PRD's only location-related backend need is the **Restricted Location Engine** (§5.7) and GPS proximity matching for requests — a materially different, narrower feature. Do not conflate the two; do not build PRD location features on top of this module without re-checking it actually fits (it almost certainly doesn't — it has no radius-matching, no request-linkage, no category classification).
- Generic "Live" tab / streaming placeholder concepts referenced elsewhere in this repo's history are **not** the PRD's Live Video *Request* platform — the PRD is explicitly a request/fulfilment marketplace, not a live-streaming/marketplace-viewing product (that's "Use Case 2," explicitly out of scope, PRD §2.3/§1.1).

---

# 7. Immediate Decisions Needed Before Coding Starts

1. **Auth channel priority** — PRD says OTP phone login is primary, email+password secondary (§3.1, §5.1.1). Current code has email-OTP as the only registration path. Needs an SMS/OTP gateway (MSG91/Twilio per PRD §12.2) integrated, and a decision on whether to keep email+password as a true secondary path or migrate.
2. All `[REVIEW]`-tagged numeric constants in §4 above — must be confirmed with the client before being hardcoded into validation schemas, timers, or the commission calculation.
3. RazorpayX feasibility/cost (payout charges, commission structure) — PRD explicitly flags this as unconfirmed (§1.3, §5.2.1, §7.2).
4. ~~Google Maps/Geocoding API feasibility & cost for the Restricted Location Engine~~ — resolved 2026-07-01: manual list is the source of truth (and the only path that can produce `PROHIBITED`); Google reverse-geocode is layered on as a `RESTRICTED`-only assist reusing the existing key, so no new cost commitment was required. Actual per-call Geocoding API billing/quota still needs client sign-off before production traffic relies on it.

---

# 8. Development Rules (still apply, extended)

All prior rules from this doc's earlier revisions still hold:
1. Never break existing APIs without a coordinated mobile update — no versioning exists (`/api/...`, no `/v1/`).
2. Preserve Route → Controller → Service → Repository layering for all new PRD modules.
3. Prefer a repository method over raw `prisma` calls in services (existing inconsistency — `Transaction`/`PayoutRequest`/`Notification` — should be fixed as part of building the new `Request`-adjacent repositories, not perpetuated).
4. Use the shared `validate` middleware + `src/validations/` schemas for every new endpoint.
5. Update `docs/API.md` whenever a route/shape changes.
6. Run `prisma migrate dev` for every schema change; never hand-edit an applied migration.
7. All money-related mutations (`RequestEscrow` transitions included) must be atomic `$transaction` blocks.
8. Never commit secrets (`.env`, `firebase-service-account.json`, RazorpayX keys).
9. New env vars go through `config/env.ts`'s Zod schema.
10. **New rule for this phase:** every new PRD module must be traceable to a specific PRD section number in its PR description or top-of-file comment — this keeps "strict to the PRD" enforceable as the codebase grows.
11. **New rule:** do not silently invent values for anything tagged `[REVIEW]` in the PRD — either surface it as a configurable Admin setting (commission %, proximity radius, timers already are, per §5.14.8) or explicitly flag it for client confirmation before merging.

---

For the concrete, sequenced build plan derived from this spec, see [MASTER_EXECUTION_PLAN.md](./MASTER_EXECUTION_PLAN.md).
