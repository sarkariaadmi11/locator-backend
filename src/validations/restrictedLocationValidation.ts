import {z} from 'zod';

export const createRestrictedLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().positive().max(50000),
  category: z.enum(['RESTRICTED', 'PROHIBITED']),
  label: z.string().min(1).max(120).optional(),
});

export const updateRestrictedLocationSchema = createRestrictedLocationSchema.partial();

export const restrictedLocationIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const restrictedLocationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const classifyLocationQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
