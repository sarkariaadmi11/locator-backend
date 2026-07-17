import {z} from 'zod';

// Pre-Acceptance Query (PRD_TRD_SUMMARY.md §4.6, backend Phase 4) — max 200 chars per message.
export const sendQueryMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty.').max(200, 'Message must be at most 200 characters.'),
});

export const queryThreadParamsSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
});
