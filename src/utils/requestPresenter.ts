import {Request} from '@prisma/client';

export const presentRequest = (request: Request, distanceMeters?: number) => ({
  id: request.id,
  requesterId: request.requesterId,
  creatorId: request.creatorId,
  type: request.type,
  scheduledAt: request.scheduledAt?.toISOString() ?? null,
  location: {
    latitude: request.latitude,
    longitude: request.longitude,
    formattedAddress: request.formattedAddress,
    category: request.locationCategory,
    radiusMeters: request.radiusMeters,
  },
  description: request.description,
  durationMinutes: request.durationMinutes,
  rewardAmount: Number(request.rewardAmount),
  // v2.1 (backend Phase 2/9, PRD_TRD_SUMMARY.md §4.5) — the client needs this to know whether
  // `rewardAmount` (and tipping, etc.) is denominated in Credits or INR; was never exposed here
  // before despite existing on the Request model since Phase 1.
  currencyMode: request.currencyMode,
  acceptanceMode: request.acceptanceMode,
  // Highest Rated matching window (backend Phase 4 item 4) — null once the window closes either
  // way (winner assigned, or fallback to FIRST_ACCEPTED).
  matchingWindowClosesAt: request.matchingWindowClosesAt?.toISOString() ?? null,
  category: request.category,
  instructions: request.instructions,
  status: request.status,
  highValueReviewRequired: request.highValueReviewRequired,
  reshootUsed: request.reshootUsed,
  reshootCount: request.reshootCount,
  requesterDeclarationAt: request.requesterDeclarationAt.toISOString(),
  acceptedAt: request.acceptedAt?.toISOString() ?? null,
  acceptanceTimerExpiresAt: request.acceptanceTimerExpiresAt?.toISOString() ?? null,
  recordingStartedAt: request.recordingStartedAt?.toISOString() ?? null,
  uploadedAt: request.uploadedAt?.toISOString() ?? null,
  moderatorDecisionAt: request.moderatorDecisionAt?.toISOString() ?? null,
  moderatorRejectionReason: request.moderatorRejectionReason,
  requesterDecisionAt: request.requesterDecisionAt?.toISOString() ?? null,
  requesterReviewRemarks: request.requesterReviewRemarks,
  requesterRejectionReason: request.requesterRejectionReason,
  reshootReason: request.reshootReason,
  cancelledAt: request.cancelledAt?.toISOString() ?? null,
  cancellationReason: request.cancellationReason,
  expiresAt: request.expiresAt.toISOString(),
  createdAt: request.createdAt.toISOString(),
  updatedAt: request.updatedAt.toISOString(),
  ...(distanceMeters !== undefined ? {distanceMeters: Math.round(distanceMeters)} : {}),
});
