import {z} from 'zod';

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(1).max(50000).default(1500),
  category: z.string().min(1).optional(),
  pageToken: z.string().min(1).optional(),
});

export const searchQuerySchema = z.object({
  query: z.string().min(1),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  pageToken: z.string().min(1).optional(),
});

export const placeDetailsParamsSchema = z.object({
  id: z.string().min(1),
});

export const reverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const addFavoriteBodySchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  category: z.string().min(1).optional(),
  label: z.string().min(1).max(60).optional(),
});

export const favoriteIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const favoritesQuerySchema = historyQuerySchema;
