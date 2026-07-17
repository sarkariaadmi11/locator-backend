import {Request, RequestVideo, User} from '@prisma/client';

import {buildGpsCheck} from './geo';
import {presentRequest} from './requestPresenter';
import {presentRequestVideo} from './requestVideoPresenter';

type VideoWithModerationContext = RequestVideo & {
  request: Request;
  creator: Pick<User, 'id' | 'name' | 'username' | 'email' | 'profileImage'>;
};

const presentCreatorSummary = (creator: VideoWithModerationContext['creator']) => ({
  id: creator.id,
  name: creator.name,
  username: creator.username,
  email: creator.email,
  profileImage: creator.profileImage,
});

/** Queue/history list row — one row per video, with just enough request/creator context to triage. */
export const presentModerationQueueItem = (video: VideoWithModerationContext) => ({
  ...presentRequestVideo(video),
  moderatedByAdminId: video.moderatedByAdminId,
  creator: presentCreatorSummary(video.creator),
  request: {
    id: video.request.id,
    description: video.request.description,
    category: video.request.category,
    durationMinutes: video.request.durationMinutes,
    rewardAmount: Number(video.request.rewardAmount),
    status: video.request.status,
    requesterId: video.request.requesterId,
    location: {
      latitude: video.request.latitude,
      longitude: video.request.longitude,
      formattedAddress: video.request.formattedAddress,
      radiusMeters: video.request.radiusMeters,
    },
  },
});

/** Full video-review detail — video player data, GPS map comparison, timestamp check (PRD §5.9). */
export const presentModerationVideoDetail = (video: VideoWithModerationContext) => {
  const {request} = video;

  return {
    ...presentModerationQueueItem(video),
    request: presentRequest(request),
    gpsCheck: buildGpsCheck(request, video),
    timestampCheck: {
      recordedAt: video.recordedAt?.toISOString() ?? null,
      requestAcceptedAt: request.acceptedAt?.toISOString() ?? null,
      requestExpiresAt: request.expiresAt.toISOString(),
    },
  };
};
