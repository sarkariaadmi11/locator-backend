import {z} from 'zod';

// Manual Moderation Workflow (PRD §5.9, §4.5, §5.14.7, backend Phase 6).

export const VIDEO_REJECTION_REASONS = [
  'CONTENT_VIOLATION',
  'PROHIBITED_LOCATION',
  'GPS_MISMATCH',
  'DURATION_MISMATCH',
  'FAKE_RECORDING',
  'OTHER',
] as const;

export const VIDEO_REJECTION_REASON_LABELS: Record<(typeof VIDEO_REJECTION_REASONS)[number], string> = {
  CONTENT_VIOLATION: 'Content violation',
  PROHIBITED_LOCATION: 'Prohibited location',
  GPS_MISMATCH: 'GPS mismatch',
  DURATION_MISMATCH: 'Duration mismatch',
  FAKE_RECORDING: 'Fake recording',
  OTHER: 'Other',
};

export const moderationVideoIdParamsSchema = z.object({
  videoId: z.string().min(1),
});

const moderationRemarksSchema = z.string().trim().max(500, 'Remarks must be at most 500 characters.').optional();

export const approveVideoSchema = z.object({
  remarks: moderationRemarksSchema,
});

export const rejectVideoSchema = z.object({
  reason: z.enum(VIDEO_REJECTION_REASONS),
  remarks: moderationRemarksSchema,
});

export const moderationQueueQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
  requestId: z.string().min(1).optional(),
  creatorId: z.string().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const moderationHistoryQuerySchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']).optional(),
  moderatedByAdminId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  creatorId: z.string().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const bulkVideoIdsSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1, 'At least one video must be selected.').max(50),
});

export const bulkRejectVideosSchema = bulkVideoIdsSchema.extend({
  reason: z.enum(VIDEO_REJECTION_REASONS),
  remarks: moderationRemarksSchema,
});

export const auditLogQuerySchema = z.object({
  actorId: z.string().min(1).optional(),
  targetEntityType: z.string().min(1).optional(),
  targetEntityId: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
