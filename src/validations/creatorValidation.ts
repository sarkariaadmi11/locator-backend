import {z} from 'zod';

export const updateCreatorLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const updateCreatorStatusSchema = z.object({
  availabilityStatus: z.enum(['ONLINE', 'OFFLINE', 'BUSY']),
});
