import {Rating} from '@prisma/client';

export const presentRating = (rating: Rating) => ({
  id: rating.id,
  requestId: rating.requestId,
  raterId: rating.raterId,
  rateeId: rating.rateeId,
  role: rating.role,
  stars: rating.stars,
  reviewText: rating.reviewText,
  createdAt: rating.createdAt.toISOString(),
});

export type RatingSummary = {averageRating: number | null; ratingCount: number};

export const presentRatingSummary = (avgStars: number | null, count: number): RatingSummary => ({
  averageRating: avgStars !== null ? Math.round(avgStars * 100) / 100 : null,
  ratingCount: count,
});
