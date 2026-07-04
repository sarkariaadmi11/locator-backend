# Locator API Documentation

Base URL: `http://localhost:4000/api`

Protected endpoints require:

```http
Authorization: Bearer <jwt>
```

## POST `/auth/register`

Sends a 6 digit verification code to the signup email. The account is not
created until the code is verified.

```json
{
  "name": "Jaspreet Singh",
  "username": "jaspreet",
  "email": "jaspreet@example.com",
  "password": "password123"
}
```

Returns `200` with `{ email, expiresInMinutes }`.

## POST `/auth/register/verify-otp`

Verifies the email OTP, creates the account, and returns auth credentials.

```json
{
  "name": "Jaspreet Singh",
  "username": "jaspreet",
  "email": "jaspreet@example.com",
  "password": "password123",
  "otp": "123456"
}
```

Returns `201` with `{ user, token }`.

## POST `/auth/login`

```json
{
  "email": "jaspreet@example.com",
  "password": "password123"
}
```

Returns `200` with `{ user, token }`.

## GET `/auth/me`

Protected. Returns the authenticated user.

## PUT `/profile/update`

Protected.

```json
{
  "name": "Jaspreet Singh",
  "username": "jaspreet",
  "bio": "Building local-first products."
}
```

## POST `/profile/upload-image`

Protected multipart form-data.

| Field | Type |
| --- | --- |
| `image` | file |

## POST `/location/save`

Protected. Save either a city:

```json
{
  "city": "Mumbai"
}
```

Or coordinates:

```json
{
  "latitude": 19.076,
  "longitude": 72.8777
}
```

## GET `/home`

Protected. Returns wallet balance, profile summary, location display data, and feed items.

## POST `/wallet/webhook`

Public (no JWT) — called server-to-server by Razorpay. Verifies the
`x-razorpay-signature` header (HMAC-SHA256 of the raw request body against
`RAZORPAY_WEBHOOK_SECRET`) before processing. Returns `503` if
`RAZORPAY_WEBHOOK_SECRET` is not configured, `400` on a missing/invalid
signature. Handles `payment.captured` (marks the matching `PENDING`
transaction `SUCCESS` and credits the wallet) and `payment.failed` (marks it
`FAILED`). Idempotent — redelivered events for an already-resolved
transaction are safe no-ops, so Razorpay's automatic retries cannot
double-credit a wallet.

## POST `/admin/transactions/reconcile-pending`

Protected (admin). Finds deposit transactions still `PENDING` after 30
minutes and queries Razorpay directly for each order's true payment status,
resolving them to `SUCCESS`/`FAILED` as appropriate. Recovers transactions
left stranded by a client that closed the app before calling
`/wallet/verify-payment` and before any webhook was delivered. Returns
`{ checked, results }`.

## Location Discovery (`/places`)

Protected (all routes require a user JWT). `GET /places/nearby`, `GET /places/search`,
`GET /places/details/:id`, and `GET /places/reverse-geocode` proxy the Google Places /
Geocoding APIs (requires `GOOGLE_PLACES_API_KEY`; returns `503` if unconfigured) and are
rate-limited to 30 requests/minute per user. Favorites/history routes are plain DB
access and are not subject to that limiter.

### GET `/places/nearby`

Query: `lat`, `lng` (required), `radius` (meters, default `1500`, max `50000`),
`category` (optional, passed through to Google's `type` param), `pageToken` (optional —
Google's opaque, short-lived pagination token; a follow-up request must repeat the
original `lat`/`lng`/`radius`/`category`).

Returns `{ results: PlaceSummary[], nextPageToken: string | null }`.

```json
{
  "placeId": "ChIJ...",
  "name": "Cafe Tesu",
  "address": "4, Sri Aurobindo Marg, New Delhi",
  "latitude": 28.544,
  "longitude": 77.201,
  "category": "cafe",
  "rating": 4.4,
  "userRatingsTotal": 5369,
  "photoReference": "AaVGc3l6...",
  "openNow": true
}
```

### GET `/places/search`

Query: `query` (required), `lat`/`lng` (optional, biases results), `pageToken`
(optional). Response shape identical to `/places/nearby`.

### GET `/places/details/:id`

`id` = Google `placeId`. Returns a `PlaceSummary` plus `phoneNumber`, `website`,
`openingHours` (string array), `photoReferences` (string array).

### GET `/places/reverse-geocode`

Query: `lat`, `lng` (required). Returns `{ formattedAddress, placeId, latitude, longitude }`.

### POST `/places/favorites`

```json
{
  "placeId": "ChIJ...",
  "name": "Constitution Club",
  "address": "Rafi Marg, New Delhi",
  "latitude": 28.6196,
  "longitude": 77.2133,
  "category": "cafe",
  "label": "Work lunch spot"
}
```

Returns `201` with the created `SavedPlace`, or `200` with the existing row if already
saved (idempotent re-favorite).

### DELETE `/places/favorites/:id`

`id` = `SavedPlace.id`. Returns `null`. `404` if not found or not owned by the caller.

### GET `/places/favorites`

Query: `page` (default `1`), `limit` (default `20`, max `50`). Returns
`{ items: SavedPlace[], page, hasMore }`.

### GET `/places/history`

Query: `page`, `limit`. Returns `{ items: SearchHistoryEntry[], page, hasMore }`.
Every `/places/nearby`, `/places/search`, and `/places/details/:id` call (excluding
`pageToken` follow-ups) records a history entry; per-user history is capped at the 50
most recent entries.

### DELETE `/places/history`

Clears all search history for the authenticated user. Returns `null`.

## Restricted Location Engine (PRD §5.7.2)

Classifies a GPS point as `PUBLIC` / `RESTRICTED` / `PROHIBITED`. A manual admin-curated list is
checked first (and always wins); if no manual match, and `GOOGLE_PLACES_API_KEY` is configured, a
reverse-geocode keyword check is used as a best-effort assist. Google's assist can only ever
produce `PUBLIC` or `RESTRICTED` — `PROHIBITED` (hard block) is manual-list-only by design, since
an automated keyword match is a false-positive risk not worth hard-blocking on. See
`src/services/locationCategoryService.ts`.

### GET `/location/classify`

Auth: user (`authenticate`). Query: `lat`, `lng`. Returns:
```json
{
  "category": "PUBLIC | RESTRICTED | PROHIBITED",
  "source": "MANUAL_LIST | GOOGLE_GEOCODE | DEFAULT",
  "matchedLocation": {"id": "...", "label": "..."},
  "reverseGeocode": {"formattedAddress": "...", "placeId": "...", "latitude": 0, "longitude": 0}
}
```
`matchedLocation` is present only when `source` is `MANUAL_LIST`; `reverseGeocode` only when
`source` is `GOOGLE_GEOCODE`.

## Restricted Locations (Admin)

Auth: admin (`authenticateAdmin`). Manual-list CRUD backing the engine above.

- `GET /admin/restricted-locations` — query `page`, `limit`. Returns `{items, total, page, limit}`.
- `POST /admin/restricted-locations` — body `{latitude, longitude, radiusMeters, category: "RESTRICTED"|"PROHIBITED", label?}`.
- `PATCH /admin/restricted-locations/:id` — same body, all fields optional.
- `DELETE /admin/restricted-locations/:id`.

## Requests (PRD §5)

The `Request` domain: creation, ownership CRUD, and the pre-fulfilment lifecycle
(publish/expire). Creator matching, chat, recording, and moderation are separate domains (see
`docs/MASTER_EXECUTION_PLAN.md` Phases 3-6). Escrow reservation now happens inline at creation
(backend Phase 8 — see "Escrow & Payment Release" below): creation debits the Requester's
wallet for the full `rewardAmount` and reserves a `RequestEscrow` row in the same call, `402` if
the balance is insufficient. The full 15-state PRD §5.13 status enum is modelled
(`src/services/requestStateMachine.ts`); `DRAFT → PUBLISHED → CANCELLED/EXPIRED` are the
transitions reachable via these endpoints specifically, with cancel/expiry both triggering an
escrow refund.

Every request's location is classified via the Restricted Location Engine
(`GET /location/classify`, see above) at creation time: `PROHIBITED` hard-blocks creation,
`RESTRICTED` is stored and allowed (admin-flagging queue is a future phase), `PUBLIC` is
allowed. `formattedAddress` is best-effort reverse-geocoded and can be `null` if
`GOOGLE_PLACES_API_KEY` isn't configured or the lookup fails.

### POST `/requests`

Auth: user. Body:
```json
{
  "type": "IMMEDIATE | SCHEDULED",
  "scheduledAt": "ISO date, required if type=SCHEDULED, must be in the future",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "radiusMeters": 500,
  "description": "10-300 chars",
  "durationMinutes": 1,
  "rewardAmount": 100,
  "category": "TRAFFIC | EVENTS | FOOD_DINING | PUBLIC_SPACE | OTHER",
  "instructions": "optional, <=500 chars",
  "requesterDeclaration": true
}
```
`durationMinutes` must be one of `1, 2, 5, 10, 15`. `rewardAmount` range ₹10-₹2,000; reward
≥ ₹1,000 sets `highValueReviewRequired: true` and the request stays `DRAFT` pending mandatory
Admin review (queue not yet built — high-value requests still reserve escrow immediately, they
just don't auto-publish). Insufficient wallet balance returns `402` before anything is created.
A `PROHIBITED` location returns `422`. Otherwise an `IMMEDIATE`, non-high-value request
auto-publishes (`status: "PUBLISHED"`) immediately; a `SCHEDULED` one stays `DRAFT` until
`scheduledAt` (published by the in-process lifecycle sweep, see below). Returns the created
request (see shape under `GET /requests/:id`).

### GET `/requests/mine`

Auth: user. Query: `page`, `limit`, `status?` (any of the 15 status values). Returns
`{items: Request[], total, page, limit}`, requester's own requests only, newest first.

### GET `/requests/:id`

Auth: user, owner-only (404 otherwise — Creator-side visibility is a future phase). Returns:
```json
{
  "id": "...", "requesterId": "...", "creatorId": null,
  "type": "IMMEDIATE", "scheduledAt": null,
  "location": {"latitude": 0, "longitude": 0, "formattedAddress": "...", "category": "PUBLIC", "radiusMeters": 500},
  "description": "...", "durationMinutes": 5, "rewardAmount": 100,
  "category": "OTHER", "instructions": null,
  "status": "PUBLISHED", "highValueReviewRequired": false, "reshootUsed": false,
  "requesterDeclarationAt": "...", "acceptedAt": null, "acceptanceTimerExpiresAt": null,
  "recordingStartedAt": null, "uploadedAt": null, "moderatorDecisionAt": null,
  "moderatorRejectionReason": null, "requesterDecisionAt": null,
  "cancelledAt": null, "cancellationReason": null,
  "expiresAt": "...", "createdAt": "...", "updatedAt": "..."
}
```

### PATCH `/requests/:id`

Auth: user, owner-only. Body: any of `description`, `durationMinutes`, `rewardAmount`,
`category`, `instructions` (same validation as create). Only allowed while `status: "DRAFT"`
(409 otherwise). Re-evaluates `highValueReviewRequired` if `rewardAmount` changes.

### POST `/requests/:id/cancel`

Auth: user, owner-only. Body: `{reason?: string}`. Pre-acceptance only — allowed from
`DRAFT` or `PUBLISHED` (409 otherwise, per PRD §5.3.2 "no penalty" rule). No escrow refund
happens yet since escrow doesn't exist; this only flips `status → CANCELLED`.

### Lifecycle sweep (internal, no endpoint)

`src/services/requestLifecycleJob.ts`, run every 5 minutes from `src/server.ts` via
`setInterval` (no job queue exists in this stack yet — see `docs/CLAUDE.md` §5):
publishes `SCHEDULED` requests once `scheduledAt` arrives, and expires `DRAFT`/`PUBLISHED`
requests past `expiresAt` (`status → EXPIRED`). Escrow refund-on-expiry (PRD §7.3) is not
wired here — only the status transition is applied.

## Creator Discovery & Matching (PRD §5.5, §5.11)

Nearby-request discovery for Creators. All eligibility/ordering logic lives in
`src/services/creatorMatchingService.ts` — controllers only parse query params and call it,
per `docs/CLAUDE.md`'s "no matching logic in controllers" rule. Accept/mutex-locking
(`POST /requests/:id/accept`, see "Request Acceptance & Fulfilment" below) is now built —
`src/services/creatorLockService.ts` is a Redis-backed (`ioredis`) atomic mutex, not the
in-memory placeholder from the discovery-only pass.

A request is discoverable to a Creator when: `status: "PUBLISHED"` (not `DRAFT`, and not
`CREATOR_ASSIGNED`+ — those are already locked to another creator), not the creator's own
request, and not past `expiresAt`. Distance uses the haversine formula
(`src/utils/geo.ts#haversineMeters`) over a SQL bounding-box prefilter
(`src/utils/geo.ts#boundingBox`) — adequate at MVP scale, not a PostGIS radius query.

### GET `/requests/nearby`

Auth: user (acting as Creator). Query: `latitude`, `longitude` (required), `radiusMeters`
(100-2000, default 500), `category?`, `minReward?`, `maxReward?`, `type?`
(`IMMEDIATE`/`SCHEDULED`), `page` (default 1), `limit` (default 20, max 100). Returns
`{items: RequestWithDistance[], total, page, limit}`, nearest-first. Each item is the same
shape as `GET /requests/:id` plus `distanceMeters` (rounded, integer).

### GET `/requests/available`

Auth: user. No-GPS fallback feed (PRD §5.11.1) for creators without location permission —
same filters as `/nearby` minus `latitude`/`longitude`/`radiusMeters`, sorted newest-first
(no distance). Returns the same page shape; items have no `distanceMeters`.

### GET `/requests/:id/details`

Auth: user. Creator-facing detail view — unlike `GET /requests/:id` (owner-only), any
authenticated user may view a non-`DRAFT` request. Query: `latitude?`, `longitude?` (if
given, adds `distanceMeters` to the response). Returns the standard request shape plus:
```json
{"distanceMeters": 60, "isOwnRequest": false, "isLocked": false, "isVisible": true}
```
`isLocked` is `true` once status has moved past `PUBLISHED` (i.e. another creator has it).
`isVisible` mirrors `creatorMatchingService.isVisibleToCreator` — `false` for own requests,
locked requests, or expired ones.

## Request Acceptance & Fulfilment (PRD §5.5)

### POST `/requests/:id/accept`

Auth: user (acting as Creator). Body: `{latitude: number, longitude: number}` — the
Creator's current position, checked fresh at accept-time (distinct from whatever was last
synced via `PATCH /creator/location`).

Business rules, checked in order, each returning the stated status:
1. `404` if the request doesn't exist.
2. Idempotent short-circuit: if this same Creator already holds it (`status:
   "CREATOR_ASSIGNED"` and `creatorId` = caller), returns `200` with the current row —
   a retried request (e.g. a lost response after a network blip) is not an error.
3. `403` "You cannot accept your own request." if the caller is the requester.
4. `403` "This request cannot be accepted." if `locationCategory: "PROHIBITED"` (defensive —
   `PROHIBITED` requests are already hard-blocked at creation and never reach `PUBLISHED`).
5. `409` "This request has already been accepted by another creator." if `status` isn't
   `PUBLISHED` (someone else already holds it, or it moved to a terminal state).
6. `409` "This request has expired." if past `expiresAt`.
7. `403` "You must be Online to accept requests." if the Creator's `availabilityStatus` isn't
   `ONLINE`.
8. `403` "You must be within {radiusMeters} metres of the requested location to fulfil this
   request." if the haversine distance from the body's coordinates to the request exceeds
   `radiusMeters`.
9. Redis mutex acquire (`SET key value NX PX ttl`, `ttl = ACCEPTANCE_TIMER_MINUTES` minutes,
   key `request:{id}:creator-lock`) — `409` with the same "already accepted" message if
   another process already holds it. This is the authoritative race-breaker: exactly one of
   two simultaneous callers gets the lock.
10. Conditional DB update (`UPDATE ... WHERE id = ? AND status = 'PUBLISHED'`) — if the row
    changed underneath between step 5's read and here (extremely narrow window), the lock is
    released and the same `409` is returned.

On success: `status → CREATOR_ASSIGNED` then immediately `→ TEMPORARY_CHAT` (chat opens
automatically the instant GPS-validated acceptance completes, PRD §5.4 — `CREATOR_ASSIGNED`
itself is a transient intermediate state, not one a client will typically observe), `creatorId`
set, `acceptedAt` = now, `acceptanceTimerExpiresAt` = now + `ACCEPTANCE_TIMER_MINUTES`. The
Requester is pushed ("Creator found!"). Returns the standard request shape with
`status: "TEMPORARY_CHAT"`.

### Acceptance-timer expiry (internal, no endpoint)

`src/services/acceptanceTimerJob.ts`, swept every 30 seconds from `src/server.ts`. Finds
`TEMPORARY_CHAT` requests whose `acceptanceTimerExpiresAt` has passed (i.e. the Creator never
advanced to Recording — that phase isn't built yet, so today this always means "never
started"), transitions `status → PUBLISHED` (republish), clears `creatorId`/`acceptedAt`/
`acceptanceTimerExpiresAt`, force-releases the Redis lock (a safety net — the lock's own TTL
almost always already expired it), and pushes the Requester ("Still searching for a
Creator").

### Push broadcast on publish (PRD §8.1 "New Request Near You")

Wired into both publish paths — immediate auto-publish (`requestService.create`) and the
scheduled-publish lifecycle sweep. Uses
`creatorMatchingService.findEligibleCreatorsForRequest()` (ONLINE creators within the
request's radius) and `fcmService.sendToMultiple`. Best-effort — a notification failure
never blocks or fails request creation/publication.

## Creator Profile (`/creator`)

Creator-side availability/location, consumed by the Nearby Requests feed above. `User` gained
`availabilityStatus` (`ONLINE | OFFLINE | BUSY`, default `OFFLINE`) and `locationUpdatedAt`
this pass — only `ONLINE` creators are matched by `creatorMatchingService`'s reverse lookup
(`findEligibleCreatorsForRequest`, used by nothing yet — reserved for Phase 3's notification
broadcast).

### PATCH `/creator/location`

Auth: user. Body: `{latitude: number, longitude: number}`. Updates `User.latitude/longitude`
and stamps `locationUpdatedAt`. Returns the updated user (see `GET /auth/me` shape).

### PATCH `/creator/status`

Auth: user. Body: `{availabilityStatus: "ONLINE" | "OFFLINE" | "BUSY"}`. Returns the updated
user.

### GET `/creator/dashboard`

Auth: user. Returns:
```json
{
  "availabilityStatus": "ONLINE",
  "location": {"latitude": 0, "longitude": 0, "updatedAt": "..."},
  "nearbyRequestsCount": 3,
  "pendingRequests": [ /* up to 5 nearest PUBLISHED requests, same shape as GET /requests/nearby items */ ],
  "activeRequest": { /* standard request shape, or null */ },
  "acceptanceCountdownSeconds": 812,
  "acceptedRequests": [ /* up to 10 most-recent requests this Creator holds/held, newest first */ ]
}
```
`location` is `null` if the user has never set a location. `nearbyRequestsCount`/
`pendingRequests` use the default 500m radius. `activeRequest` is this Creator's current
non-terminal in-flight request (`CREATOR_ASSIGNED` or later — in practice almost always
observed as `TEMPORARY_CHAT` or later, since acceptance advances past `CREATOR_ASSIGNED`
immediately), or `null` if none. `acceptanceCountdownSeconds` is only non-null while
`activeRequest.status === "TEMPORARY_CHAT"` — seconds remaining until the acceptance timer
expires. Fulfilment history (completed count, earnings) is a later phase — not faked here.

## Temporary Chat (PRD §5.4)

Opens automatically the instant `POST /requests/:id/accept` succeeds (`status →
TEMPORARY_CHAT`); closes permanently once Recording starts (`POST /requests/:id/recording/start`
— see "Recording & Upload" below — `status !== 'TEMPORARY_CHAT'` → `409` on send). Also closes
if the acceptance-timer expiry reverts the request to `PUBLISHED` before recording starts.
Participants only (the request's `requesterId` or `creatorId`).

### GET `/requests/:id/chat`

Auth: user, must be a participant (`403` otherwise). Returns messages oldest-first:
```json
{"data": [{"id": "...", "requestId": "...", "senderId": "...", "body": "...", "createdAt": "..."}]}
```
Blocked messages are **not** included — they're logged for moderation but never delivered to
the other participant. Returns `[]` if chat has never opened for this request (no Creator
assigned yet).

### POST `/requests/:id/chat`

Auth: user, must be a participant. Body: `{body: string}` (1-1000 chars).
- `409` "Chat is not open for this request." if `status !== "TEMPORARY_CHAT"`.
- `422` with message `"Sharing contact details or external links is not allowed in chat."`
  (`details.blockReason` ∈ `PHONE_NUMBER | EMAIL | SOCIAL_HANDLE | UPI_VPA | URL`) if the body
  matches a blocked pattern (`src/utils/chatContentFilter.ts`) — phone numbers (+91-prefixed
  Indian mobiles), email addresses, WhatsApp/Telegram/Instagram mentions, UPI VPAs, URLs. The
  message is still persisted (`blocked: true`, `blockReason` set) for moderation audit even
  though it's rejected and never delivered. **The exact PRD §5.4.2 rejection string wasn't
  available in this environment — this is an interim, clearly-flagged placeholder pending
  client confirmation against the source PRD.**
- 3+ blocked attempts on the same request sets `Request.chatFlaggedForReview = true` (no
  Moderator queue exists yet to act on this — Phase 6 — but the flag is captured now so that
  phase has data to work with from day one).
- On success (`201`): returns the created message in the same shape as the list endpoint.

## Recording & Upload (PRD §5.6, §4.4, backend Phase 5)

Creator-only (the request's `creatorId`), gated on `Request.status`. Storage is **Cloudinary
only** for this milestone, behind `IVideoStorageProvider`
(`src/services/storage/IVideoStorageProvider.ts` — `CloudinaryVideoStorageProvider` is the only
implementation today; a future `S3VideoStorageProvider` needs no changes to
`recordingService`/`requestService`). Video metadata (GPS lat/lng, recorded-at timestamp,
duration) is client-reported at upload time, same trust model as the Creator's GPS coordinate
at Accept time (§5.5) — there is no independent server-side verification of device GPS/clock.

### POST `/requests/:id/recording/start`

Auth: user, must be the assigned Creator. Body: `{declaration: true}` (mandatory "I have the
legal right to record here" checkbox — `422` if missing/false).
- `409` if `status !== 'TEMPORARY_CHAT'`.
- On success: `status → RECORDING`, stamps `recordingStartedAt` and `creatorDeclarationAt`,
  closes chat (chat's own `409` gate keys off `status !== 'TEMPORARY_CHAT'`, already true).

### POST `/requests/:id/video/session`

Auth: user, must be the assigned Creator, `status` must be `RECORDING`. Creates a new
`RequestVideo` row (`status: PENDING`) — the client uploads the actual file against this
session's id next. `409` if an active (non-`CANCELLED`, non-`FAILED`) session already exists
for this request — cancel it first.

### GET `/requests/:id/video`

Auth: user, must be a participant (requester or creator). Returns the request's active/latest
`RequestVideo` (`null` if none yet):
```json
{
  "data": {
    "id": "...", "requestId": "...", "creatorId": "...",
    "status": "PENDING | UPLOADING | UPLOADED | FAILED | CANCELLED",
    "secureUrl": null, "thumbnailUrl": null,
    "durationSeconds": null, "width": null, "height": null,
    "fileSizeBytes": null, "mimeType": null,
    "gpsLatitude": null, "gpsLongitude": null, "recordedAt": null,
    "uploadAttempts": 0, "failureReason": null,
    "createdAt": "...", "updatedAt": "..."
  }
}
```

### GET `/requests/:id/video/history`

Auth: user, participant only (Requester or the assigned Creator). Every `RequestVideo` row for
this request, oldest-first — includes cancelled/failed/rejected attempts, not just the currently
active one (backend Phase 7 "preserve previous recordings" / full audit trail across a re-shoot
cycle). Same per-row Requester asset-visibility gate as `GET /requests/:id/video` — an unapproved
historical attempt's `secureUrl`/`thumbnailUrl` stay `null` for the Requester.

### POST `/requests/:id/video/:videoId/complete`

Auth: user, must be the assigned Creator and own the video session. `multipart/form-data`:
`video` (file field, max 300MB, mime ∈ `video/mp4|video/quicktime|video/webm|video/x-matroska`
— rejected `422` otherwise by `middlewares/upload.ts#videoUpload`), plus text fields
`gpsLatitude`, `gpsLongitude`, `recordedAt` (ISO datetime), `durationSeconds`.
- `409` if `status !== 'RECORDING'`, if the video is already `UPLOADED`/`CANCELLED`, or if
  `uploadAttempts >= 3` (see Retry below).
- `422` `"Stream too short."` if `durationSeconds < request.durationMinutes*60 - 2`.
- `422` `"Recording is too long for the selected duration."` if
  `durationSeconds > request.durationMinutes*60 + 30` (this milestone's own quality
  validation — the PRD only specifies the minimum-duration rejection).
- On a Cloudinary failure: `502`, `RequestVideo.status → FAILED`, `uploadAttempts` incremented.
  After the 3rd failed attempt: `502` `"Upload failed after the maximum number of attempts.
  This request has been flagged for review."` and no further retries are accepted.
- On success (`200`): uploads to Cloudinary (`folder: locator/request-videos/:requestId`),
  requests an eager `400x400` JPEG thumbnail transformation at upload time (`eager_async:
  false` — the thumbnail URL is ready in the same response, no polling needed), stores
  `secureUrl`/`thumbnailUrl`/`durationSeconds`/`width`/`height`/`fileSizeBytes`/`mimeType` from
  Cloudinary's response, `RequestVideo.status → UPLOADED`, and chains the request through
  `RECORDING → UPLOAD → MODERATOR_REVIEW` in the same call (mirrors how `accept()` chains
  `CREATOR_ASSIGNED → TEMPORARY_CHAT`). Returns `{request: {...}, video: {...}}`. The
  Moderator queue itself (Phase 6) doesn't exist yet — the request correctly lands in
  `MODERATOR_REVIEW` and waits there.

### POST `/requests/:id/video/:videoId/retry`

Auth: user, must be the assigned Creator. `409` if the video isn't `FAILED`, or if
`uploadAttempts >= 3` (flagged for review, no further retries). On success: resets
`status → PENDING` so the client can call `complete` again against the same session.

### POST `/requests/:id/video/:videoId/cancel`

Auth: user, must be the assigned Creator. `409` if the video is already `UPLOADED` (delete it
instead — see below). On success: `status → CANCELLED`; the client may then create a new
upload session.

### DELETE `/requests/:id/video/:videoId`

Auth: user, must be the assigned Creator. Withdraws an uploaded draft **before** a Moderator
acts on it. `409` if the video isn't `UPLOADED`, or if the request has already moved past
`UPLOAD`/`MODERATOR_REVIEW` (e.g. a Moderator decision was already recorded — Phase 6). On
success: deletes the file from Cloudinary, `RequestVideo.status → CANCELLED`, reverts
`Request.status → RECORDING` (clears `uploadedAt`) so the Creator can record and upload again.

## Requester Review & Re-shoot (PRD §5.10, §4.6, backend Phase 7)

Auth: user, must be the request's Requester (`403` for the Creator or anyone else). Every
endpoint below `409`s unless `Request.status === 'REQUESTER_REVIEW'` — this both gates the
"Creator/Moderator cannot review" and "Requester can review only once per cycle" rules from a
single check in `requesterReviewService`'s `loadReviewableRequest`, without a separate DB flag.
The Requester views the video itself via the existing `GET /requests/:id/video` (Phase 5/6) —
its asset-visibility gate already only unlocks once `moderationStatus === 'APPROVED'`, which is
also the only way a request reaches `REQUESTER_REVIEW` in the first place.

### POST `/requests/:id/accept-video`

Body: `{remarks?: string}` (≤500 chars). On success, chains through all three of this
milestone's remaining transitions in one call (backend Phase 8): `Request.status:
REQUESTER_REVIEW → ACCEPTED → PAYMENT_RELEASED → COMPLETED`. `requesterDecisionAt`/
`requesterReviewRemarks` stamped; escrow is released to the Creator's wallet (minus platform
commission) as part of the same call — see "Escrow & Payment Release" below. Notifies the
Creator twice: "Video Accepted ✓" then "Payment Released".

### POST `/requests/:id/request-reshoot`

Body: `{reason: string (5-300 chars, required), remarks?: string (≤500 chars)}`. `409` if the
one free re-shoot (`Request.reshootUsed`) has already been used for this request — enforced
server-side, not just a UI affordance. On success: chains `REQUESTER_REVIEW →
RESHOOT_REQUESTED → RECORDING` in one call (mirrors how `POST /requests/:id/accept` chains
`CREATOR_ASSIGNED → TEMPORARY_CHAT`), sets `reshootUsed = true`, increments `reshootCount`,
stamps `reshootReason`/`requesterDecisionAt`/`requesterReviewRemarks`, clears
`recordingStartedAt`/`uploadedAt` so the next recording cycle starts clean, notifies the Creator
("Re-shoot Requested: <reason>"). The previously approved `RequestVideo` row is **kept, not
cancelled or deleted** (preserves moderation history and the prior recording for audit/dispute
purposes) — `recordingService.createUploadSession`'s guard was extended (additive) so an
already-`APPROVED` existing video no longer blocks a fresh session once the request is back in
`RECORDING`; only a still-uploading or still-pending-moderation video blocks a new session. The
Creator does not need to call `POST /requests/:id/recording/start` again — the request is
already `RECORDING` — they call `POST /requests/:id/video/session` directly to start the new
upload cycle. After a re-shoot, only Accept/Reject are available on the next `REQUESTER_REVIEW`
— `reshootUsed` blocks a second `request-reshoot` call.

### POST `/requests/:id/reject`

Body: `{reason: string (5-300 chars, required), remarks?: string (≤500 chars)}`. On success:
`Request.status: REQUESTER_REVIEW → REJECTED` (terminal), stamps
`requesterRejectionReason`/`requesterDecisionAt`/`requesterReviewRemarks`, notifies the Creator
with the reason. Escrow is refunded back to the Requester's wallet as part of the same call
(backend Phase 8) — see "Escrow & Payment Release" below. **This milestone's explicit scope
still excludes Disputes** — unlike the longer-term plan in `docs/MASTER_EXECUTION_PLAN.md` Phase
7 (which routes a reject into a `Dispute` row for arbitration), this pass stops at the existing
terminal `REJECTED` state with a plain full refund; no `Dispute` row is created. Revisit this
endpoint when Disputes (Phase 11) is in scope.

## Escrow & Payment Release (PRD §7.1, §7.2, §5.2, §5.14.5, backend Phase 8)

One `RequestEscrow` row per `Request`, created the moment the request itself is created —
`POST /requests` now debits the Requester's wallet for the full `rewardAmount` up front
(`402` if the balance is insufficient) and reserves escrow in the same call, extending Phase 2's
previously-deferred "escrow reservation on creation" gap. Commission is **Admin-configurable**
(`[REVIEW]`, default `15%` — see "Commission Settings" below, backend Phase 11; superseded the
originally-hardcoded constant), snapshotted onto the escrow row at reservation time
(`commissionRate`) so a later change to the platform-wide rate never retroactively changes an
already-reserved escrow's split.
`Transaction` rows created by escrow reserve/release/refund carry `requestId`, so a user's wallet
history is traceable back to the originating request.

**Fields** (`RequestEscrow`): `amountLocked`, `commissionRate`, `commissionAmount`,
`creatorEarnings` (`amountLocked - commissionAmount`), `refundAmount` (set only on refund),
`state` (`RESERVED`\|`RELEASED`\|`REFUNDED`\|`FROZEN`\|`SPLIT` — `FROZEN`/`SPLIT` are declared
per the target spec's dispute-resolution states but no code path produces them this milestone,
since the Dispute Center, Phase 11, doesn't exist yet), `reservedAt`/`releasedAt`/`refundedAt`/
`settledAt`.

**Business flow:**
- Request created → escrow `RESERVED`, Requester's wallet debited.
- Requester accepts video (`POST /requests/:id/accept-video`) → escrow `RELEASED`, Creator's
  wallet credited with `creatorEarnings`, `Request.status → PAYMENT_RELEASED → COMPLETED`.
- Requester rejects (`POST /requests/:id/reject`), cancels pre-acceptance
  (`POST /requests/:id/cancel`), or the request auto-expires (24h, no Creator ever assigned) →
  escrow `REFUNDED`, Requester's wallet credited back with `amountLocked`.
- A re-shoot (`POST /requests/:id/request-reshoot`) does not touch escrow — the same reservation
  carries through to whichever review cycle eventually accepts or rejects the video.

### GET `/requests/:id/escrow`

Auth: user, must be the request's Requester or its assigned Creator (`403` otherwise). Returns
the full `RequestEscrow` row for that request (`404` if none exists — e.g. checked before
`POST /requests` completes reservation, which shouldn't be observable in practice since
reservation happens in the same call as request creation).

### Admin (PRD §5.14.5 Refund Management / Finance Management)

Auth: Admin (`authenticateAdmin`) for every endpoint below — same "Moderator is a capability of
the Admin JWT namespace, not a separate principal" precedent as Moderation/Payouts.

- `GET /admin/escrow` — paginated list, filters `state`/`requestId`, includes a summary of the
  linked `Request` (`id`, `description`, `status`, `requesterId`, `creatorId`).
- `GET /admin/escrow/summary` — financial audit totals: `totalLocked` (sum of still-`RESERVED`
  `amountLocked`), `totalCommissionEarned`/`totalPaidToCreators` (sums of `RELEASED` escrow's
  `commissionAmount`/`creatorEarnings`), `totalRefunded` (sum of `REFUNDED` escrow's
  `refundAmount`). Registered before `/admin/escrow/:id` to avoid being captured as an `:id`.
- `GET /admin/escrow/:id` — detail for one request's escrow (`:id` is the `requestId`, not the
  escrow row's own `id`, matching how every other admin sub-module in this API keys off the
  domain entity's id).
- `POST /admin/escrow/:id/release` — **manual override**: releases a still-`RESERVED` escrow to
  the Creator regardless of the `Request`'s current status (the same underlying function the
  automatic accept-video flow calls — it only gates on the escrow's own state). Body:
  `{reason: string (5-300 chars, required)}`. Audit-logged (`ESCROW_RELEASED_MANUAL`).
- `POST /admin/escrow/:id/refund` — **manual override**: refunds a still-`RESERVED` escrow to
  the Requester regardless of the `Request`'s current status. Body: `{reason: string (5-300
  chars, required)}`. Audit-logged (`ESCROW_REFUNDED_MANUAL`).

**Not built this milestone** (explicitly out of scope, see stop condition): Auto-Payout Toggle,
RazorpayX automated disbursement (Creator payouts still land as a regular wallet-balance credit,
withdrawable via the existing `PayoutRequest` admin-approval flow), partial-split refunds tied to
Dispute Center resolutions (`SPLIT` escrow state is declared but unused).

## Moderation (Admin sub-module, PRD §5.9, §4.5, §5.14.7, backend Phase 6)

Auth: Admin (`authenticateAdmin`) for every endpoint below. Moderator is a capability of the
existing Admin JWT namespace, not a separate principal (docs/CLAUDE.md §1/§7) — every Admin
account can moderate; Creator/Requester (the `authenticate`/User namespace) cannot reach any
`/admin/*` route at all. Only videos whose upload lifecycle (`RequestVideo.status`) reached
`UPLOADED` are ever moderatable — `moderationStatus` (`PENDING`/`APPROVED`/`REJECTED`) is a
separate field on the same row, not a replacement for the upload-lifecycle status.

### GET `/admin/moderation/videos`

Live queue. Query: `status` (`PENDING`|`APPROVED`|`REJECTED`, default `PENDING`), `requestId?`,
`creatorId?`, `search?` (matches request description or creator name/email/username),
`page`/`limit`. FIFO ordering (oldest-first) so the queue drains in submission order. Each item
includes the video, a Creator summary, and a Request summary (description/category/duration/
reward/status/requesterId/location).

### GET `/admin/moderation/videos/history`

Same shape, `status` optional (defaults to both `APPROVED` and `REJECTED`), plus
`moderatedByAdminId?` (Moderator history — who decided what) and `dateFrom?`/`dateTo?` (filters
on `moderatedAt`).

### GET `/admin/moderation/stats`

`{pendingQueueDepth, approvedToday, rejectedToday, approvedTotal, rejectedTotal}` — "today" is
midnight-to-now in server local time.

### GET `/admin/moderation/videos/:videoId`

Full video-review detail: the video (with asset URLs), the full `Request`, and:
- `gpsCheck`: `requestLocation` (lat/lng/radius) vs `recordingLocation` (the Creator's
  upload-time GPS), `distanceMeters`, `withinRadius`.
- `timestampCheck`: `recordedAt` vs `requestAcceptedAt`/`requestExpiresAt`.

No dedicated chat-log viewer or Escalate-to-Dispute action this pass — both are explicitly out
of this milestone's scope (Disputes is a later phase); the data model doesn't block adding them
later (nothing is hard-deleted).

### PATCH `/admin/moderation/videos/:videoId/approve`

Body: `{remarks?: string}` (≤500 chars). `409` if the video isn't `UPLOADED`, already moderated,
or the request isn't currently `MODERATOR_REVIEW`. On success: `moderationStatus → APPROVED`,
`Request.status: MODERATOR_REVIEW → REQUESTER_REVIEW`, writes an `AdminAuditLog` row
(`VIDEO_APPROVED`), notifies both the Requester ("Video Ready for Review") and the Creator
("Video Approved ✓").

### PATCH `/admin/moderation/videos/:videoId/reject`

Body: `{reason: 'CONTENT_VIOLATION'|'PROHIBITED_LOCATION'|'GPS_MISMATCH'|'DURATION_MISMATCH'|'FAKE_RECORDING'|'OTHER', remarks?: string}`
— `reason` is mandatory (PRD §7.3's rejection-reason table). On success: `moderationStatus →
REJECTED`, **`Request.status: MODERATOR_REVIEW → RECORDING`** (per this milestone's explicit
scope: rejection sends the Creator back to re-record, not to the terminal `REJECTED` state —
that state remains reserved for the Requester-side reject in Phase 7's Dispute flow), clears
`uploadedAt`, stamps a human-readable `moderatorRejectionReason` on the `Request` (`"<reason
label>: <remarks>"` or just the label), writes an `AdminAuditLog` row (`VIDEO_REJECTED`),
notifies the Creator with the reason. The Creator can immediately call
`POST /requests/:id/video/session` again (backend Phase 5's `recordingService` was extended to
allow a fresh session once the latest video's `moderationStatus` is `REJECTED`, in addition to
the pre-existing `FAILED` case) — no new `recording/start` call is needed since the request is
already `RECORDING`.

### POST `/admin/moderation/videos/bulk-approve` / `/bulk-reject`

Body: `{videoIds: string[]}` (bulk-approve, ≤50) or `{videoIds: string[], reason, remarks?}`
(bulk-reject). Best-effort per item (`Promise.allSettled`) — one item's failure (e.g. already
moderated) never blocks the rest. Returns `[{videoId, success, error?}]`.

### Requester video visibility gate (backend Phase 6 addition to Phase 5's `GET /requests/:id/video`)

The Requester cannot see the video asset (`secureUrl`/`thumbnailUrl` come back `null`) until
`moderationStatus === 'APPROVED'` — the rest of the payload (duration, GPS, moderation status/
reason/remarks) is still visible so the mobile "pending moderation" / "rejected, reason: …"
states have something to render. The Creator always sees their own upload's asset URLs
regardless of moderation state.

## Ratings, Reviews & Reporting (PRD §5.12, §4.6, backend Phase 9)

Mutual Ratings (`Rating`) and the Report/Abuse workflow (`Report`) — both net-new this phase.
No `UserRating`/aggregate table exists; a user's overall average/count is computed on demand via
`ratingRepository.aggregateForUser` (`ratingService.getSummaryForUser`) rather than denormalized,
so there's exactly one source of truth. This same summary (`{averageRating, ratingCount}`) is now
attached to `GET /auth/me`, `GET /creator/dashboard` (`myRating`), and `GET /requests/:id` /
`GET /requests/:id/details` (`requesterRating`/`creatorRating`) — "show average rating everywhere"
per this milestone's explicit mobile ask.

### POST `/requests/:id/rate`

Auth: user, must be the Requester or assigned Creator of the request (`403` otherwise). Only
reachable once `Request.status === 'COMPLETED'` (`409` otherwise). Direction
(`REQUESTER_RATES_CREATOR`/`CREATOR_RATES_REQUESTER`) is derived server-side from which side the
caller is on — never accepted from the client. Exactly one rating per participant per request
(`409` on a second call — enforced by both a `@@unique([requestId, raterId])` DB constraint and a
service-level check for a clean error message). **No edit/delete path exists anywhere in this
module** — "no editing after submission" is enforced by omission. Body: `{stars: 1-5, comment?:
string (≤500 chars)}`. Notifies the ratee via FCM.

### GET `/requests/:id/rating`

Auth: user, participant only (`403` otherwise). Returns both `Rating` rows for the request
(oldest-first), whichever have been submitted so far — lets each side see "did I already rate"
and "what did I receive."

## Report/Abuse Workflow (PRD §5.12, backend Phase 9)

### POST `/reports`

Auth: user. Body: `{reportedUserId, requestId, category: PRIVACY_ISSUE|WRONG_LOCATION|ABUSE|
FAKE_RECORDING|COPYRIGHT|OTHER, description: string (10-1000 chars), evidence?: string[] (≤10)}`.
`reporterId`/`reportedUserId` must be the two opposite participants of `requestId` (`403`
otherwise — "Requester can report Creator" / "Creator can report Requester," PRD's exact rule, not
open to reporting arbitrary users). Duplicate prevention: `@@unique([reporterId, reportedUserId,
requestId])` (`409` on a repeat report for the same request). No status restriction on the
underlying request — a report can be filed any time after a Creator is assigned, not just once
`COMPLETED`.

**Suspend-recommendation hook**: after each report is created, `reportService` counts
`PENDING`/`RESOLVED` reports against the reported user in the trailing 30 days; at 3+, the
existing `User.isSuspicious` flag is set (reused as-is — the same flag `adminService.
toggleSuspicious`/the Admin user-list filter already surface) so the user shows up for Admin
review. This runs inline at report-creation time — "without manual polling," per this phase's
exit criteria — not a scheduled job. It is a **recommendation**, not an automatic suspension:
`isSuspicious` doesn't itself block anything beyond what it already did pre-existing this phase;
an Admin still acts on it via the existing user-management endpoints.

### Admin Report Queue (PRD §5.14, backend Phase 9)

Auth: Admin (`authenticateAdmin`) for every endpoint below.

- `GET /admin/reports` — paginated queue, filters `status`/`category`/`reportedUserId`/
  `reporterId`, includes reporter/reportedUser/request summaries.
- `GET /admin/reports/stats` — counts by status (`pending`/`resolved`/`dismissed`/`total`).
  Registered before `/admin/reports/:id` to avoid being captured as an `:id`.
- `GET /admin/reports/:id` — full detail (reporter, reportedUser, request, evidence, resolution),
  plus `suspendRecommended`/`recentReportCount` (the same 30-day/3-report check the creation hook
  runs, surfaced here for the Admin's context — not a stored field, computed on read).
- `PATCH /admin/reports/:id/resolve` — `status: PENDING → RESOLVED` (`409` if already
  resolved/dismissed). Body: `{notes?: string (≤500 chars)}`. Audit-logged (`REPORT_RESOLVED`).
- `PATCH /admin/reports/:id/dismiss` — `status: PENDING → DISMISSED` (`409` if already
  resolved/dismissed). Body: `{notes?: string (≤500 chars)}`. Audit-logged (`REPORT_DISMISSED`).

## Trust Profile (PRD §5.8, backend Phase 10)

**Status: built (2026-07-03), expanded beyond MASTER_EXECUTION_PLAN.md Phase 10's original text
by explicit milestone instruction** — the original plan scoped this phase to Requester-only
attributes with no composite score ("display the underlying attributes individually rather than
inventing a composite score"). This pass's instructions explicitly asked for a numeric composite
Trust Score, both Requester **and** Creator profiles, Verification Status, Profile Completion,
Response/Acceptance Rate, and 5 named badges — confirmed with the user before building (the PRD
itself still defers the *exact* algorithm; every weight/threshold below is a documented interim
default, not a PRD-given number — see `src/validations/trustProfileValidation.ts`).

Read-only everywhere — there is no update/delete path for any Trust Profile field. Every number
is **computed on demand** from `Request`/`Rating`/`Report`/`User` rows other modules already own
(`src/services/trustScoreService.ts`) — no denormalized/cached field, so "automatically updated
whenever a request completes / rating is submitted / report is resolved / cancellation happens /
re-shoot happens / wallet settles / moderation happens" is satisfied by construction, not by
event hooks. The one piece of new state is two additive `Request` columns
(`lastAssignedCreatorId`, `creatorTimedOut`) that let a Creator's fulfilment history survive the
existing acceptance-timer sweep nulling `creatorId` — see the schema comment on those fields.

- `GET /trust-profile/me?role=requester|creator` (auth: User) — own profile, either role
  perspective (the same account can be both, per PRD §3.1).
- `GET /trust-profile/:userId?role=requester|creator` (auth: User) — any authenticated user may
  view another user's trust profile; not participant-gated (a Creator needs to see a Requester's
  trust profile before ever accepting their request, same as Creator Discovery itself).

Response shape: `trustScore` (0-100 composite), `verificationStatus`
(`VERIFIED`/`UNVERIFIED`), `suspiciousFlag`, `averageRating`/`ratingCount` (reused as-is from
`ratingService`, not recomputed), `completedRequests` (any terminal outcome),
`successfulRequests` (`COMPLETED` specifically), `cancellationRate`, `reshootRate`,
`acceptanceRate`, `responseRate` (chat-responsiveness proxy), `reportsReceived`/`reportsResolved`
(reused as-is from `Report`), `profileCompletion` (% of profileImage/bio/city/location filled),
`memberSince`/`accountAgeDays`, and `badges` (`verified`/`topCreator`/`trustedRequester`/
`lowCancellation`/`fastResponse`).

Merged into existing responses (reuse, not a new fetch per screen):
- `GET /auth/me` — `requesterTrustProfile`/`creatorTrustProfile` (own, both roles).
- `GET /creator/dashboard` — `myTrustProfile` (creator role).
- `GET /requests/:id`, `GET /requests/:id/details` — `requesterTrustProfile`/`creatorTrustProfile`
  (mirrors how `ratingService.attachRatingSummaries` already works).
- `GET /requests/nearby`, `GET /requests/available` — each item gets `requesterTrustProfile`
  (Creator Discovery; there's no Creator side yet on these `PUBLISHED`-only lists).

### Admin Trust Profile sub-module

Auth: Admin (`authenticateAdmin`) for every endpoint below.

- `GET /admin/trust-profiles` — paginated at the `User` level (filters `isSuspicious`/
  `isVerified`/`isActive`/`search`), each item enriched with both `requesterProfile`/
  `creatorProfile`.
- `GET /admin/trust-profiles/stats` — `totalUsers`/`suspiciousUsers`/`verifiedUsers`. Registered
  before `/admin/trust-profiles/:userId` to avoid being captured as an `:id`.
- `GET /admin/trust-profiles/:userId` — both role profiles + review-note history.
- `PATCH /admin/trust-profiles/:userId/verify` / `.../unverify` — toggles the Verified Badge
  (`User.isVerified`, new field — no automated KYC exists, this is a manual Admin call), audit-
  logged (`USER_VERIFIED`/`USER_UNVERIFIED`).
- `GET /admin/trust-profiles/:userId/notes`, `POST .../notes` — manual review notes. Reuses the
  existing immutable `AdminAuditLog` (action `TRUST_REVIEW_NOTE_ADDED`, `metadata: {note}`)
  rather than a new table, per the "reuse existing" instruction.
- Suspicious users are surfaced via the existing `isSuspicious` filter above — no second
  suspension mechanism was added.

## Dispute Center (PRD §5.14.2, §5.14.3, §5.14.6, §5.14.8, §5.14.10, §4.9, backend Phase 11)

**Status: built (2026-07-03).** `Dispute`/`DisputeMessage`/`DisputeEvidence` Prisma models +
`DisputeReason`/`DisputeStatus`/`DisputeResolution`/`DisputeParticipantType` enums,
`src/services/disputeService.ts`. One `Dispute` per `Request` (`@@unique` on `requestId`) — a
resolved/closed case is reopened in place rather than creating a second row, so the full
message/evidence/resolution history stays on one case.

A dispute may only be raised by a participant (Requester or the assigned Creator) of the request,
and only while the request is `REQUESTER_REVIEW`, `ACCEPTED`, `PAYMENT_RELEASED`, `COMPLETED`, or
`REJECTED` (`requestStateMachine`'s `DISPUTED` edges were extended to cover all five — previously
only `REJECTED → DISPUTED` existed). Creating a dispute automatically: freezes escrow (if still
`RESERVED`), transitions the request to `DISPUTED` (terminal), writes an in-app notification to
the other participant and all Admins, and snapshots the escrow's current money state onto the
`Dispute` row (`amountLocked`, `commissionRate`, `escrowStateAtCreation`,
`alreadyReleasedToCreator`, `alreadyRefundedToRequester`) — this snapshot is what makes resolution
correct regardless of whether the dispute was raised before any money moved (`REQUESTER_REVIEW`,
escrow `RESERVED`→`FROZEN`) or after (`COMPLETED`, escrow already `RELEASED`; `REJECTED`, escrow
already `REFUNDED`): resolution always computes a **delta** against the snapshot rather than
assuming a starting state, so it can reverse an already-settled outcome as easily as release a
still-frozen one.

- `POST /disputes` (auth: User) — body `{requestId, reason, description}`.
  `reason` ∈ `VIDEO_QUALITY_ISSUE|LOCATION_MISMATCH|LATE_DELIVERY|PAYMENT_ISSUE|
  INAPPROPRIATE_CONTENT|NO_SHOW|OTHER`. `403` if not a participant, `409` if the request's status
  isn't one of the five allowed, `409` if a dispute already exists for this request.
- `GET /disputes/mine` (auth: User) — paginated, filterable by `status`; disputes where the caller
  is a participant of the underlying request (either side).
- `GET /disputes/:id` (auth: User, participant-only, `403` otherwise) — full case detail:
  messages/evidence/resolution/escrow-snapshot fields. Admin-only internal notes/messages
  (`isInternalNote`) are filtered out of this response.
- `POST /disputes/:id/messages` — body `{body}`. Case communication, notifies the other party.
- `POST /disputes/:id/evidence` — multipart `file` (image or PDF, ≤10MB) + optional `caption`.
  Cloudinary-backed (`disputeService`'s inline `uploadToCloudinary`, mirrors `profileService`'s
  pattern — not the video-specific `IVideoStorageProvider`, since evidence isn't a
  swappable-storage-provider concern this milestone).

### Admin Dispute Center sub-module

Auth: Admin (`authenticateAdmin`) for every endpoint below — Moderator is a capability of the
same Admin JWT namespace, not a separate principal (docs/CLAUDE.md §1/§7), same as every other
Admin sub-module in this codebase.

- `GET /admin/disputes` — Dispute Queue. Filters: `status`, `reason`, `caseOwnerAdminId`,
  `raisedById`, `requestId`, `search` (description contains, case-insensitive), `page`/`limit`.
- `GET /admin/disputes/stats` — Dispute Dashboard counts by status.
- `GET /admin/disputes/:id` — Case Detail (full detail + Admin-only internal notes/messages +
  the live `RequestEscrow` row for Escrow Status).
- `GET /admin/disputes/:id/audit-log` — Timeline / Resolution history. Every assign/resolve/
  close/reopen/note action against this dispute, oldest last — reuses the existing immutable
  `AdminAuditLog` (`targetEntityType: 'Dispute'`), not a second audit mechanism.
- `POST /admin/disputes/:id/assign` — body `{adminId?}` (defaults to the caller). Case owner
  assignment; advances `OPEN → UNDER_REVIEW` the first time a case is claimed.
- `POST /admin/disputes/:id/messages` — body `{body, isInternalNote?}`. Admin case communication;
  `isInternalNote: true` keeps it out of the participant-facing `GET /disputes/:id` response.
- `POST /admin/disputes/:id/evidence` — same multipart shape as the participant endpoint (e.g.
  moderation screenshots attached to the case).
- `GET /admin/disputes/:id/notes`, `POST .../notes` — manual review notes. Reuses `AdminAuditLog`
  (action `DISPUTE_NOTE_ADDED`), mirroring the Trust Profile sub-module's identical pattern
  (`adminListNotes`/`adminAddNote`) rather than inventing a second notes table.
- `PATCH /admin/disputes/:id/resolve` — body `{resolution, splitPercentage?, notes?}`.
  `resolution` ∈ `REQUESTER_FAVOUR|CREATOR_FAVOUR|PARTIAL` (`splitPercentage`, 1-99, required only
  for `PARTIAL` — the Requester's share of `amountLocked`; the remainder goes to the Creator, net
  of the platform commission rate snapshotted at dispute-creation time). Computes the target
  Requester/Creator amounts, diffs them against the dispute's `alreadyRefundedToRequester`/
  `alreadyReleasedToCreator` snapshot, and moves only the resulting delta via
  `transactionRepository.runTransaction` (same atomic ledger pattern as `escrowService`) — this is
  how an already-`COMPLETED`/paid-out or already-`REJECTED`/refunded request can still be
  reversed by a later dispute resolution. Sets the `RequestEscrow`'s state to `REFUNDED`/
  `RELEASED`/`SPLIT` accordingly. `409` if the dispute is already `RESOLVED`/`CLOSED`.
- `PATCH /admin/disputes/:id/close` — body `{notes?}`. Archives the case; no further fund
  movement (that already happened via `resolve`). `409` if already `CLOSED`.
- `PATCH /admin/disputes/:id/reopen` — body `{reason}`. Only from `RESOLVED`/`CLOSED`. **Interim
  decision** (the PRD doesn't explicitly rule on reopening) — flagged per docs/CLAUDE.md §8 rule
  11's "don't silently invent" convention, not a silent addition. Does not itself move money — a
  reopened case must go through `resolve` again for any further payout, so there's no
  double-payout risk from reopening alone.

**Exit criteria met**: every admin dispute-mutating action (assign, message, note, resolve, close,
reopen) writes an `AdminAuditLog` row; resolutions correctly move escrow per the chosen resolution
type including partial splits, verified live for all three resolution types plus the
already-settled reversal case (see this session's completion report for exact wallet-balance
deltas). **Not built this pass, explicitly out of scope per the milestone's stop condition**:
Notification Expansion (only the four dispute-specific triggers above were wired — the full §8.1
trigger matrix is Phase 12), Compliance, and Production Hardening.

## Admin Dashboard (PRD §5.14.1-§5.14.3, backend Phase 11)

### GET `/admin/dashboard`

Auth: Admin. KPI tiles — extended this phase beyond the pre-PRD generic user/revenue counts with
the PRD's own named tiles, sourced from the same services/repositories their own dedicated
screens use (no second parallel query path): `totalUsers`, `activeUsers`, `suspiciousUsers`,
`blockedUsers`, `totalTransactions`, `totalRevenue`, `pendingPayouts`, `pendingPayoutAmount`,
`totalRequestsToday`, `activeRequests`, `moderationQueueDepth`, `pendingDisputes`,
`onlineCreators`.

### GET `/admin/dashboard/live-monitoring`

Auth: Admin. Real-time snapshot of every in-flight Request (PRD §5.14.2): `totalActiveRequests`,
`requestsByStatus` (array of `{status, count}` across every non-terminal PRD §5.13 state, in
lifecycle order, always present even at 0), `onlineCreators`, `moderationQueueDepth`,
`openDisputes`, `underReviewDisputes`, `flaggedChats` (requests with `chatFlaggedForReview`),
`generatedAt`.

### GET `/admin/dashboard/active-requests`

Auth: Admin. Paginated list of every currently in-flight Request (PRD §5.14.3). Query:
`status?` (any non-terminal PRD §5.13 status; omit for all non-terminal requests),
`page`/`limit`. Each item is the standard `presentRequest` shape (same field names as every
other Request payload in this codebase) plus `requester`/`creator` (`{id, name, username}`).

## Commission Settings (PRD §5.2, §7.1, §5.14.8, backend Phase 11)

Platform commission is no longer a hardcoded constant — it's the `COMMISSION_RATE_PERCENT` key
on the existing `ComplianceConfig` table (see "Compliance, Consent, Privacy & Data Retention"
below), reusing that module's Admin-editable, self-seeding, audit-logged infrastructure rather
than a second parallel settings mechanism. Read via `GET /admin/compliance/config`, updated via
`PATCH /admin/compliance/config/COMMISSION_RATE_PERCENT` (`{value: "15"}`) — validated
server-side as a number between 0 and 100. `escrowService.reserve` reads this value at
reservation time and snapshots it onto the `RequestEscrow` row, so a later Admin change never
retroactively alters an already-reserved escrow's split. Default: `15` (`[REVIEW]` — the PRD's
only given number, still pending client confirmation).

## Audit Logs (PRD §5.14.7)

### GET `/admin/audit-logs`

Auth: Admin. Query: `actorId?`, `targetEntityType?`, `targetEntityId?`, `page`/`limit`.
Immutable, insert-only (`AdminAuditLog`). **Backfilled 2026-07-04 (backend Phase 11)**: user
block/suspicious toggles (`USER_BLOCKED`/`USER_UNBLOCKED`/`USER_FLAGGED_SUSPICIOUS`/
`USER_UNFLAGGED_SUSPICIOUS`) and payout approve/reject (`PAYOUT_APPROVED`/`PAYOUT_REJECTED`,
with `{amount, adminNote}` metadata) are now logged alongside the Moderation/Escrow/Dispute/
Compliance actions already wired in earlier phases. This is a **prospective** backfill, not a
retroactive one — there is no way to manufacture audit rows for toggles/payouts actioned before
this phase, since `AdminAuditLog` didn't exist yet at the time.

## Notifications (PRD §8.1, §8.2, backend Phase 12)

Full notification matrix — every trigger routes through `src/services/notificationService.ts`
(the single centralized entry point; no service calls `fcmService` directly anymore except
`notificationService` itself). Every push payload and in-app `Notification.data` JSON blob
carries a canonical `type` (see `src/services/notificationTypes.ts`'s `NotificationType` const)
and, for user-facing types, a `screen` key mobile's `notificationRouter.ts` uses to deep-link the
notification tap to the correct screen (`RequestDetail`/`CreatorRequestDetail`/`Chat`/
`VideoReview`/`DisputeDetail`/`TrustProfile`/`Wallet`/`Notifications`).

### GET `/notifications`

Auth: User. Query: `page` (default 1), `limit` fixed at 20. Returns `{items, page, hasMore}` —
unchanged from before Phase 12.

### GET `/notifications/unread-count` (new, Phase 12)

Auth: User. Returns `{unreadCount}` — backs the mobile tab-bar badge (`GlassTabBar`).

### PATCH `/notifications/:id/read`, `PATCH /notifications/read-all`

Unchanged from before Phase 12.

### GET `/notifications/preferences` (new, Phase 12)

Auth: User. Returns `{notifyRequestActivity, notifyPaymentWallet, notifyPlatformAlerts}` — the
PRD §8.2 3-category toggle state, stored as flat booleans on `User` (default `true`).

### PATCH `/notifications/preferences` (new, Phase 12)

Auth: User. Body: any subset of the three booleans above. **Safety-critical notification types
(`ACCOUNT_SUSPENDED`, `PAYOUT_REJECTED`) always send regardless of these flags** — enforced
server-side in `notificationService.notifyUser` (`SAFETY_CRITICAL_TYPES`), not just hidden
client-side, per PRD §8.2's explicit requirement.

### The full type matrix

Every type below is defined once in `NotificationType` and mapped to one of the 3 preference
categories in `NOTIFICATION_TYPE_CATEGORY` (both in `notificationTypes.ts`). Admin-alert types
(`SUSPICIOUS_USER`/`HIGH_PRIORITY_REPORT`/`HIGH_VALUE_ESCROW`/`LARGE_REFUND`) go to Admins via
`notificationService.notifyAdmins` (push-only, no `Notification` row, never preference-gated —
Admins aren't `User` rows).

| Category | Types | Trigger site |
|---|---|---|
| Authentication | `WELCOME`, `SIGNUP_SUCCESSFUL`, `PASSWORD_RESET_CONFIRMATION` | `authService.verifyRegistrationOtp`/`resetPassword` (also sends a welcome/confirmation email via `mailService`) |
| Requests | `REQUEST_CREATED`, `REQUEST_SCHEDULED`, `REQUEST_PUBLISHED`, `NEARBY_CREATOR_FOUND`, `CREATOR_ACCEPTED`, `CREATOR_TIMED_OUT`, `REQUEST_CANCELLED`, `REQUEST_EXPIRED` | `requestService.create`/`accept`/`cancel`, `requestLifecycleJob.expireDueRequests`, `acceptanceTimerJob` |
| Temporary Chat | `CHAT_OPENED`, `NEW_MESSAGE`, `CHAT_CLOSED` | `requestService.accept` (opens), `chatService.send` (message), `recordingService.startRecording` (closes) |
| Recording | `RECORDING_STARTED`, `RECORDING_REMINDER`, `UPLOAD_STARTED`, `UPLOAD_SUCCESSFUL`, `UPLOAD_FAILED` | `recordingService.startRecording`/`completeUpload`, `notificationReminderJob.remindStalledRecordings` |
| Moderation | `VIDEO_APPROVED`, `VIDEO_REJECTED` | `moderationService.approve`/`reject` — "Re-record Requested" is intentionally **not** a separate type; `VIDEO_REJECTED`'s copy already instructs the Creator to re-record, so a second notification for the same event would be duplicated notification logic |
| Requester Review | `VIDEO_READY`, `REVIEW_REMINDER`, `VIDEO_ACCEPTED`, `RESHOOT_REQUESTED`, `VIDEO_REQUESTER_REJECTED` | `moderationService.approve` (Video Ready to Requester), `notificationReminderJob.remindPendingReviews`, `requesterReviewService.*` |
| Escrow | `ESCROW_RESERVED`, `PAYMENT_RELEASED`, `REFUND_ISSUED`, `PAYMENT_COMPLETED` | `escrowService.reserve`/`release`/`refund`, `requesterReviewService.acceptVideo` (Payment Completed, to the Requester — distinct from Payment Released, which goes to the Creator) |
| Ratings | `RATING_REMINDER`, `RATING_RECEIVED` | `notificationReminderJob.remindMissingRatings`, `ratingService.rate` |
| Reports | `REPORT_SUBMITTED`, `REPORT_UPDATED`, `REPORT_RESOLVED` | `reportService.create`/`dismiss`/`resolve` |
| Trust | `BADGE_EARNED`, `TRUST_SCORE_UPDATED`, `VERIFICATION_GRANTED` | `trustScoreService.checkAndNotifyChanges` (called from `GET /trust-profile/me` only — see interim-decision note below), `trustScoreService.adminSetVerified` |
| Disputes | `DISPUTE_CREATED`, `NEW_EVIDENCE`, `ADMIN_ASSIGNED`, `DISPUTE_MESSAGE`, `DISPUTE_RESOLVED`, `DISPUTE_REOPENED`, `REFUND_COMPLETED` | `disputeService.*` — a refund-direction resolution sends the more specific `REFUND_COMPLETED` to the Requester instead of a second generic `DISPUTE_RESOLVED` for the same event |
| Admin alerts (push-only) | `SUSPICIOUS_USER`, `HIGH_PRIORITY_REPORT`, `HIGH_VALUE_ESCROW`, `LARGE_REFUND` | `reportService` (3-strikes flag, Abuse/Fake-recording category), `requestService.create` (high-value), `escrowService.refund`/`disputeService.adminResolve` (large refund, reusing `REQUEST_HIGH_VALUE_THRESHOLD` as the threshold — no separate PRD number exists) |
| Safety-critical (ungated) | `ACCOUNT_SUSPENDED`, `PAYOUT_REJECTED` | `adminService.toggleBlock`/`processPayout` |
| Wallet/Payout (pre-existing) | `PAYOUT_REQUEST`, `PAYOUT_APPROVED`, `PAYOUT_REJECTED` | `walletService.withdraw`, `adminService.processPayout` |

**Interim decisions, flagged (not silently invented, per docs/CLAUDE.md §8 rule 11):**
- `RECORDING_REMINDER`/`REVIEW_REMINDER`/`RATING_REMINDER` thresholds (10 min / 2h / 24h,
  `notificationReminderJob.ts`) are engineering defaults — the PRD names the trigger, not a wait
  time. Each fires at most once per request per stage, tracked via new `Request` columns
  (`recordingReminderSentAt`/`reviewReminderSentAt`/`ratingReminderSentAt`), swept every 5
  minutes alongside the existing lifecycle jobs (`src/server.ts`).
- `BADGE_EARNED`/`TRUST_SCORE_UPDATED` change-detection only runs from `GET /trust-profile/me`
  (self-fetch), not from every `trustScoreService.getProfile` call site (that call runs on
  nearly every request-detail page load across the app and would make this an expensive,
  spammy per-request check). The last-notified snapshot (`User.lastNotifiedTrustScore`/
  `lastNotifiedTrustBadges`) is bookkeeping only — the Trust Score itself is still always
  computed on demand, never denormalized.
- `WELCOME` and `SIGNUP_SUCCESSFUL` fire together at registration completion — there's no
  separate "first login" event in this codebase to distinguish them.
- `NEARBY_CREATOR_FOUND` reassures the Requester that eligible creators exist nearby; it's
  distinct from the Creator-facing `REQUEST_PUBLISHED` broadcast, fired from the same
  `notifyEligibleCreatorsOfNewRequest` call site.

## Compliance, Consent, Privacy & Data Retention (PRD §9, §5.7.3, §5.11b, backend Phase 13)

### Consent

- `POST /consent/accept` — `{type: 'TERMS_OF_SERVICE'|'PRIVACY_POLICY'|'COMMUNITY_GUIDELINES'|'RECORDING_POLICY'}`.
  Server stamps the current version from `ComplianceConfig` — the client never supplies a
  version. Creates an immutable `ConsentRecord` row (never updated/deleted anywhere in this
  codebase).
- `GET /consent/status` — per-type `{currentVersion, acceptedVersion, acceptedAt, needsReacceptance}`
  plus a top-level `needsAnyReacceptance`. Mobile's `ConsentGate` auth-gate step and the Privacy
  Settings screen both read this.
- `GET /consent/history` — every `ConsentRecord` for the caller, newest first, including the
  per-request `REQUESTER_DECLARATION`/`CREATOR_DECLARATION` rows `requestService.create`/
  `recordingService.startRecording` write additively (alongside, not instead of, the pre-existing
  `Request.requesterDeclarationAt`/`creatorDeclarationAt` timestamps).

### Privacy Settings

- `GET /privacy/settings` — read-only aggregator: `{consent, accountDeletion, retention}`. Does
  **not** duplicate notification-preference toggles — those stay on the pre-existing
  `GET`/`PATCH /notifications/preferences` (backend Phase 12).

### Account Deletion

"Hard delete" means irreversible PII anonymization + deactivation (`userRepository.anonymize`),
**not** a literal SQL `DELETE` — `Transaction`/`Rating`/`Dispute`/`AdminAuditLog` rows all
FK-reference `User` and must survive (this file's own "Transaction/GPS-metadata retention: 7
years" rule would otherwise be violated by a cascade delete).

- `POST /account/delete-request` — `{reason?}`. `409`s if the caller has any non-terminal
  Request (either side) or a pending `PayoutRequest`. Schedules a hard delete
  `ACCOUNT_DELETION_GRACE_DAYS` (default 30, `ComplianceConfig`-configurable) from now; the
  account stays fully usable during the grace window so the user can log back in and cancel.
- `POST /account/delete-cancel` — clears the scheduled deletion. `409`s if nothing is pending.
- `GET /account/delete-status` — `{deletionRequestedAt, deletionScheduledFor, isPending}`.
- Hard deletes are executed by `retentionJob.executeScheduledHardDeletes` (see below), not by
  any endpoint directly.

### Data Export

- `POST /account/export` — generates synchronously (no job-queue lib in this stack, same
  pragmatic pattern used everywhere else here): a JSON bundle (profile, requests
  created/fulfilled, transactions, ratings, reports, disputes, consent history) uploaded to
  Cloudinary as a `raw` resource (one-off inline uploader, mirrors `profileService`/
  `disputeService`'s pattern — not the video-specific `IVideoStorageProvider`). Returns
  `{id, status, fileUrl, expiresAt}` — the link expires 7 days after generation.
- `GET /account/export` — paginated list of the caller's past export requests.
- `GET /account/export/:id` — single export request detail.

### Welcome-Video Re-Prompt (PRD §5.11b.3)

- `POST /account/welcome-video-ack` — clears `User.welcomeVideoRepromptPending` once mobile has
  re-shown the welcome video. The flag is set by `requesterReviewService.reject` when a Creator's
  `consecutiveRejections` (reset to 0 on any approved submission) reaches
  `CONSECUTIVE_REJECTIONS_REPROMPT_THRESHOLD` (default 3). **The welcome-video screen itself is
  not built this pass** — it's mobile Phase 1 (Onboarding Overhaul) scope, still not started; this
  endpoint and the trigger/counter logic are the backend-owned half PRD §5.11b.3 explicitly calls
  out as backend-owned even though the video plays client-side.

### Admin: Compliance & Data Management

- `GET /admin/compliance/config` — every `ComplianceConfig` row (self-seeding on first read —
  see `complianceConfigService`'s `DEFAULTS` map for the full list: retention windows, consent
  versions, the account-deletion grace period, the welcome-video re-prompt threshold).
- `PATCH /admin/compliance/config/:key` — `{value}`. Audit-logged via the existing
  `AdminAuditLog` (`COMPLIANCE_CONFIG_UPDATED`).
- `GET /admin/compliance/deletion-logs` — paginated `DataDeletionLog` rows (filters `userId`,
  `action`). This is a **separate, immutable table from `AdminAuditLog`** — most Phase 13 actions
  (retention purges, hard deletes) are system/scheduled-job driven with no Admin actor, so they
  don't fit `AdminAuditLog`'s `actorId: Admin` shape.

### Retention Jobs (`retentionJob.ts`, swept every `RETENTION_SWEEP_INTERVAL_MINUTES`, default 60)

| Job | Window (`ComplianceConfig` key) | Effect |
| --- | --- | --- |
| Chat purge | `CHAT_RETENTION_DAYS` (90 `[REVIEW]`) | Deletes `ChatMessage` rows for requests terminal ≥ N days |
| Video asset purge (fulfilled) | `VIDEO_FULFILLED_RETENTION_HOURS` (2 `[REVIEW]`) | Deletes the Cloudinary asset (keeps the `RequestVideo` row/metadata) for COMPLETED/PAYMENT_RELEASED requests |
| Video asset purge (terminal) | `VIDEO_TERMINAL_RETENTION_HOURS` (24 `[REVIEW]`) | Same, for REJECTED/EXPIRED/CANCELLED/DISPUTED requests |
| Notification purge | `NOTIFICATION_RETENTION_DAYS` (180, not PRD-numbered) | Deletes **read** `Notification` rows only |
| Inactive-account cleanup | `INACTIVE_ACCOUNT_DAYS` (365, not PRD-numbered) | Deletes expired registration/password-reset OTP rows; clears stale `fcmToken` — scoped conservatively, never deactivates/locks an account (the PRD has no inactive-account policy beyond deletion-on-request) |
| Expired-draft cleanup | `DRAFT_CLEANUP_GRACE_HOURS` (1) | Re-invokes `requestLifecycleJob.expireDueRequests` (the actual DRAFT/PUBLISHED→EXPIRED transition is backend Phase 2/8's, unchanged) and adds the Phase 13 `DataDeletionLog` audit row that job doesn't write itself |
| Hard-delete scheduler | `ACCOUNT_DELETION_GRACE_DAYS` (30, on `User.deletionScheduledFor`) | Anonymizes (never row-deletes) every account whose grace period elapsed; sends `ACCOUNT_HARD_DELETED` (safety-critical, bypasses preferences) before anonymizing |

`TRANSACTION_RETENTION_YEARS` (7) and `MODERATION_LOG_RETENTION_YEARS` (3 `[REVIEW]`) are exposed
in `GET /admin/compliance/config` **for informational/documentation purposes only** — no job in
this codebase ever purges `Transaction` or `AdminAuditLog`/moderation-decision rows; do not read
their presence in the config list as evidence that purging is implemented.

Every `[REVIEW]`-tagged number above is an interim engineering default pending client
confirmation, per this file's own established convention — flag before treating as final.

## Error Shape

```json
{
  "success": false,
  "message": "Validation failed.",
  "details": []
}
```
