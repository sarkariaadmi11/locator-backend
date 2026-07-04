import {z} from 'zod';

// PRD §5.10 / MASTER_EXECUTION_PLAN.md Phase 7: exactly one free re-shoot per request.
export const MAX_RESHOOT_ATTEMPTS = 1;

export const acceptVideoSchema = z.object({
  remarks: z.string().trim().max(500, 'Remarks must be at most 500 characters.').optional(),
});

export const requestReshootSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'A re-shoot reason is required.')
    .max(300, 'Reason must be at most 300 characters.'),
  remarks: z.string().trim().max(500, 'Remarks must be at most 500 characters.').optional(),
});

export const rejectRequestVideoSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'A rejection reason is required.')
    .max(300, 'Reason must be at most 300 characters.'),
  remarks: z.string().trim().max(500, 'Remarks must be at most 500 characters.').optional(),
});
