import {RequestStatus} from '@prisma/client';

import {HttpError} from '../utils/httpError';

/**
 * PRD §5.13 declares an exact 15-state lifecycle. The transition table below encodes every
 * state's valid next-states as data (not scattered `if` chains) so every module that mutates
 * a Request's status — this domain today, and Chat/Recording/Moderation/Escrow/Dispute in
 * later phases (see backend/docs/MASTER_EXECUTION_PLAN.md) — validates against one source of
 * truth. The exact PRD PDF table was not available in this environment; this table was
 * reconstructed from the phase-by-phase lifecycle narrative in backend/docs/CLAUDE.md §2 and
 * MASTER_EXECUTION_PLAN.md Phases 2-7 and should be diffed against PRD §5.13 directly before
 * Phases 3+ start wiring transitions that aren't exercised by this phase's endpoints.
 */
const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  // Requester submits; auto-publishes unless high-value-review or SCHEDULED (Phase 2). v2.1
  // adds PENDING_MODERATION as an alternate next state for when the Moderation Toggle (backend
  // Phase 5, not yet wired) is ON — added here as a pure graph edge so Phase 5 doesn't need a
  // second state-machine PR; DRAFT -> PUBLISHED directly remains the only path any endpoint
  // actually takes today.
  DRAFT: ['PUBLISHED', 'PENDING_MODERATION', 'CANCELLED', 'EXPIRED'],
  // v2.1 pre-publish moderation gate (summary §5.6) — approved publishes, rejected refunds.
  // Not yet emitted by any endpoint (backend Phase 5 wires the Moderation Toggle that triggers
  // this path); added now so Phase 5 is a pure service-layer change, not another schema/graph PR.
  PENDING_MODERATION: ['PUBLISHED', 'REJECTED'],
  // "published_searching" in v2.1 terminology — same state as this codebase's existing
  // PUBLISHED, renamed only in the PRD prose, not in this enum (no data migration needed; see
  // docs/CLAUDE.md §2.8's note on why a blind enum rename was avoided). v2.1 adds MATCHING_WINDOW
  // as an alternate next state for Highest Rated Creator mode (backend Phase 4, not yet wired) —
  // First Accepted (CREATOR_ASSIGNED direct) remains the only path any endpoint takes today.
  PUBLISHED: ['CREATOR_ASSIGNED', 'MATCHING_WINDOW', 'CANCELLED', 'EXPIRED'],
  // v2.1 Highest Rated Creator matching window (summary §5.6, §5.7/TRD 7.2.1) — 90s window,
  // winner assigned or falls back to searching on zero respondents. Not yet emitted by any
  // endpoint (backend Phase 4); added now for the same reason as PENDING_MODERATION above.
  MATCHING_WINDOW: ['CREATOR_ASSIGNED', 'PUBLISHED'],
  // Creator locked in via mutex; releases back to PUBLISHED if the acceptance timer lapses.
  // v2.1 removed the TEMPORARY_CHAT interstitial (replaced by the pre-acceptance Query, which
  // doesn't gate this state machine at all — it's a separate table, not a Request.status value)
  // — CREATOR_ASSIGNED -> RECORDING is the v2.1-correct direct edge. TEMPORARY_CHAT is
  // deliberately left reachable below too: removing it here without Pre-Acceptance Query built
  // (backend Phase 4) would drop chat functionality entirely for the gap between this change and
  // Phase 4 landing, so both v2.0's chat path and the v2.1-correct direct path coexist until
  // Phase 4 replaces the former (see docs/CLAUDE.md §2.2 for the tracked migration).
  CREATOR_ASSIGNED: ['RECORDING', 'TEMPORARY_CHAT', 'PUBLISHED', 'CANCELLED'],
  // v2.0 post-acceptance chat (superseded, PRD_TRD_SUMMARY.md §10 item 3) — kept functional
  // until backend Phase 4 replaces it with Pre-Acceptance Query + (Moderation-OFF-only)
  // Post-Submission Chat. Do not extend this state; migrate off it, don't build on it.
  TEMPORARY_CHAT: ['RECORDING', 'PUBLISHED', 'CANCELLED'],
  // Deleting an uploaded draft before Moderation acts on it (backend Phase 5) reverts back to
  // RECORDING so the Creator can re-record/re-upload from scratch.
  RECORDING: ['UPLOAD', 'CANCELLED'],
  UPLOAD: ['MODERATOR_REVIEW', 'RECORDING'],
  // Moderator approves (Requester sees video) or rejects (per §7.3's reason-specific escrow table).
  // MODERATOR_REVIEW -> RECORDING: the Creator withdrew (deleted) the uploaded draft before a
  // Moderator acted on it (backend Phase 5) — not a Moderator action, so not itemized above.
  // DISPUTED: Admin/Moderator "Escalate to Dispute Center" (backend Phase 5 item 6) — the only
  // path into DISPUTED from here, never a participant action (see disputeValidation.ts).
  MODERATOR_REVIEW: ['REQUESTER_REVIEW', 'REJECTED', 'RECORDING', 'DISPUTED'],
  // Requester accepts, asks for the one free re-shoot, or rejects into Dispute Center. A
  // participant may also raise a dispute directly out of REQUESTER_REVIEW (backend Phase 11).
  REQUESTER_REVIEW: ['ACCEPTED', 'RESHOOT_REQUESTED', 'REJECTED', 'DISPUTED'],
  // Re-shoot re-enters the recording/upload pipeline; only Accept/Reject follow (no 2nd re-shoot).
  RESHOOT_REQUESTED: ['RECORDING'],
  // ACCEPTED/PAYMENT_RELEASED are momentary in practice (requesterReviewService.acceptVideo
  // chains straight through to COMPLETED in one call) but a dispute can still legally be raised
  // against either "payment-related" state per this milestone's explicit business rule.
  ACCEPTED: ['PAYMENT_RELEASED', 'DISPUTED'],
  PAYMENT_RELEASED: ['COMPLETED', 'DISPUTED'],
  // A dispute can be raised even after a request is fully COMPLETED (paid out) — backend Phase 11.
  // Tipping (PRD §7.6's exact wording: "Terminal. Does not alter Completed.") never transitions
  // Request.status away from COMPLETED — tipService.tip (Phase 2) correctly never calls
  // assertTransition, so TIPPING has no valid incoming edge here on purpose; it stays a defined,
  // reserved enum value with no transition into it (matches actual product behavior, not a gap).
  COMPLETED: ['DISPUTED'],
  REJECTED: ['DISPUTED'],
  DISPUTED: [],
  EXPIRED: [],
  CANCELLED: [],
  TIPPING: [],
};

export const TERMINAL_STATUSES: readonly RequestStatus[] = [
  'COMPLETED',
  'REJECTED',
  'DISPUTED',
  'EXPIRED',
  'CANCELLED',
];

export function isTerminalStatus(status: RequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidNextStatuses(from: RequestStatus): RequestStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** Throws a 409 with the offending states if the transition isn't in the table. */
export function assertTransition(from: RequestStatus, to: RequestStatus): void {
  if (!canTransition(from, to)) {
    throw new HttpError(409, `Cannot transition request from "${from}" to "${to}".`);
  }
}
