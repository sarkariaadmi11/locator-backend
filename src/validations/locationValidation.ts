import {z} from 'zod';

export const saveLocationSchema = z
  .object({
    city: z.string().trim().min(2).max(80).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine(data => data.city || (data.latitude !== undefined && data.longitude !== undefined), {
    message: 'Provide a city or both latitude and longitude.',
  });
