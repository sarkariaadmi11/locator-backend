import {requestRepository} from '../repositories/requestRepository';
import {requestVideoRepository} from '../repositories/requestVideoRepository';
import {consentService} from './consentService';
import {gpsSpoofingService} from './gpsSpoofingService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {settingsService} from './settingsService';
import {videoStorageProvider} from './storage';
import {HttpError} from '../utils/httpError';
import {presentRequest} from '../utils/requestPresenter';
import {presentRequestVideo} from '../utils/requestVideoPresenter';
import {logger} from '../config/logger';
import {
  MAX_UPLOAD_ATTEMPTS,
  VIDEO_DURATION_MAX_GRACE_SECONDS,
  VIDEO_DURATION_MIN_TOLERANCE_SECONDS,
} from '../validations/recordingValidation';
import {assertTransition} from './requestStateMachine';

async function loadOwnedRequest(creatorId: string, requestId: string) {
  const request = await requestRepository.findById(requestId);
  if (!request) {
    throw new HttpError(404, 'Request not found.');
  }
  if (request.creatorId !== creatorId) {
    throw new HttpError(403, 'Only the assigned Creator can act on this request\'s recording.');
  }
  return request;
}

async function loadOwnedVideo(creatorId: string, requestId: string, videoId: string) {
  const video = await requestVideoRepository.findById(videoId);
  if (!video || video.requestId !== requestId) {
    throw new HttpError(404, 'Video not found.');
  }
  if (video.creatorId !== creatorId) {
    throw new HttpError(403, 'Only the assigned Creator can act on this video.');
  }
  return video;
}

export const recordingService = {
  /**
   * `POST /requests/:id/recording/start` (PRD §5.6 item 1) — opens Recording. v2.1 (backend
   * Phase 4 item 2): CREATOR_ASSIGNED is now the resting state a Creator starts recording
   * from directly (TEMPORARY_CHAT retired from the accept flow) — TEMPORARY_CHAT is still
   * accepted here too so any pre-existing row from before this change can still proceed.
   */
  async startRecording(creatorId: string, requestId: string) {
    const request = await loadOwnedRequest(creatorId, requestId);

    if (request.status !== 'CREATOR_ASSIGNED' && request.status !== 'TEMPORARY_CHAT') {
      throw new HttpError(409, 'Recording can only start once you have been assigned this request.');
    }

    assertTransition(request.status, 'RECORDING');
    const now = new Date();
    const updated = await requestRepository.update(requestId, {
      status: 'RECORDING',
      recordingStartedAt: now,
      creatorDeclarationAt: now,
    });

    // Immutable consent audit row (PRD §9.1, §5.7.3, backend Phase 13) — additive alongside the
    // `creatorDeclarationAt` timestamp stamped above (Phase 5's interim substitute, unchanged).
    await consentService.recordDeclaration(creatorId, 'CREATOR_DECLARATION', requestId);

    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.CHAT_CLOSED,
      'Chat closed',
      'Your Creator has started recording. Chat is now closed for this request.',
      {requestId, screen: 'RequestDetail'},
    );
    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.RECORDING_STARTED,
      'Recording started',
      'Your Creator has started recording your requested video.',
      {requestId, screen: 'RequestDetail'},
    );

    return presentRequest(updated);
  },

  /** `POST /requests/:id/video/session` — creates a fresh upload draft for this request. */
  async createUploadSession(creatorId: string, requestId: string) {
    const request = await loadOwnedRequest(creatorId, requestId);

    if (request.status !== 'RECORDING') {
      throw new HttpError(409, 'A recording must be started before creating an upload session.');
    }

    // Only a genuinely in-progress draft blocks a new session: still uploading, or uploaded
    // and still awaiting a moderation decision. A FAILED upload, a Moderator-REJECTED video
    // (backend Phase 6 — Creator must re-record), or an already-APPROVED video (backend Phase
    // 7 — Requester requested a re-shoot after moderation passed; the approved row is kept as
    // history, not cancelled) all clear the way for a fresh session.
    const existing = await requestVideoRepository.findActiveByRequestId(requestId);
    const existingBlocksNewSession =
      existing &&
      (existing.status === 'PENDING' ||
        existing.status === 'UPLOADING' ||
        (existing.status === 'UPLOADED' && existing.moderationStatus === 'PENDING'));
    if (existingBlocksNewSession) {
      throw new HttpError(409, 'An upload session for this request is already in progress.');
    }

    const video = await requestVideoRepository.create({
      request: {connect: {id: requestId}},
      creator: {connect: {id: creatorId}},
      status: 'PENDING',
    });

    return presentRequestVideo(video);
  },

  /**
   * `POST /requests/:id/video/:videoId/complete` — the actual multipart upload. Validates
   * duration/size/mime, uploads to Cloudinary via the storage-provider abstraction, then
   * chains `RECORDING -> UPLOAD -> MODERATOR_REVIEW` (Phase 6's queue itself isn't built yet,
   * but the request correctly lands in that state per this phase's exit criteria).
   */
  async completeUpload(
    creatorId: string,
    requestId: string,
    videoId: string,
    file: Express.Multer.File | undefined,
    metadata: {gpsLatitude: number; gpsLongitude: number; recordedAt: Date; durationSeconds: number},
  ) {
    const request = await loadOwnedRequest(creatorId, requestId);
    const video = await loadOwnedVideo(creatorId, requestId, videoId);

    if (request.status !== 'RECORDING') {
      throw new HttpError(409, 'This request is not currently in the recording stage.');
    }
    if (video.status === 'UPLOADED') {
      throw new HttpError(409, 'This video has already been uploaded.');
    }
    if (video.status === 'CANCELLED') {
      throw new HttpError(409, 'This upload session was cancelled. Start a new one.');
    }
    if (video.uploadAttempts >= MAX_UPLOAD_ATTEMPTS) {
      throw new HttpError(409, 'Maximum upload attempts exceeded. This request has been flagged for review.');
    }
    if (!file) {
      throw new HttpError(422, 'A video file is required.');
    }

    const minSeconds = request.durationMinutes * 60 - VIDEO_DURATION_MIN_TOLERANCE_SECONDS;
    const maxSeconds = request.durationMinutes * 60 + VIDEO_DURATION_MAX_GRACE_SECONDS;
    if (metadata.durationSeconds < minSeconds) {
      throw new HttpError(422, 'Stream too short.');
    }
    if (metadata.durationSeconds > maxSeconds) {
      throw new HttpError(422, 'Recording is too long for the selected duration.');
    }

    // GPS spoofing signal (backend Phase 8 item 2) — flag-and-queue only, never blocks upload.
    gpsSpoofingService.checkAndFlag(creatorId, metadata.gpsLatitude, metadata.gpsLongitude, 'recording_upload').catch(() => {});

    await requestVideoRepository.update(videoId, {
      status: 'UPLOADING',
      uploadAttempts: {increment: 1},
      gpsLatitude: metadata.gpsLatitude,
      gpsLongitude: metadata.gpsLongitude,
      recordedAt: metadata.recordedAt,
    });

    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.UPLOAD_STARTED,
      'Upload started',
      'Your Creator is uploading the recorded video.',
      {requestId, screen: 'RequestDetail'},
    );

    let uploadResult;
    try {
      uploadResult = await videoStorageProvider.uploadVideo(file.buffer, {requestId, videoId});
    } catch (err) {
      const attempts = video.uploadAttempts + 1;
      const failureReason = (err as Error).message ?? 'Upload failed.';
      logger.error(`[recordingService.completeUpload] Cloudinary upload failed for video=${videoId}: ${failureReason}`);

      const flagged = attempts >= MAX_UPLOAD_ATTEMPTS;
      await requestVideoRepository.update(videoId, {
        status: 'FAILED',
        failureReason: flagged
          ? `${failureReason} (max attempts reached — flagged for review)`
          : failureReason,
      });

      await notificationService.notifyUser(
        creatorId,
        NotificationType.UPLOAD_FAILED,
        'Upload failed',
        flagged
          ? 'Upload failed after the maximum number of attempts. This request has been flagged for review.'
          : 'Unable to upload the video right now. Please retry.',
        {requestId, videoId, screen: 'CreatorRequestDetail'},
      );

      throw new HttpError(
        502,
        flagged
          ? 'Upload failed after the maximum number of attempts. This request has been flagged for review.'
          : 'Unable to upload the video right now. Please retry.',
      );
    }

    const updatedVideo = await requestVideoRepository.update(videoId, {
      status: 'UPLOADED',
      storagePublicId: uploadResult.publicId,
      secureUrl: uploadResult.secureUrl,
      thumbnailUrl: uploadResult.thumbnailUrl,
      durationSeconds: uploadResult.durationSeconds ?? metadata.durationSeconds,
      width: uploadResult.width,
      height: uploadResult.height,
      fileSizeBytes: uploadResult.fileSizeBytes,
      mimeType: uploadResult.mimeType,
    });

    assertTransition('RECORDING', 'UPLOAD');
    await requestRepository.update(requestId, {status: 'UPLOAD', uploadedAt: new Date()});

    // v2.1 Moderation Toggle (PRD_TRD_SUMMARY.md §3.5/§5.6, backend Phase 5) — ON (default)
    // routes through the moderator queue as before; OFF skips straight to Requester Review.
    // Safety enforcement (reports/suspension/disputes) is never gated by this toggle — it only
    // ever affects this one transition.
    const moderationEnabled = await settingsService.isModerationEnabled();
    const nextStatus = moderationEnabled ? 'MODERATOR_REVIEW' : 'REQUESTER_REVIEW';
    assertTransition('UPLOAD', nextStatus);
    const updatedRequest = await requestRepository.update(requestId, {
      status: nextStatus,
      // Moderation-OFF path has no Moderator decision at all — stamp moderatorDecisionAt here
      // too so the existing review-reminder/auto-accept sweeps (which key off this timestamp,
      // see notificationReminderJob/requesterReviewAutoAcceptJob) still find these requests.
      ...(nextStatus === 'REQUESTER_REVIEW' ? {moderatorDecisionAt: new Date()} : {}),
    });

    await notificationService.notifyUser(
      creatorId,
      NotificationType.UPLOAD_SUCCESSFUL,
      'Upload successful',
      moderationEnabled
        ? 'Your video was uploaded successfully and is now awaiting moderation review.'
        : 'Your video was uploaded successfully and is now awaiting Requester review.',
      {requestId, videoId, screen: 'CreatorRequestDetail'},
    );

    if (!moderationEnabled) {
      await notificationService.notifyUser(
        updatedRequest.requesterId,
        NotificationType.VIDEO_READY,
        'Video Ready for Review',
        'Your requested video is ready for your review.',
        {requestId, screen: 'VideoReview'},
      );
    }

    return {request: presentRequest(updatedRequest), video: presentRequestVideo(updatedVideo)};
  },

  /** `POST /requests/:id/video/:videoId/retry` — resets a FAILED session so the client can re-upload. */
  async retryUpload(creatorId: string, requestId: string, videoId: string) {
    const video = await loadOwnedVideo(creatorId, requestId, videoId);

    if (video.status !== 'FAILED') {
      throw new HttpError(409, 'Only a failed upload can be retried.');
    }
    if (video.uploadAttempts >= MAX_UPLOAD_ATTEMPTS) {
      throw new HttpError(409, 'Maximum upload attempts exceeded. This request has been flagged for review.');
    }

    const updated = await requestVideoRepository.update(videoId, {status: 'PENDING', failureReason: null});
    return presentRequestVideo(updated);
  },

  /** `POST /requests/:id/video/:videoId/cancel` — cancel a not-yet-uploaded draft. */
  async cancelUpload(creatorId: string, requestId: string, videoId: string) {
    const video = await loadOwnedVideo(creatorId, requestId, videoId);

    if (video.status === 'UPLOADED') {
      throw new HttpError(409, 'An uploaded video cannot be cancelled — delete it instead.');
    }

    const updated = await requestVideoRepository.update(videoId, {status: 'CANCELLED'});
    return presentRequestVideo(updated);
  },

  /**
   * `GET /requests/:id/video` — fetch the active/latest video for participants of the request.
   * The Requester cannot see the video asset itself until Moderation approves it (backend
   * Phase 6, mobile requirement "cannot view before approval") — the Creator always sees their
   * own upload regardless of moderation state.
   */
  async getVideo(userId: string, requestId: string) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    if (request.requesterId !== userId && request.creatorId !== userId) {
      throw new HttpError(403, 'You are not a participant in this request.');
    }

    const video = await requestVideoRepository.findActiveByRequestId(requestId);
    if (!video) return null;

    const hideAssetUrls = request.requesterId === userId && video.moderationStatus !== 'APPROVED';
    return presentRequestVideo(video, hideAssetUrls);
  },

  /**
   * `GET /requests/:id/video/history` — every recording attempt for this request (backend
   * Phase 7's "previous recording history" requirement), oldest-first. Same Requester
   * asset-visibility gate as `getVideo` applies per-row (a Requester never sees an
   * unapproved attempt's asset URLs, even a historical one).
   */
  async getVideoHistory(userId: string, requestId: string) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    if (request.requesterId !== userId && request.creatorId !== userId) {
      throw new HttpError(403, 'You are not a participant in this request.');
    }

    const videos = await requestVideoRepository.findAllByRequestId(requestId);
    const isRequester = request.requesterId === userId;
    return videos.map(video =>
      presentRequestVideo(video, isRequester && video.moderationStatus !== 'APPROVED'),
    );
  },

  /**
   * `DELETE /requests/:id/video/:videoId` — delete an uploaded draft, reverting to RECORDING.
   * Known gap (backend Phase 5, not fixed here): on the Moderation-OFF path a request skips
   * straight to REQUESTER_REVIEW, so a Creator cannot withdraw a draft during that window the
   * way they can on the Moderation-ON path (MODERATOR_REVIEW). Narrow edge case, only reachable
   * once an Admin actually disables moderation — flagged rather than silently left unhandled.
   */
  async deleteDraft(creatorId: string, requestId: string, videoId: string) {
    const request = await loadOwnedRequest(creatorId, requestId);
    const video = await loadOwnedVideo(creatorId, requestId, videoId);

    if (video.status !== 'UPLOADED') {
      throw new HttpError(409, 'Only an uploaded video can be deleted as a draft.');
    }
    if (request.status !== 'UPLOAD' && request.status !== 'MODERATOR_REVIEW') {
      throw new HttpError(409, 'This video can no longer be withdrawn.');
    }

    if (video.storagePublicId) {
      await videoStorageProvider.deleteVideo(video.storagePublicId);
    }
    await requestVideoRepository.update(videoId, {status: 'CANCELLED'});

    assertTransition(request.status, 'RECORDING');
    const updated = await requestRepository.update(requestId, {status: 'RECORDING', uploadedAt: null});
    return presentRequest(updated);
  },
};
