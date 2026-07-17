import {z} from 'zod';

// Dispute Center (PRD §5.14.2, §5.14.3, §5.14.6, §5.14.8, §5.14.10, §4.9, backend Phase 11).

export const DISPUTE_REASONS = [
  'VIDEO_QUALITY_ISSUE',
  'LOCATION_MISMATCH',
  'LATE_DELIVERY',
  'PAYMENT_ISSUE',
  'INAPPROPRIATE_CONTENT',
  'NO_SHOW',
  'OTHER',
] as const;

export const DISPUTE_REASON_LABELS: Record<(typeof DISPUTE_REASONS)[number], string> = {
  VIDEO_QUALITY_ISSUE: 'Video quality issue',
  LOCATION_MISMATCH: 'Location mismatch',
  LATE_DELIVERY: 'Late delivery',
  PAYMENT_ISSUE: 'Payment issue',
  INAPPROPRIATE_CONTENT: 'Inappropriate content',
  NO_SHOW: 'No show',
  OTHER: 'Other',
};

// Request statuses a dispute may legally be raised from (backend Phase 11 explicit business
// rule) — REJECTED (escrow already REFUNDED), REQUESTER_REVIEW/ACCEPTED/PAYMENT_RELEASED (escrow
// still RESERVED, or momentarily mid-chain), COMPLETED (escrow already RELEASED). See
// requestStateMachine's DISPUTED edges and disputeService's delta-based settlement math.
export const DISPUTE_ALLOWED_SOURCE_STATUSES = [
  'REQUESTER_REVIEW',
  'ACCEPTED',
  'PAYMENT_RELEASED',
  'COMPLETED',
  'REJECTED',
  // Admin/Moderator "Escalate to Dispute Center" only (admin frontend Phase 3, backend Phase 5
  // item 6) — never reachable from a participant's own `POST /disputes`, since a normal
  // Requester/Creator has no dispute-raising action while a video is still under moderation.
  'MODERATOR_REVIEW',
] as const;

export const adminEscalateDisputeSchema = z.object({
  reason: z.enum(DISPUTE_REASONS).default('OTHER'),
  description: z.string().trim().min(10, 'Please describe the issue in at least 10 characters.').max(1000),
});

export const createDisputeSchema = z.object({
  requestId: z.string().min(1),
  reason: z.enum(DISPUTE_REASONS),
  description: z.string().trim().min(10, 'Please describe the issue in at least 10 characters.').max(1000),
});

export const disputeIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const disputeListQuerySchema = z.object({
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED', 'REOPENED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const adminDisputeListQuerySchema = z.object({
  status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED', 'REOPENED']).optional(),
  reason: z.enum(DISPUTE_REASONS).optional(),
  caseOwnerAdminId: z.string().min(1).optional(),
  raisedById: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const disputeMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty.').max(2000),
});

export const adminDisputeMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty.').max(2000),
  isInternalNote: z.boolean().optional().default(false),
});

export const disputeEvidenceCaptionSchema = z.object({
  caption: z.string().trim().max(300).optional(),
});

export const adminDisputeResolveSchema = z
  .object({
    resolution: z.enum(['REQUESTER_FAVOUR', 'CREATOR_FAVOUR', 'PARTIAL']),
    // Requester's share of amountLocked when PARTIAL (1-99) — the remainder goes to the Creator,
    // net of platform commission, mirroring escrowService's normal release math.
    splitPercentage: z.coerce.number().min(1).max(99).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine(data => data.resolution !== 'PARTIAL' || data.splitPercentage !== undefined, {
    message: 'splitPercentage is required when resolution is PARTIAL.',
    path: ['splitPercentage'],
  });

export const adminDisputeCloseSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});

export const adminDisputeReopenSchema = z.object({
  reason: z.string().trim().min(5, 'A reason is required to reopen a dispute.').max(500),
});

export const adminDisputeAssignSchema = z.object({
  adminId: z.string().min(1).optional(),
});

export const adminDisputeNoteSchema = z.object({
  note: z.string().trim().min(1, 'A note cannot be empty.').max(1000),
});
