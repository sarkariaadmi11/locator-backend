import {RequestVideo} from '@prisma/client';

/**
 * Participant-facing (Requester/Creator) view — `hideAssetUrls` is set by
 * `recordingService.getVideo` when the caller is the Requester and moderation hasn't approved
 * the video yet (PRD Phase 6 mobile requirement: Requester "cannot view before approval").
 */
export const presentRequestVideo = (video: RequestVideo, hideAssetUrls = false) => ({
  id: video.id,
  requestId: video.requestId,
  creatorId: video.creatorId,
  status: video.status,
  secureUrl: hideAssetUrls ? null : video.secureUrl,
  thumbnailUrl: hideAssetUrls ? null : video.thumbnailUrl,
  durationSeconds: video.durationSeconds,
  width: video.width,
  height: video.height,
  fileSizeBytes: video.fileSizeBytes,
  mimeType: video.mimeType,
  gpsLatitude: video.gpsLatitude,
  gpsLongitude: video.gpsLongitude,
  recordedAt: video.recordedAt?.toISOString() ?? null,
  uploadAttempts: video.uploadAttempts,
  failureReason: video.failureReason,
  moderationStatus: video.moderationStatus,
  moderationRejectionReason: video.moderationRejectionReason,
  moderationRemarks: video.moderationRemarks,
  moderatedAt: video.moderatedAt?.toISOString() ?? null,
  createdAt: video.createdAt.toISOString(),
  updatedAt: video.updatedAt.toISOString(),
});
