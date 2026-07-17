import {z} from 'zod';

// Tipping (PRD §5.15, backend Phase 2/6). The authoritative min/max (default 10-500, PRD §7.3)
// are Admin-configurable via `settingsService` — checked in `tipService.tip`, not here, since
// zod validation runs synchronously before any DB/settings read is possible. This schema only
// rejects structurally invalid input (non-positive, absurdly large, non-integer).
export const tipRequestSchema = z.object({
  amount: z.number().int().positive().max(1_000_000, 'Tip amount is too large.'),
});
