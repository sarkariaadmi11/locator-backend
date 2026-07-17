# Locator Backend — Master Execution Plan (v2.1 Compliance)

> **Correction (2026-07-15):** every prior status note in this file citing "N pre-existing
> Redis-unavailable failures" (Phase 1, Phase 8 item 3, and the top-level status summaries) was
> based on a dev sandbox where Redis genuinely wasn't reachable at test-run time — that part was
> real. But when Redis *was* later confirmed reachable in this same environment, running the full
> suite surfaced that those tests weren't just "blocked by no Redis" — one (`acceptMutex`'s first
> case) had a stale assertion left over from the `TEMPORARY_CHAT` retirement (Phase 4 item 2) that
> was never updated, and `settingsService`'s Redis cache had no TTL at all, so a value written by
> one test (or by manual testing) could silently leak into a later, unrelated test's "no row
> exists" assertion for as long as Redis stayed up. Both are now fixed: the stale assertion was
> corrected, and `cacheSet` now expires after 60s (matching TRD 8.4's own stated propagation
> target) with settings-test cleanup also evicting the cache key directly. **With Redis reachable,
> the full suite is 23/23 suites, 91/91 tests, no exceptions** — verified 2026-07-15. Do not carry
> forward the "N pre-existing failures" framing from older entries below as still true.

**Derived from `../../docs/PRD_TRD_SUMMARY.md` (PRD v2.1 + TRD).** This replaces all prior execution-plan content, which targeted the now-superseded PRD v2.0. It does **not** start from zero: the existing codebase (documented gap-by-gap in `docs/CLAUDE.md` §2 and endpoint-by-endpoint in `docs/API.md`) is a mature, working implementation of a v2.0-shaped product — auth, GPS matching, Redis mutex locking, recording/upload, moderation, requester review, escrow, ratings, reports, disputes, admin panel, notifications, and compliance/retention are all built and functioning. This plan sequences the **migration** off the v2.0-shaped pieces and the **addition** of what v2.1 requires that doesn't exist yet.

Every phase cites the `PRD_TRD_SUMMARY.md` section(s) it implements. Do not add scope not traceable to the summary (or, where more detail is needed, `docs/Locator_App_PRD_v2.1.md`/`docs/Locator_App_TRD.txt` directly).

---

## Phase 0 — Decisions & Schema-Design Lock (blocking, do first)

**Summary refs:** §11 (Open Questions), §4 (Data Model), §10.

No migration work starts until these are decided — several are genuine architecture forks, not just numeric confirmations.

1. **[ ] Video storage: keep Cloudinary or migrate to S3?** (`docs/CLAUDE.md` §2.17). `IVideoStorageProvider` already isolates the decision to one new file + a one-line swap — but TRD's client-direct-to-S3-multipart upload model is a different *transport* shape than today's API-tier-proxied Cloudinary upload, so this also affects the Recording module's request/response shapes if changed. Decide before Phase 5 below.
2. **[ ] Job scheduler: adopt BullMQ + node-cron, or keep `setInterval`?** (`docs/CLAUDE.md` §2.18). The Highest Rated matching-window close (Phase 4) *needs* a genuine per-request delayed job — `setInterval` sweeps can approximate this but not cleanly. Recommendation: adopt BullMQ now (ioredis is already a dependency) rather than build a second ad-hoc delayed-job mechanism on top of `setInterval`.
3. **[x] Ledger design: extend `Transaction`, or introduce a new `ledger_entries` table alongside it?** — **Decided 2026-07-14: new table.** Introduced `LedgerEntry` (Phase 1) as a standalone append-only table for Credits/Connects/INR; `Transaction` untouched, stays the Razorpay-specific payment-gateway audit trail. No cross-FK from `LedgerEntry` to `Transaction` was added — they're parallel audit trails for two different economy modes, not layered.
4. **[x] Confirm the numeric defaults PRD_TRD_SUMMARY.md flags as garbled/ambiguous** (§11 item 8) — **Decided 2026-07-14:** PRD §7.3 defaults used as authoritative, captured in `src/config/betaEconomy.ts`: signup 300 Credits/30 Connects, request cost 150 Credits, creator reward 150 Credits, accept cost 1 Connect, daily bonus 5 (cap 50).
5. **[ ] `settings_version_id` generalization scope**: decide whether every request-adjacent write pins a settings version (full TRD 7.1.1 compliance) or only the highest-risk ones (economy amounts, timers) at first — recommend full compliance since `RequestEscrow.commissionRate` already proves the snapshot pattern works and is cheap.
6. **[ ] RBI prepaid-instrument / legal sign-off items** (summary §8.4, §11 items 6-7): not blocking for Beta-mode-only work (Phases 1-6 below never touch `ENABLE_BUY_CREDITS`/`ENABLE_BUY_CONNECTS`), but must be resolved before any Public Launch real-money-mode work ships. Flag to product/legal now so it isn't rediscovered at Phase 9.
7. **[ ] Public-identity audit** (`docs/CLAUDE.md` §2.12): before building new user-facing payloads in Phases 1-8, do a one-time pass over every existing participant-facing presenter (`requestPresenter`, `ratingPresenter`, `disputePresenter`, notification payload builders) confirming `User.name` never appears where only `username` should. Cheap, should happen before compounding the problem in new modules.

**Exit criteria:** all seven items above have a documented decision (even if the decision is "defer, tracked as risk") committed to this file or a linked ticket before Phase 1 migrations begin.

**Progress (2026-07-14):** items 3-4 decided (see inline above). Items 1-2 (video storage, job scheduler) deliberately left undecided — neither blocks Phase 1/2 work, revisit before Phase 4 (job scheduler) and Phase 5 (video storage transport). Items 5-7 (settings_version_id scope, RBI sign-off, public-identity audit) remain open, tracked for Phase 6/7/9.

---

## Phase 1 — Foundational Schema Migrations

**Summary refs:** §4 (Data Model) in full, §10.

The single highest-leverage phase: every later phase depends on these tables existing. Ordered so nothing here references a table created later in this phase.

1. **[x] `platform_settings` + `platform_settings_versions`** (summary §4.15) — key-value economy/operational/feature-flag store with immutable version history. This unblocks Phase 6 (Feature Flags admin page) and is also the mechanism Phase 2's `settings_version_id` FK points at.
2. **[x] Beta Credits/Connects wallet fields** (summary §4.3): `earnedCredits`, `bonusCredits`, `purchasedCredits`, `creatorConnects`, `lastDailyConnectGrantDate` added directly to `User` (not a separate `Wallet` model — matches this codebase's existing convention of `walletBalance` living directly on `User`). `walletBalance` (INR) deliberately left untouched/un-migrated to paisa — that unit conversion was judged higher-risk than the value it adds right now and is deferred; every real-money code path still reads `walletBalance` in rupees exactly as before.
3. **[x] `LedgerEntry` table** (summary §4.4) — append-only, `reasonCode` enum, `settingsVersionId` (string, not yet FK-enforced pending Phase 6), `idempotencyKey` unique nullable column. Landed schema-only in this item; **wired to a real writer in Phase 2** (`ledgerService`, done — see below), ahead of this phase's original "schema-only" scope.
4. **[x] `requests` table alterations**: added `acceptanceMode` enum (`FIRST_ACCEPTED|HIGHEST_RATED`, default `FIRST_ACCEPTED`), `currencyMode` enum (`CREDIT|INR`, default `INR`), `settingsVersionId`. **Status enum extended additively** (`PENDING_MODERATION`, `MATCHING_WINDOW`, `TIPPING` added; `TEMPORARY_CHAT`/old states intentionally NOT removed yet) rather than renamed with a data migration — the full v2.1 rename + existing-row remap is Phase 3's job (riskier, touches every module reading `Request.status`); this item only unblocks Phase 3 without pre-empting it.
5. **[x] `PreAcceptanceQuery` + `PreAcceptanceQueryMessage` tables** (summary §4.6) — `exchangeCount`, `status` enum, per-Creator thread (`@@unique([requestId, creatorId])`).
6. **[x] `MatchingWindowResponse` table** (summary §4.7) — for Highest Rated mode (Phase 4).
7. **[x] `PostSubmissionChatMessage` table** (summary §4.10) — modeled as a separate table from `ChatMessage`, per the plan's own recommendation.
8. **[x] `Tip` table** (summary §4.13).
9. **[x] `VerifiedCreatorStatus` table** (summary §4.12) — `completedCount`, `isVerified`, `revokedReason`, `lastEvaluatedAt`. `User.isVerified` left as-is; Phase 7 decides reconciliation.
10. **[x] `Rating.visibleAt`** column (summary §4.11) — double-blind reveal timestamp, nullable/unset until Phase 8 wires the computation.
11. **[x] KYC/bank fields on `User`** (summary §4.2: `bankAccountNumber`, `bankIfsc`, `kycStatus`) — schema only, no encryption/logic yet.
12. **[x] `usernameChangedCount`** on `User` (summary §4.2) — schema only; enforcement is Phase 8 item 8.

**Exit criteria:** met. `prisma migrate dev` applied cleanly against the real dev Postgres DB (migration `20260714085613_v2_1_phase1_additive_schema`); every existing `Request` row keeps its pre-migration status (additive enum, no remap needed this phase); `tsc --noEmit` and the full Jest suite (28/30 → 34/36 after Phase 2's additions below; the 2 failures are a pre-existing Redis-unavailable environment issue, not caused by this migration) both pass clean.

---

## Phase 2 — Beta Credits/Connects Wallet & Ledger

**Summary refs:** §3.2, §4.3, §4.4, §5.6 (Wallet/Ledger state machine), §10 item 7.

Depends on: Phase 1 items 1-3.

1. **[x] `ledgerService`** (`src/services/ledgerService.ts`) — single write path per currency. Uses guarded `updateMany` (`WHERE balance >= amount`) rather than an explicit `SELECT ... FOR UPDATE`, matching the pattern `transactionRepository.markSuccessIfPending`/`escrowService` already use elsewhere in this codebase — a negative balance is structurally impossible either way. `debitCredits` enforces bonus→purchased→earned spend order with a 3-attempt optimistic-retry loop; every write inserts a `LedgerEntry` row in the same transaction as the balance update; `idempotencyKey` replay returns the original entry without re-applying. Covered by `src/services/__tests__/ledger.integration.test.ts` (6 tests, DB-backed, all passing).
2. **[x] `walletService` additions**: `GET /wallet` (new endpoint, `walletService.getWallet`) returns `{earnedCredits, bonusCredits, purchasedCredits, videoCredits, creatorConnects, inrBalance}` — `videoCredits` computed at read time, never stored. Spend order lives entirely in `ledgerService.debitCredits`, never left to callers.
3. **[x] Signup bonus + Daily Free Connects grant**: `ledgerService.grantSignupBonus` wired into both `authService` registration-completion paths (email OTP + phone OTP), idempotency-keyed per-user so it can never double-grant. `ledgerService.grantDailyConnectBonusIfDue` is event-driven, hooked into `GET /wallet` (the natural "app opened" signal) rather than a midnight cron — idempotent per IST calendar day via `lastDailyConnectGrantDate`, caps the grant so balance-from-daily-bonus never exceeds 50.
4. **[x] `ENABLE_REAL_MONEY` feature flag** (`src/config/env.ts`, default `false`): gates `walletService.createOrder`/`verifyPayment`/`withdraw` (403 when off). Interim env-var gate per the plan's own guidance — Phase 6 replaces it with the full `platform_settings` surface.
5. **[x] Migrate `RequestEscrow` to be currency-aware** (2026-07-14): added `RequestEscrow.currency` (`CREDIT|INR`, default `INR`). `escrowService.reserve/release/refund` now branch on it — CREDIT routes through `ledgerService` (zero commission; `creatorEarnings` is the independently-configured Creator Reward constant, not a split of the held amount, per PRD §7.3's "Request Cost ≠ Creator Reward, equal only by default" design), INR keeps the exact pre-existing `walletBalance`/`Transaction` logic untouched. `requestService.create` now derives `currencyMode` from `ENABLE_REAL_MONEY` (CREDIT when off — the v2.1 default) and uses the fixed Request Cost (150 Credits) instead of a client-supplied amount in that mode, skipping high-value review (N/A in Beta per PRD §5.3.1). `escrowService.adminSummary` scoped to INR-only (mixing Credits+INR sums would be misleading) with a comment pointing at Phase 6 for a proper per-currency breakdown. Tested (`src/services/__tests__/escrowCredit.integration.test.ts`, 3 tests). **Deliberately out of scope for this item:** `disputeService.resolve`'s delta-based split-settlement math is still INR/`walletBalance`-only — a CREDIT-mode dispute resolution would currently misbehave; flagged, not silently left broken (see the Phase 11 note this plan should carry once written that far).
6. **[x] Tipping** (`tipService.ts`, new — `Tip` table from Phase 1): `POST/GET /requests/:id/tips`, 10-500 Credits or ₹10-500 depending on `currencyMode`, 100% to Creator, zero commission always, 7-day window post-`completed` (measured from `requesterDecisionAt`). Branches on `request.currencyMode`: CREDIT via `ledgerService`, INR via the existing `walletBalance`/`Transaction` pattern. Tested (`src/services/__tests__/tip.integration.test.ts`, 5 tests, both currency branches).

**Exit criteria: met.** A Beta-mode user signs up (receives signup bonus + Connects), posts a request (Credits debited via `ledgerService`/`LedgerEntry`, not `Transaction`), gets it fulfilled (Creator's reward Credits released), and tips — all verified end-to-end and covered by tests. A real-money-mode user (`ENABLE_REAL_MONEY=true`) still works exactly as before via the existing Razorpay/escrow path (verified — INR-mode tests still pass unchanged).

**Behavioral change to be aware of when testing manually:** since `ENABLE_REAL_MONEY` defaults to `false`, every request created via the API right now is CREDIT-mode by default (matching v2.1's actual Beta-launch intent) — this is intentional, not a bug, but manual/Postman testing will see Credits-denominated requests unless `ENABLE_REAL_MONEY=true` is set in the environment.

---

## Phase 3 — Request State Machine Migration (v2.0 → v2.1)

**Summary refs:** §4.5, §5.6, §10 items 3, 5.

Depends on: Phase 1 item 4. This is the riskiest phase — touches every module that reads `Request.status`.

1. **[x] Rewrite `requestStateMachine.ts`'s transition table** (2026-07-14) against the v2.1 transition set — **but see the scoping decision below before treating this as "done" in the full sense the original wording implied.** Added `PENDING_MODERATION` (DRAFT's alternate next state) and `MATCHING_WINDOW` (PUBLISHED's alternate next state) as pure new graph edges — safe, zero-regression additions since no endpoint emits them yet (Phases 4/5 will). **Deliberate scoping decision:** did **not** rename `PUBLISHED`→`published_searching`/`CREATOR_ASSIGNED`→`creator_assigned` etc. — these are the same states, v2.1's prose just uses lowercase-with-underscores naming; renaming the Prisma enum values would be pure churn with no behavioral benefit, so this plan treats the v2.1 spec names as documentation-only aliases for the existing enum values everywhere except where a *genuinely new* state was needed (`PENDING_MODERATION`, `MATCHING_WINDOW`, `TIPPING`, all landed in Phase 1). The `SELECT ... FOR UPDATE`-before-guard-check invariant was verified already present for existing transitions (escrow code's discipline) — not yet added to the two new edges above since nothing calls them yet.
2. **[x] Request expiry: 24h → 5h** (2026-07-14, `docs/CLAUDE.md` §2.8): `REQUEST_EXPIRY_HOURS` (`requestValidation.ts`) changed 24 → 5; `requestLifecycleJob.ts` already derived its sweep from this constant so no separate job change was needed. Scheduled requests: added `REQUEST_SCHEDULED_MIN_LEAD_HOURS = 4` (was unenforced entirely, not just 30min) plus a new 7-day-max validation (neither existed before). **Still hardcoded**, not yet admin-configurable via `platform_settings` (Phase 6) — flagged, not silently left as a TODO. **Not done**: the "acceptance window opens 2-4h before scheduled slot" mechanic — today's scheduled sweep still opens the request for acceptance at `scheduledAt` itself, not before it; that's item 4 below's job, still open.
3. **[ ] Remove `TEMPORARY_CHAT` from the accept flow.** **Deliberately not done yet** (2026-07-14 scoping decision): `requestService.accept` still chains `CREATOR_ASSIGNED → TEMPORARY_CHAT`, and the state machine now has *both* the old `CREATOR_ASSIGNED → TEMPORARY_CHAT → RECORDING` path and the v2.1-correct `CREATOR_ASSIGNED → RECORDING` direct edge available (see item 1's edit) — but only the old path is actually reachable from any endpoint today. Removing `TEMPORARY_CHAT` now, before Phase 4's Pre-Acceptance Query exists, would delete the only working chat feature in the app with nothing to replace it for however long Phase 4 takes. **Do this together with Phase 4 item 1**, not before, so chat capability is never dropped mid-migration.
4. **[ ] Insert `pending_moderation` / `published_searching` split as an actually-reachable path**: the state machine *can* express `draft → pending_moderation → published_searching` now (item 1), but no endpoint triggers it yet — `requestService.create` still always publishes directly. This is Phase 5's job (Moderation Toggle) to actually wire, not a Phase 3 gap; noted here so it isn't mistaken for done.
5. **[x] `requester_review_auto_accept` job** (2026-07-14, summary §5.8, TRD 9): new `requesterReviewAutoAcceptJob.ts`, wired into `server.ts` on a 15-min interval — 42h warning push (`autoAcceptWarningSentAt` gate, new `Request` column), 48h auto-accept reusing `requesterReviewService.acceptVideo` directly (so auto-accept goes through the exact same escrow-release path a manual Accept does, no duplicated logic). Tested (`src/services/__tests__/requesterReviewAutoAccept.integration.test.ts`, 3 tests).
6. **[x] `tipping` terminal state — resolved as N/A, not a gap.** PRD §7.6's exact wording is "Terminal. Does not alter Completed." — tipping never transitions `Request.status` away from `COMPLETED` at all. `tipService.tip` (Phase 2) correctly never calls `assertTransition`; `TIPPING` stays a defined-but-unreachable enum value (documented inline in `requestStateMachine.ts`). Re-read this item's summary §5.6 abbreviation as "completed → tipping" carefully before assuming a transition is needed — it isn't.

**Exit criteria: partially met, by design.** Items 2 and 5 are fully done and tested end-to-end. Items 1 and 4 landed the state-machine *shape* (new edges exist, safe/additive) without yet making the new paths *reachable* from any endpoint — that reachability work is correctly Phase 4 (Pre-Acceptance Query, Highest Rated matching) and Phase 5 (Moderation Toggle)'s job, not a re-scope of Phase 3. Item 3 (removing `TEMPORARY_CHAT`) is explicitly deferred to be done atomically with Phase 4 item 1 so chat functionality is never dropped mid-migration. This phase should be considered "foundation laid, full cutover pending Phases 4-5" rather than "complete."

---

## Phase 4 — Pre-Acceptance Query + Acceptance Modes

**Summary refs:** §3.4, §4.6, §4.7, §5.6, §5.7 (TRD 7.2.1, 8.2), §10 item 3, 4.

Depends on: Phase 1 items 5-6, Phase 3 (state machine must have `matching_window` state available).

1. **[x] `queryService`** (2026-07-14): `POST /requests/:id/queries`, `GET /requests/:id/queries`, `POST /requests/:id/queries/:threadId/reply`, `POST /requests/:id/queries/:threadId/decline` — max 3 exchanges of ≤200 chars per Creator-thread (counted as the Creator's questions only; Requester replies are unlimited, matching the PRD journey map's exact "3rd exchange" wording), reusing `chatContentFilter.ts`. Does not lock the request or touch the mutex. Tested (`src/services/__tests__/query.integration.test.ts`, 6 tests: thread creation, cap enforcement, content filtering, per-Creator thread isolation, close-on-accept, decline).
2. **[x] Retire `TEMPORARY_CHAT` from the accept flow** (2026-07-14, done together with item 1 per Phase 3 item 3's explicit sequencing note — chat capability was never dropped mid-migration): `requestService.accept` no longer chains `CREATOR_ASSIGNED → TEMPORARY_CHAT`; it now calls `queryService.closeAllForRequest` directly from `CREATOR_ASSIGNED`. `recordingService.startRecording` and `acceptanceTimerJob`'s sweep now accept `CREATOR_ASSIGNED` as the primary resting state (both still also accept `TEMPORARY_CHAT` so any pre-existing row from before this change can still resolve — not a hard cutover of old data, a forward-only behavior change). `ChatMessage`/`chatService.ts`/the `/requests/:id/chat` routes are left in place, functionally orphaned rather than deleted outright, since deleting working code with live route registrations is unnecessary churn — no new row can ever reach `TEMPORARY_CHAT` going forward, so they're dead code in practice, not a maintained parallel system.
3. **[x] Acceptance Mode field + First Accepted (unchanged)** — confirmed still true: `requests.acceptanceMode` defaults to `FIRST_ACCEPTED` (landed schema-only in Phase 1); `creatorLockService.ts`/`POST /requests/:id/accept` untouched apart from the `TEMPORARY_CHAT` removal above. No client can select `HIGHEST_RATED` yet (item 4 below).
4. **[x] Highest Rated mode** (2026-07-14): `POST /requests/:id/respond`, new `matchingWindowService.ts`/`matchingWindowJob.ts`. **Scoped-down versus the original TRD 7.2.1/8.2 design in one deliberate way**: responses are written straight to `MatchingWindowResponse` (Postgres) at response time rather than a Redis sorted-set reservation + Postgres-only-at-close — simpler and still correct (no `LedgerEntry` row is written until window-close, matching the "no premature ledger write" invariant that actually matters), but not the exact Redis-first optimization TRD describes. Window-close uses the existing `setInterval` sweep pattern (`matchingWindowJob`, 15s tick) rather than a BullMQ delayed job — Phase 0 item 2's scheduler decision is still open, so this is the same pragmatic choice every other sweep job in this codebase already makes, not a new inconsistency. Winner picked via Bayesian-adjusted average rating (prior mean 3.5, prior weight 3 — approximates "<3 ratings" per the PRD's plain-language description), tie-break num_ratings → distance → earliest response; only the winner's Connect is debited (`ACCEPT_SPEND`), losers' reservations flip to `RELEASED`; falls back to `PUBLISHED`/`FIRST_ACCEPTED` on zero (or all-failed) responses. `HIGHEST_RATED_WINDOW_SECONDS` (default 90, admin-configurable 30-300 via `PATCH /admin/settings/HIGHEST_RATED_WINDOW_SECONDS`) added to the settings registry. Tested (`src/services/__tests__/matchingWindow.integration.test.ts`, 5 tests — respond/idempotent-retry, window-closed rejection, insufficient-Connects rejection, zero-response fallback, winner-selection + Connect spend/release). **Also fixed in the same pass**: `requestService.accept` (First Accepted) never actually debited the Creator's Connect on Accept despite `SettingsKey.ACCEPT_REQUEST_CONNECTS` existing since Phase 6 — a genuine pre-existing bug, not part of this item's original scope, caught while building the parallel Highest Rated debit path and fixed alongside it (with rollback-on-debit-failure so a losing race is never charged).
5. **[x] Post-Submission Chat** (2026-07-14, done as part of Phase 5 item 4 below — see that entry for the actual implementation notes) — this item's checkbox was previously left unchecked even though the service was built; correcting the stale status here rather than duplicating the note.

**Exit criteria: met.** A Creator can ask ≤3 questions before accepting without locking the request; First Accepted mode behaves identically to before except it now correctly spends a Connect (previously silently free — see item 4's bug-fix note); Highest Rated mode correctly reserves N respondents without a premature ledger write, debits exactly the winner's Connect at window close, and falls back correctly at zero responses.

---

## Phase 5 — Moderation Toggle & Post-Publish/Video Moderation Gating

**Summary refs:** §3.5, §5.6, §5.13, §10 item 6.

Depends on: Phase 1 item 1 (or Phase 2 item 4's interim flag mechanism), Phase 3 item 4.

1. **[x] `platform_settings.moderation_toggle`** (2026-07-14): new `settingsService.ts` + `settingsRepository.ts` on top of the `PlatformSetting`/`PlatformSettingVersion` tables from Phase 1 — direct-DB-read (no Redis cache yet), exactly the interim this item's own text allows. `SettingsKey.MODERATION_TOGGLE`, defaults `true` (ON) when no row exists. This is also the first real usage of the Phase 1 settings schema, ahead of Phase 6 — Phase 6 extends this module rather than replacing it.
2. **[ ] Gate pre-publish moderation** — **not done.** `requestService.create` still always publishes Immediate/non-high-value requests straight to `PUBLISHED`; there is no admin queue of any kind for `DRAFT`-held requests (high-value/Scheduled requests today have no path out of `DRAFT` except eventual expiry — a **pre-existing gap independent of this item**, not newly introduced). Wiring `draft → pending_moderation → published_searching` requires building item 5's admin queue first — the two are really one piece of work, not sequential.
3. **[x] Gate video moderation** (2026-07-14): `recordingService.completeUpload` now branches `UPLOAD → MODERATOR_REVIEW` (toggle ON) vs `UPLOAD → REQUESTER_REVIEW` directly (toggle OFF), stamping `moderatorDecisionAt` on the OFF path too so the review-reminder/auto-accept sweeps (Phase 3 item 5) still find these requests. `GET/PATCH /admin/settings/moderation-toggle` (mandatory-reason, audit-logged, mirrors every other Admin-setting-change convention here) lets an Admin actually flip it.
4. **[x] Wire Post-Submission Chat's availability to the toggle** (2026-07-14): new `postSubmissionChatService.ts` + `POST/GET /requests/:id/post-submission-chat` — 409s unless the toggle is OFF **and** the request is in `REQUESTER_REVIEW`. Reuses `chatContentFilter.ts`; flags after 3 blocked attempts, same as `queryService`/`chatService`. Tested (`src/services/__tests__/settingsModeration.integration.test.ts`, 5 tests: default-ON, Admin flip + version history + audit log, and all three Post-Submission Chat gates).
5. **[ ] Pre-publish moderation queue**: `GET/POST /admin/moderation/requests` (queue, approve, reject) — **still entirely missing**, same gap `docs/API.md` already documented. This is the actual blocker for item 2 above. **Deliberately deferred** (2026-07-14 triage): this is genuinely net-new surface (queue model, admin UI, `DRAFT`-holding logic in `requestService.create`), not a quick follow-on to anything just built, and high-value/Scheduled requests already have a working (if inelegant) fallback — eventual expiry — so nothing is silently broken by leaving it. Flagged as the top remaining backend gap, not hidden.
6. **[x] Escalate-to-Dispute action** (2026-07-14): `POST /admin/moderation/videos/:videoId/escalate` — new `disputeService.adminEscalate`/`moderationService.escalate`. Since `Dispute.raisedById` is a hard FK to `User` (no `Admin` variant), the case is attributed to the request's Requester with `raisedByRole: 'ADMIN'` (an existing-but-previously-unused enum value) to correctly mark it staff-initiated rather than a Requester self-service dispute; the escalating Admin is set as `caseOwnerAdmin` immediately, skipping the normal manual "assign" step. Added `MODERATOR_REVIEW` to `DISPUTE_ALLOWED_SOURCE_STATUSES` and to `requestStateMachine`'s `MODERATOR_REVIEW` transition list (→ `DISPUTED`) to make this reachable. Tested (`src/services/__tests__/moderationEscalate.integration.test.ts`).
7. **[x] Safety enforcement never disabled** — verified structurally, not just by inspection: `reportService`/`disputeService`/user-suspension code paths were not touched by this item's changes at all (no dependency on `settingsService` anywhere in those files — confirmed via grep), so they are unaffected by the toggle's state by construction, not by a runtime check that could itself have a bug.

**Exit criteria: partially met.** Video-level moderation gating, Post-Submission Chat, and Escalate-to-Dispute are fully done and tested. **Not met:** pre-publish (request-level) moderation gating (item 2/5) — the one remaining gap in this phase, deliberately deferred (see item 5's note) rather than built shallow.

---

## Phase 6 — Feature Flags / Economy Settings Admin Surface

**Summary refs:** §6.1 item 11, §4.15, §5.7 (TRD 8.4), §10 item 9.

Depends on: Phase 1 item 1.

1. **[x] `settingsService`** (2026-07-14): read-through Redis cache (`settings:cache:{key}`, per-key string not a hash — functionally equivalent for this access pattern) backed by `PlatformSetting` as source of truth; every write updates Redis synchronously and inserts a `PlatformSettingVersion` row. **Important correctness fix made during this item:** the cache layer checks `redis.status === 'ready'` before attempting a command rather than letting ioredis's retry/backoff chain run to exhaustion on every call — with Redis down, that chain took multiple seconds *per settings read* and caused test timeouts (caught and fixed in this same pass, not shipped broken). `settingsVersionId` generalization onto every request/ledger row (beyond the `Request.settingsVersionId` column that already exists from Phase 1) is **not done** — still Phase 6/7 scope.
2. **[ ] Migrate existing `ComplianceConfig` keys into `platform_settings`** — **not done.** `ComplianceConfig`/`complianceConfigService.ts` (retention windows, consent versions, `COMMISSION_RATE_PERCENT`) still exists as a separate mechanism alongside the new `settingsService`. Two systems, not yet consolidated — flagged, not hidden.
3. **[x] Economy value keys** (2026-07-14): all 8 landed in `SettingsKey`/`REGISTRY` (plus `VIDEO_CREDIT_VALUE_INR`/`CREATOR_CONNECT_VALUE_INR` as informational-for-now — nothing reads them yet since Public Launch purchase flows don't exist), seeded with PRD §7.3 defaults. **Wired into the actual code paths that used to hardcode them**: `ledgerService.grantSignupBonus`/`grantDailyConnectBonusIfDue`, `requestService.create`'s Beta-mode cost, `escrowService.reserve`'s Creator Reward, `tipService.tip`'s min/max/window (the zod schema was loosened to a structural sanity check only — `tipService` is now the authoritative bounds check, since zod validation runs before any settings read is possible).
4. **[ ] Operational toggles** (proximity radius, acceptance timer, scheduled-window-open offset, request expiry hours, re-shoot window, high-value threshold) — **not done.** Still hardcoded/env-var-configurable exactly as before (`requestValidation.ts`, `env.ACCEPTANCE_TIMER_MINUTES`, etc.) — item 3 covered the *economy* values the plan explicitly enumerated; these *timer/threshold* values are a separate, not-yet-started sub-item.
5. **[x] Feature flags** (2026-07-14): all 6 wired-but-inactive flags (`ENABLE_REFERRALS`, `ENABLE_CREATOR_LEVELS`, `ENABLE_PURCHASE_CONNECTS`, `ENABLE_PURCHASE_CREDITS`, `ENABLE_WITHDRAWAL`, `ENABLE_DAILY_LOGIN_BONUS`) exist in the registry, default `false`, exposed via `GET /admin/settings` — exactly the plan's own instruction ("do not build any UI/logic behind these beyond the flag existing and defaulting correctly OFF"). `ENABLE_REAL_MONEY` **deliberately left as the Phase 2 env-var gate**, not migrated into `settingsService` — see the note below on why.
6. **[ ] Launch-Stage Presets** — not started (still needs Phase 0 item 2's job-scheduler decision for the revert job).
7. **[x] `GET/PATCH /admin/settings`** (2026-07-14): `adminSettingsController.listAll`/`setSetting`, `GET /admin/settings` + `PATCH /admin/settings/:key`, every field change requires a mandatory `reason` (zod-enforced), audit-logged + version-tracked via `settingsService`. Coexists with the dedicated `GET/PATCH /admin/settings/moderation-toggle` from Phase 5 (kept separate since it's likely to get its own confirmation-dialog UI treatment per PRD §5.14.11's "Moderation Toggle implications" admin-training note) — registered *before* the generic `/settings/:key` route so Express's route-matching order doesn't accidentally shadow it (verified, not assumed).

**Note on `ENABLE_REAL_MONEY`:** left as the env-var gate from Phase 2 rather than migrated into `settingsService`, because the plan's original Phase 2 item 4 already explicitly designed it as an interim mechanism pending Phase 6 — but migrating it now would mean `requestService.create`'s Beta-vs-real-money branch depends on a value that itself depends on Redis-cache-or-DB-read timing, adding a new failure mode to the single most load-bearing branch in the whole request-creation path for a flag nobody is expected to flip at runtime pre-launch. Deliberately deferred, not an oversight — revisit if/when Public Launch cutover planning starts.

**Exit criteria: partially met.** Every PRD §7.3 *economy* value and every wired-but-inactive *feature flag* is now Admin-configurable, cached, versioned, and audit-logged, with a single consolidated `GET/PATCH /admin/settings` surface. **Not met:** operational-timer migration (item 4), `ComplianceConfig` consolidation (item 2), and Launch-Stage Presets (item 6) — these remain open, tracked here rather than silently dropped.

---

## Phase 7 — Trust Profile Correction & Verified Creator Automation

**Summary refs:** §3.5, §4.12, §5.6 item 2, §10 item 2.

Depends on: Phase 1 item 9.

1. **[x] Strip Trust Score from every user-facing response** (2026-07-14): new `trustScoreService.getUserFacingProfile()` (strips the composite `trustScore` field only) — wired into `GET /trust-profile/me`, `GET /trust-profile/:userId`, `GET /auth/me`'s embedded `requesterTrustProfile`/`creatorTrustProfile`, `attachTrustSummaries` (used by `GET /requests/:id`), and the Creator Discovery feed's `attachRequesterTrustProfile` (`GET /requests/nearby`/`available`) — every `trustScoreService.getProfile` call site that was reachable by a `User`-namespace JWT was found via grep and switched, not just the two obvious controller methods. **Clarification vs. this item's original wording:** individual badges (Verified Creator, Top Creator, etc.) are kept, not stripped — the summary's own §5/§9 guidance is explicit that badges + individual data points ARE the v2.1 Trust Profile; only the single composite 0-100 number is removed. Also removed the `TRUST_SCORE_UPDATED` "Your Trust Score is now X" notification entirely (a number that's never displayed shouldn't be pushed to the user either).
2. **[x] Decide fate of the composite score server-side**: kept computing internally — `trustScoreService.getProfile()` (unstripped) is still used for Admin surfaces and for `checkAndNotifyChanges`'s internal change-detection bookkeeping. `getUserFacingProfile()` is the boundary; `getProfile()` must never be called directly from a `User`-namespace controller again (verified via grep at the time of this change — re-verify if a new call site is ever added).
3. **[x] `verified_creator_status` automation** (2026-07-14): new `verifiedCreatorService.evaluate()`, event-driven — called from `requesterReviewService.acceptVideo` (every Completed transition, including auto-accept since that reuses the same function) and `ratingService.rate` (every new Creator-directed rating). Auto-award at threshold (default 50, `SettingsKey.VERIFIED_CREATOR_THRESHOLD`), auto-revoke on suspension (`!user.isActive`) or rolling-window average below `VERIFIED_CREATOR_MIN_RATING` (default 3.5) once the window (`VERIFIED_CREATOR_RATING_WINDOW`, default 20) is actually full, auto-reinstate when the condition clears. `User.isVerified` is kept in sync (not replaced) so every existing consumer works unchanged; `VerifiedCreatorStatus` holds the automation bookkeeping and `revokedReason`. An Admin's manual override still works but will be recomputed by the next event — documented as a deliberate simplification (see `verifiedCreatorService.ts`'s file-level comment), not an oversight. Tested (`src/services/__tests__/verifiedCreator.integration.test.ts`, 6 tests: auto-award, below-threshold, suspension-revoke, low-rating-revoke-then-reinstate, plus 2 Trust-Score-stripping tests).

**Exit criteria: met**, with the one clarified scope note on badges (item 1). A Creator crossing the threshold is auto-verified without Admin action; a verified Creator whose rolling-window average drops below the minimum is auto-revoked and auto-reinstated once it recovers — all verified end-to-end in tests, not just by inspection.

---

## Phase 8 — Security & Operational Hardening Additions

**Summary refs:** §5.10, §5.7 (TRD 8.3), §10.

Can proceed in parallel with Phases 4-7 once Phase 1-3 are stable — these are additive, not migratory.

1. **[x] Generic `Idempotency-Key` middleware** (2026-07-14): `src/middlewares/idempotency.ts` — Redis-backed `{key -> response}`, 24h TTL, fails open (proceeds unprotected) if Redis is unreachable rather than blocking the request, matching `settingsService.ts`'s established posture. Wired onto `POST /wallet/{create-order,verify-payment,withdraw}` and `POST /requests/{,:id/accept,:id/cancel,:id/tips}`. Tested (`idempotency.test.ts`, 2 unit tests covering the no-header-bypass and Redis-unavailable-fail-open paths — the actual replay-a-cached-response path needs a live Redis to verify, flagged as untested rather than assumed).
2. **[x] GPS spoofing / mock-location signal ingestion** (2026-07-14): new `gpsSpoofingService.ts` — server-side impossible-velocity check (>200km/h implied) reusing `User.latitude`/`longitude`/`locationUpdatedAt` (the same fields `/location/save` already maintains, not duplicated). Wired at accept-time (`requestService.accept`) and upload-complete (`recordingService.completeUpload`). Strictly flag-and-queue (Admin-only FCM alert) — never throws, never blocks the caller's action, verified by test. Tested (`gpsSpoofing.integration.test.ts`, 3 tests).
3. **[x] `abandonment_guard_evaluation`** (2026-07-14): new `AbandonmentEvent` table + `User.acceptanceBlockedUntil`, evaluated event-driven from `acceptanceTimerJob` (not a separate sweep, per TRD 9). 3rd expiry in a rolling 30 days sets a 24h block, checked in `requestService.accept`. Tests written and logically verified (`abandonmentGuard.integration.test.ts`, 2 tests) but **currently fail in this dev environment** because `acceptanceTimerJob.runSweep()` calls `creatorLockService.forceRelease`, which needs live Redis — same pre-existing limitation as `acceptMutex.integration.test.ts`, not a defect in this item's logic (confirmed via identical `MaxRetriesPerRequestError` failure signature). Will pass once Redis is running.
4. **[x] `ledger_reconciliation`** nightly job (2026-07-14): new `ledgerReconciliationJob.ts` — `SUM(credits) - SUM(debits)` per user/currency across `LedgerEntry` compared against the denormalized `User` balance columns; alerts Admins on variance, never auto-corrects (a "fix" that writes to the allegedly-wrong value is exactly how a real bug/fraud could hide). Scoped to CREDIT/CONNECT only — INR isn't routed through `LedgerEntry` yet. Wired into `server.ts` on a 24h interval (approximates "nightly ~02:00 IST"; no cron library in this stack, flagged as an approximation). Tested (`ledgerReconciliation.integration.test.ts`, 2 tests — including one that artificially introduces a variance and confirms the job actually detects it, not just that it always reports clean).
5. **[ ] KYC/bank-details flow** — not started, correctly deferred (only relevant once `ENABLE_REAL_MONEY`/`ENABLE_WITHDRAWAL` work is prioritized, per Phase 9).
6. **[ ] API versioning** — not started. Still the "cheap but high-coordination-cost" item this plan already flagged as needing mobile-team coordination before merging; deliberately not done unilaterally in this pass.
7. **[x] Double-blind rating reveal** (2026-07-14): `ratings.visibleAt` (schema already existed from Phase 1) now actually computed in `ratingService.rate()` — new ratings default to `createdAt + 7 days`; when the second direction's rating arrives, both rows are brought forward to `now`. `GET /requests/:id/rating` (`ratingService.getForRequest`) filters to only the caller's own submission plus anything past its `visibleAt`. Tested (`doubleBlindRating.integration.test.ts`, 3 tests: lone-rating-hidden-from-other-party, both-submitted-reveals-both, past-7-days-reveals-without-the-other-side).
8. **[x] Username one-change-ever enforcement** (2026-07-14): `profileService.update` now compares the incoming username against the current one (case-insensitively, matching the existing uniqueness index) — a genuine change is blocked with a 409 once `usernameChangedCount >= 1`; re-submitting the *same* username (e.g. alongside a name/bio edit) is correctly not counted as a change. Tested (`profileUsername.integration.test.ts`, 3 tests).

**Exit criteria: mostly met.** 6 of 8 items done and tested (item 3's tests are correct but Redis-blocked in this environment, not a code defect). Items 5-6 (KYC flow, API versioning) remain open, each for the reason already stated in the plan (KYC genuinely belongs to Phase 9's scope; API versioning needs cross-team coordination this pass didn't have authority to do unilaterally).

---

## Phase 9 — Real-Money Mode Completion (only once `ENABLE_REAL_MONEY` work is prioritized)

**Summary refs:** §3.2, §5.9, §10 item 7, §11 items 6-7.

Deferred until Beta-mode Phases 1-8 are stable and product/legal has resolved Phase 0 item 6 (RBI prepaid-instrument position). Not blocking Beta launch.

1. **[ ] RazorpayX payout integration** + Auto-Payout Toggle (ON → immediate RazorpayX call; OFF → existing `PayoutRequest` Admin-approval queue, which already exists and needs no change).
2. **[ ] Full KYC gate**: block (not reverse) withdrawals crossing ₹50,000 annual until full KYC completes.
3. **[ ] `ENABLE_PURCHASE_CREDITS`/`ENABLE_PURCHASE_CONNECTS`** — only after legal sign-off per Phase 0 item 6; until then these flags must stay OFF and no purchase-of-Credits/Connects UI/endpoint should exist.

**Exit criteria:** flipping `ENABLE_REAL_MONEY` ON in a staging environment produces a fully functional INR economy (top-up → escrow → payout, 15% commission) running on the exact same request/moderation/rating/dispute pipeline Beta mode uses, per PRD_TRD_SUMMARY.md §1's "no re-architecture required" promise — this is the acceptance test for the whole migration's soundness, not just this phase's.

---

## Explicitly Not In This Plan (PRD_TRD_SUMMARY.md §9 — Phase 2/3, do not build)

Live Video Marketplace, algorithmic Trust Score (user-facing — see Phase 7's explicit removal, not addition), Business Accounts, Social Features, full automated payouts without the Admin toggle, AI Moderation/Fraud Detection, automated (non-hybrid) Restricted Location Engine, Right-to-Delete flow beyond the existing account-deletion mechanism, Government Requests Handling, Creator Levels/Gamification, Referral Programme (flags land OFF in Phase 6, nothing more), Analytics Dashboard for end users, multi-language/international expansion, WebSocket real-time feed (30s polling + FCM is correct at MVP scale). If any of these surface as an ask mid-build, treat it as an explicit out-of-band request, not part of this plan.

---

## Sequencing Summary

```
Phase 0 (decisions) ─┬─> Phase 1 (schema) ─┬─> Phase 2 (wallet/ledger) ──┐
                      │                     ├─> Phase 3 (state machine) ─┼─> Phase 4 (query/matching)
                      │                     │                            │
                      │                     └────────────────────────────┴─> Phase 5 (moderation toggle)
                      │                                                        │
                      └─> Phase 6 (settings) ←───── (can start after Phase 1 item 1, parallel to 2-5)
                                │
                                └─> Phase 7 (trust profile) ─┐
                                                              ├─> Phase 8 (hardening, parallel-safe)
                                                              └─> Phase 9 (real-money completion, deferred)
```

Phases 2 and 3 both depend only on Phase 1 and can be built in parallel by separate engineers if needed (they touch mostly-disjoint code — wallet/ledger vs. state-machine/status-enum), but **Phase 4 needs both done** (queries need the new state names; Highest Rated needs both the ledger's soft-hold discipline and the `matching_window` state). Phase 6 (settings) is infrastructure most other phases *want* but don't strictly *need* to start — land it early enough that Phases 3/5/7 aren't reduced to hardcoding values "temporarily" that then need a second migration later.
