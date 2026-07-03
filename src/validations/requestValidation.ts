import {z} from 'zod';

// Field ranges per docs/CLAUDE.md §2 / §4 (traceable to PRD §5.3.1's field table).
// Duration is an enum of discrete minute values, not a free integer range (PRD §5.3.1).
export const REQUEST_DURATION_MINUTES = [1, 2, 5, 10, 15] as const;
export const REQUEST_MIN_REWARD = 10;
export const REQUEST_MAX_REWARD = 2000;
export const REQUEST_HIGH_VALUE_THRESHOLD = 1000;
export const REQUEST_DEFAULT_RADIUS_METERS = 500;
export const REQUEST_MIN_RADIUS_METERS = 100;
export const REQUEST_MAX_RADIUS_METERS = 2000;
export const REQUEST_EXPIRY_HOURS = 24;

export const createRequestSchema = z
  .object({
    type: z.enum(['IMMEDIATE', 'SCHEDULED']).default('IMMEDIATE'),
    scheduledAt: z.coerce.date().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMeters: z.coerce
      .number()
      .int()
      .min(REQUEST_MIN_RADIUS_METERS)
      .max(REQUEST_MAX_RADIUS_METERS)
      .default(REQUEST_DEFAULT_RADIUS_METERS),
    description: z.string().trim().min(10, 'Description must be at least 10 characters.').max(300, 'Description must be at most 300 characters.'),
    durationMinutes: z.coerce.number().refine(
      value => (REQUEST_DURATION_MINUTES as readonly number[]).includes(value),
      {message: `Duration must be one of: ${REQUEST_DURATION_MINUTES.join(', ')} minutes.`},
    ),
    rewardAmount: z.coerce
      .number()
      .min(REQUEST_MIN_REWARD, `Reward must be at least ₹${REQUEST_MIN_REWARD}.`)
      .max(REQUEST_MAX_REWARD, `Reward must be at most ₹${REQUEST_MAX_REWARD}.`),
    category: z.enum(['TRAFFIC', 'EVENTS', 'FOOD_DINING', 'PUBLIC_SPACE', 'OTHER']),
    instructions: z.string().trim().max(500, 'Instructions must be at most 500 characters.').optional(),
    requesterDeclaration: z.literal(true, {
      message: 'You must confirm the requester declaration before submitting.',
    }),
  })
  .refine(data => data.type !== 'SCHEDULED' || data.scheduledAt !== undefined, {
    message: 'scheduledAt is required for a SCHEDULED request.',
    path: ['scheduledAt'],
  })
  .refine(data => data.type !== 'SCHEDULED' || (data.scheduledAt as Date) > new Date(), {
    message: 'scheduledAt must be in the future.',
    path: ['scheduledAt'],
  });

export const requestIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const requestListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum([
      'DRAFT',
      'PUBLISHED',
      'CREATOR_ASSIGNED',
      'TEMPORARY_CHAT',
      'RECORDING',
      'UPLOAD',
      'MODERATOR_REVIEW',
      'REQUESTER_REVIEW',
      'RESHOOT_REQUESTED',
      'ACCEPTED',
      'PAYMENT_RELEASED',
      'COMPLETED',
      'REJECTED',
      'DISPUTED',
      'EXPIRED',
      'CANCELLED',
    ])
    .optional(),
});

export const updateRequestSchema = z.object({
  description: z.string().trim().min(10).max(300).optional(),
  durationMinutes: z.coerce
    .number()
    .refine(value => (REQUEST_DURATION_MINUTES as readonly number[]).includes(value), {
      message: `Duration must be one of: ${REQUEST_DURATION_MINUTES.join(', ')} minutes.`,
    })
    .optional(),
  rewardAmount: z.coerce.number().min(REQUEST_MIN_REWARD).max(REQUEST_MAX_REWARD).optional(),
  category: z.enum(['TRAFFIC', 'EVENTS', 'FOOD_DINING', 'PUBLIC_SPACE', 'OTHER']).optional(),
  instructions: z.string().trim().max(500).optional(),
});

export const cancelRequestSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

// --- Discovery (Creator side, PRD §5.5, §5.11) ------------------------------------------

const discoveryFiltersShape = {
  category: z.enum(['TRAFFIC', 'EVENTS', 'FOOD_DINING', 'PUBLIC_SPACE', 'OTHER']).optional(),
  minReward: z.coerce.number().min(REQUEST_MIN_REWARD).optional(),
  maxReward: z.coerce.number().max(REQUEST_MAX_REWARD).optional(),
  type: z.enum(['IMMEDIATE', 'SCHEDULED']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
};

export const nearbyRequestsQuerySchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce
      .number()
      .int()
      .min(REQUEST_MIN_RADIUS_METERS)
      .max(REQUEST_MAX_RADIUS_METERS)
      .default(REQUEST_DEFAULT_RADIUS_METERS),
    ...discoveryFiltersShape,
  })
  .refine(data => data.minReward === undefined || data.maxReward === undefined || data.minReward <= data.maxReward, {
    message: 'minReward must be less than or equal to maxReward.',
    path: ['minReward'],
  });

export const availableRequestsQuerySchema = z
  .object(discoveryFiltersShape)
  .refine(data => data.minReward === undefined || data.maxReward === undefined || data.minReward <= data.maxReward, {
    message: 'minReward must be less than or equal to maxReward.',
    path: ['minReward'],
  });

export const requestDetailsQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

// --- Fulfilment (accept, PRD §5.5) -------------------------------------------------------

// Creator's current position at accept-time — required for the server-side GPS proximity
// gate; distinct from (and fresher than) whatever was last synced via PATCH /creator/location.
export const acceptRequestSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
