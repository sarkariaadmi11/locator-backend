import {z} from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  bio: z.string().trim().max(180).optional().or(z.literal('')),
});
