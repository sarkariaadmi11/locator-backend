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
(publish/expire). Escrow, Creator matching, chat, recording, and moderation are separate
future domains (see `docs/MASTER_EXECUTION_PLAN.md` Phases 3-8) and are **not** wired here —
`RequestEscrow` doesn't exist yet, so no wallet debit happens on creation today. The full
15-state PRD §5.13 status enum is modelled (`src/services/requestStateMachine.ts`), but only
`DRAFT → PUBLISHED → CANCELLED/EXPIRED` transitions are reachable via these endpoints; later
phases add the rest.

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
Admin review (queue not yet built). A `PROHIBITED` location returns `422`. Otherwise an
`IMMEDIATE`, non-high-value request auto-publishes (`status: "PUBLISHED"`) immediately; a
`SCHEDULED` one stays `DRAFT` until `scheduledAt` (published by the in-process lifecycle
sweep, see below). Returns the created request (see shape under `GET /requests/:id`).

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

On success: `status → CREATOR_ASSIGNED`, `creatorId` set, `acceptedAt` = now,
`acceptanceTimerExpiresAt` = now + `ACCEPTANCE_TIMER_MINUTES`. The Requester is pushed
("Creator found!"). Returns the standard request shape.

### Acceptance-timer expiry (internal, no endpoint)

`src/services/acceptanceTimerJob.ts`, swept every 30 seconds from `src/server.ts`. Finds
`CREATOR_ASSIGNED` requests whose `acceptanceTimerExpiresAt` has passed (i.e. the Creator
never advanced to Chat/Recording — those phases aren't built yet, so today this always means
"never started"), transitions `status → PUBLISHED` (republish), clears `creatorId`/
`acceptedAt`/`acceptanceTimerExpiresAt`, force-releases the Redis lock (a safety net — the
lock's own TTL almost always already expired it), and pushes the Requester ("Still searching
for a Creator").

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
non-terminal in-flight request (`CREATOR_ASSIGNED` or later — only `CREATOR_ASSIGNED` is
reachable until Chat/Recording are built), or `null` if none.
`acceptanceCountdownSeconds` is only non-null while `activeRequest.status ===
"CREATOR_ASSIGNED"` — seconds remaining until the acceptance timer expires. Fulfilment
history (completed count, earnings) is a later phase — not faked here.

## Error Shape

```json
{
  "success": false,
  "message": "Validation failed.",
  "details": []
}
```
