import {z} from 'zod';

// Mutual Ratings (PRD §5.12, §4.6 "Rate your experience", backend Phase 9).

export const rateRequestSchema = z.object({
  stars: z.number().int().min(1, 'Rating must be between 1 and 5 stars.').max(5, 'Rating must be between 1 and 5 stars.'),
  comment: z.string().trim().max(500, 'Comment must be at most 500 characters.').optional(),
});
