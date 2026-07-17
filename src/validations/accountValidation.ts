import {z} from 'zod';

export const complianceConfigKeyParamsSchema = z.object({
  key: z.string().min(1),
});

export const complianceConfigUpdateSchema = z.object({
  value: z.string().min(1).max(200),
});

export const deletionLogQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  action: z
    .enum([
      'ACCOUNT_DELETION_REQUESTED',
      'ACCOUNT_DELETION_CANCELLED',
      'ACCOUNT_HARD_DELETED',
      'CHAT_MESSAGES_PURGED',
      'VIDEO_ASSET_PURGED',
      'NOTIFICATIONS_PURGED',
      'INACTIVE_ACCOUNT_CLEANED',
      'EXPIRED_DRAFT_CLEANED',
    ])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const dataExportListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const dataExportIdParamsSchema = z.object({
  id: z.string().min(1),
});
