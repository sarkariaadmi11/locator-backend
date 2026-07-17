import {z} from 'zod';

export const notificationTemplateTypeParamsSchema = z.object({
  type: z.string().min(1),
});

export const upsertNotificationTemplateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  enabled: z.boolean().default(true),
});
