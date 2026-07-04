import {z} from 'zod';

// Requester/Creator Trust Profile (backend Phase 10). None of these thresholds/weights are
// PRD-specified numbers (PRD §5.8 only lists the *attributes* — rating/completion%/
// cancellation%/report count/account age — and explicitly defers the *algorithmic* trust-score
// formula to a later phase). Per this milestone's explicit instruction we build the composite
// score and badges anyway; every constant below is therefore an interim, transparent default,
// flagged here (not a silently-invented black box) — confirm with the client before relying on
// exact values in production, same [REVIEW] convention used elsewhere in this codebase.

// --- Composite Trust Score weights (must sum to 100) ------------------------------------
export const TRUST_SCORE_WEIGHTS = {
  successRate: 30, // successfulRequests / completedRequests (terminal outcomes)
  ratingScore: 25, // averageRating / 5 * 100
  reliability: 20, // 100 - cancellationRate
  responseRate: 15, // chat-responsiveness rate
  lowReshoot: 10, // 100 - reshootRate
} as const;

// No rating/history yet -> neutral (not maximal, not zero) starting points, so a brand-new
// account doesn't show a misleadingly perfect or failing score before it has any track record.
export const TRUST_SCORE_NEUTRAL_RATING = 70;
export const TRUST_SCORE_NEUTRAL_SUCCESS_RATE = 100;
export const TRUST_SCORE_NEUTRAL_RELIABILITY = 100;
export const TRUST_SCORE_NEUTRAL_RESPONSE_RATE = 100;
export const TRUST_SCORE_NEUTRAL_RESHOOT = 100;

export const TRUST_SCORE_VERIFIED_BONUS = 5;
export const TRUST_SCORE_SUSPICIOUS_CAP = 40; // a flagged-suspicious user's score is capped, not zeroed
export const TRUST_SCORE_UNRESOLVED_REPORT_PENALTY = 5; // per pending report, capped below
export const TRUST_SCORE_UNRESOLVED_REPORT_PENALTY_CAP = 20;

// --- Badge thresholds --------------------------------------------------------------------
export const BADGE_MIN_SAMPLE_SIZE = 5; // minimum completed/assigned requests before any performance badge can apply
export const TOP_CREATOR_MIN_SUCCESSFUL = 10;
export const TOP_CREATOR_MIN_RATING = 4.5;
export const TRUSTED_REQUESTER_MIN_SUCCESSFUL = 10;
export const TRUSTED_REQUESTER_MAX_CANCELLATION_RATE = 10;
export const LOW_CANCELLATION_MAX_RATE = 5;
export const FAST_RESPONSE_MIN_RATE = 90;

// --- Profile completion checklist ---------------------------------------------------------
export const PROFILE_COMPLETION_FIELDS = ['profileImage', 'bio', 'city', 'location'] as const;

export const trustProfileUserIdParamsSchema = z.object({
  userId: z.string().min(1),
});

export const adminTrustProfileListQuerySchema = z.object({
  isSuspicious: z.coerce.boolean().optional(),
  isVerified: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const adminTrustProfileNoteSchema = z.object({
  note: z.string().trim().min(1, 'A note cannot be empty.').max(1000),
});
