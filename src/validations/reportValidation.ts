import {z} from 'zod';

// Report/Abuse workflow (PRD §5.12, backend Phase 9).

export const REPORT_CATEGORIES = [
  'PRIVACY_ISSUE',
  'WRONG_LOCATION',
  'ABUSE',
  'FAKE_RECORDING',
  'COPYRIGHT',
  'OTHER',
] as const;

export const REPORT_CATEGORY_LABELS: Record<(typeof REPORT_CATEGORIES)[number], string> = {
  PRIVACY_ISSUE: 'Privacy issue',
  WRONG_LOCATION: 'Wrong location',
  ABUSE: 'Abuse',
  FAKE_RECORDING: 'Fake recording',
  COPYRIGHT: 'Copyright',
  OTHER: 'Other',
};

// 3 reports within 30 days -> suspend-recommendation hook (this milestone's explicit ask is a
// "hook", not a hard auto-suspend action taken without Admin awareness — see reportService).
// [PRD REVIEW-adjacent — the PRD gives "3 reports/30 days" as the trigger itself, not tagged
// [REVIEW]; the *action* taken (flag existing isSuspicious for Admin review, not a hard block)
// is this milestone's own interim decision, consistent with docs/CLAUDE.md §8 rule 11.]
export const REPORT_AUTO_SUSPEND_THRESHOLD = 3;
export const REPORT_AUTO_SUSPEND_WINDOW_DAYS = 30;

export const createReportSchema = z.object({
  reportedUserId: z.string().min(1),
  requestId: z.string().min(1),
  category: z.enum(REPORT_CATEGORIES),
  description: z.string().trim().min(10, 'Please describe the issue in at least 10 characters.').max(1000),
  evidence: z.array(z.string().trim().min(1)).max(10).optional(),
});

export const reportIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const adminReportListQuerySchema = z.object({
  status: z.enum(['PENDING', 'RESOLVED', 'DISMISSED']).optional(),
  category: z.enum(REPORT_CATEGORIES).optional(),
  reportedUserId: z.string().min(1).optional(),
  reporterId: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const adminReportActionSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});
