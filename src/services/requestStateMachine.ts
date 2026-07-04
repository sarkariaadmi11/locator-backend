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
  // Requester submits; auto-publishes unless high-value-review or SCHEDULED (Phase 2).
  DRAFT: ['PUBLISHED', 'CANCELLED', 'EXPIRED'],
  // Searching for a Creator within radius (Phase 3, not wired by this domain's endpoints yet).
  PUBLISHED: ['CREATOR_ASSIGNED', 'CANCELLED', 'EXPIRED'],
  // Creator locked in via mutex; releases back to PUBLISHED if the acceptance timer lapses.
  CREATOR_ASSIGNED: ['TEMPORARY_CHAT', 'PUBLISHED', 'CANCELLED'],
  // Chat closes permanently the moment recording starts (PRD §5.4). Also reverts to
  // PUBLISHED if the acceptance timer lapses before recording starts (acceptanceTimerJob).
  TEMPORARY_CHAT: ['RECORDING', 'PUBLISHED', 'CANCELLED'],
  // Deleting an uploaded draft before Moderation acts on it (backend Phase 5) reverts back to
  // RECORDING so the Creator can re-record/re-upload from scratch.
  RECORDING: ['UPLOAD', 'CANCELLED'],
  UPLOAD: ['MODERATOR_REVIEW', 'RECORDING'],
  // Moderator approves (Requester sees video) or rejects (per §7.3's reason-specific escrow table).
  // MODERATOR_REVIEW -> RECORDING: the Creator withdrew (deleted) the uploaded draft before a
  // Moderator acted on it (backend Phase 5) — not a Moderator action, so not itemized above.
  MODERATOR_REVIEW: ['REQUESTER_REVIEW', 'REJECTED', 'RECORDING'],
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
  COMPLETED: ['DISPUTED'],
  REJECTED: ['DISPUTED'],
  DISPUTED: [],
  EXPIRED: [],
  CANCELLED: [],
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
