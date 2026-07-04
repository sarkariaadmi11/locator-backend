import {z} from 'zod';

// Platform commission (PRD §5.2, §7.1) [REVIEW — this is the only number the PRD gives].
// Superseded 2026-07-04 (backend Phase 11, Commission Settings) by the Admin-configurable
// `ComplianceConfig` key `COMMISSION_RATE_PERCENT` (see `complianceConfigService`) —
// `escrowService.reserve` reads that DB-backed value, not a hardcoded constant, and snapshots
// it onto each `RequestEscrow` row at reservation time so a later Admin change never
// retroactively alters an already-reserved escrow's split.

export const escrowRequestIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const adminEscrowListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  state: z.enum(['RESERVED', 'RELEASED', 'REFUNDED', 'FROZEN', 'SPLIT']).optional(),
  requestId: z.string().min(1).optional(),
});

export const adminEscrowOverrideSchema = z.object({
  reason: z.string().trim().min(5, 'A reason is required for a manual override.').max(300),
});
