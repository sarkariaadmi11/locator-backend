import {z} from 'zod';

// User Management mandatory-reason capture on Block/Unblock and Mark Suspicious (PRD §5.14.4,
// admin frontend Phase 6) — every audit-logged toggle action requires an operator-supplied reason.
export const adminUserActionReasonSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

// Manual Credit/Connect adjustment (PRD §5.14.4, admin frontend Phase 6) — mandatory reason,
// audit-logged. `amount` may be negative (debit) or positive (credit); zero is rejected
// service-side, not here, so the error message stays consistent with the rest of that check.
export const adminWalletAdjustmentSchema = z.object({
  type: z.enum(['CREDITS', 'CONNECTS']),
  bucket: z.enum(['bonus', 'purchased', 'earned']).optional(),
  amount: z.coerce.number().int(),
  reason: z.string().trim().min(3).max(500),
});

// Time-boxed Suspend User (PRD §5.9.2 "Suspend User button (reason + duration)") — distinct from
// the plain indefinite block toggle above; durationHours is capped at 30 days (720h) as a sanity
// bound, not a PRD-specified maximum.
export const adminSuspendUserSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  durationHours: z.coerce.number().positive().max(720),
});
