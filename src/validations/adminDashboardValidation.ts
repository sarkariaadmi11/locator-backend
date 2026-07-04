import {z} from 'zod';

// Active Request Dashboard (PRD §5.14.3, backend Phase 11) — every non-terminal PRD §5.13
// status is a valid filter; terminal statuses are intentionally omitted since that dashboard is
// scoped to in-flight requests only (use the existing `GET /requests/mine`/admin escrow list for
// settled ones).
export const adminActiveRequestsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum([
      'DRAFT',
      'PUBLISHED',
      'CREATOR_ASSIGNED',
      'TEMPORARY_CHAT',
      'RECORDING',
      'UPLOAD',
      'MODERATOR_REVIEW',
      'REQUESTER_REVIEW',
      'RESHOOT_REQUESTED',
      'ACCEPTED',
      'PAYMENT_RELEASED',
    ])
    .optional(),
});
