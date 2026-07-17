import {DisputeReason, VideoModerationStatus, VideoRejectionReason} from '@prisma/client';

import {requestRepository} from '../repositories/requestRepository';
import {requestVideoRepository} from '../repositories/requestVideoRepository';
import {adminAuditLogService} from './adminAuditLogService';
import {disputeService} from './disputeService';
import {escrowService} from './escrowService';
import {publishFromDraft} from './requestService';
import {assertTransition} from './requestStateMachine';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {HttpError} from '../utils/httpError';
import {presentModerationQueueItem, presentModerationVideoDetail} from '../utils/moderationPresenter';
import {presentRequest} from '../utils/requestPresenter';
import {presentRequestVideo} from '../utils/requestVideoPresenter';
import {VIDEO_REJECTION_REASON_LABELS} from '../validations/moderationValidation';

type PendingRequestWithRequester = NonNullable<Awaited<ReturnType<typeof requestRepository.findByIdWithRequester>>>;

function presentPendingRequest(request: PendingRequestWithRequester) {
  return {
    ...presentRequest(request),
    requester: request.requester,
  };
}

async function loadPendingRequest(requestId: string): Promise<PendingRequestWithRequester> {
  const request = await requestRepository.findByIdWithRequester(requestId);
  if (!request) {
    throw new HttpError(404, 'Request not found.');
  }
  if (request.status !== 'PENDING_MODERATION') {
    throw new HttpError(409, 'This request is not currently awaiting pre-publish moderation.');
  }
  return request;
}

async function loadModeratableVideo(videoId: string) {
  const video = await requestVideoRepository.findByIdWithModerationContext(videoId);
  if (!video) {
    throw new HttpError(404, 'Video not found.');
  }
  if (video.status !== 'UPLOADED') {
    throw new HttpError(409, 'Only a fully uploaded video can be moderated.');
  }
  if (video.moderationStatus !== 'PENDING') {
    throw new HttpError(409, 'This video has already been moderated.');
  }
  if (video.request.status !== 'MODERATOR_REVIEW') {
    throw new HttpError(409, 'This request is not currently awaiting moderation.');
  }
  return video;
}

/** Manual Moderation Workflow — Admin/Moderator sub-module (PRD §5.9, §4.5, §5.14.7, backend Phase 6). */
export const moderationService = {
  async getQueue(
    adminId: string,
    filters: {status: VideoModerationStatus; requestId?: string; creatorId?: string; search?: string},
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const [items, total] = await requestVideoRepository.findManyForModeration({
      statuses: [filters.status],
      requestId: filters.requestId,
      creatorId: filters.creatorId,
      search: filters.search,
      skip,
      take: limit,
    });

    return {
      items: items.map(presentModerationQueueItem),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async getHistory(
    filters: {
      status?: 'APPROVED' | 'REJECTED';
      moderatedByAdminId?: string;
      requestId?: string;
      creatorId?: string;
      search?: string;
      dateFrom?: Date;
      dateTo?: Date;
    },
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const [items, total] = await requestVideoRepository.findManyForModeration({
      statuses: filters.status ? [filters.status] : ['APPROVED', 'REJECTED'],
      requestId: filters.requestId,
      creatorId: filters.creatorId,
      moderatedByAdminId: filters.moderatedByAdminId,
      search: filters.search,
      moderatedFrom: filters.dateFrom,
      moderatedTo: filters.dateTo,
      skip,
      take: limit,
    });

    return {
      items: items.map(presentModerationQueueItem),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async getVideoDetail(videoId: string) {
    const video = await requestVideoRepository.findByIdWithModerationContext(videoId);
    if (!video) {
      throw new HttpError(404, 'Video not found.');
    }
    return presentModerationVideoDetail(video);
  },

  async getStats() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [pendingQueueDepth, approvedToday, rejectedToday, approvedTotal, rejectedTotal] =
      await requestVideoRepository.getModerationStats(startOfToday);

    return {pendingQueueDepth, approvedToday, rejectedToday, approvedTotal, rejectedTotal};
  },

  /** Approve → `MODERATOR_REVIEW -> REQUESTER_REVIEW` (PRD §5.9 item 2). */
  async approve(adminId: string, videoId: string, remarks: string | undefined) {
    const video = await loadModeratableVideo(videoId);

    assertTransition('MODERATOR_REVIEW', 'REQUESTER_REVIEW');
    const now = new Date();

    const [updatedVideo, updatedRequest] = await Promise.all([
      requestVideoRepository.update(videoId, {
        moderationStatus: 'APPROVED',
        moderationRemarks: remarks ?? null,
        moderatedAt: now,
        moderatedByAdmin: {connect: {id: adminId}},
      }),
      requestRepository.update(video.requestId, {
        status: 'REQUESTER_REVIEW',
        moderatorDecisionAt: now,
        moderatorRejectionReason: null,
      }),
    ]);

    await adminAuditLogService.log(adminId, 'VIDEO_APPROVED', 'RequestVideo', videoId, {requestId: video.requestId});

    await notificationService.notifyUser(
      video.request.requesterId,
      NotificationType.VIDEO_READY,
      'Video Ready for Review',
      'Your requested video passed moderation and is ready for your review.',
      {requestId: video.requestId, screen: 'VideoReview'},
    );
    await notificationService.notifyUser(
      video.creatorId,
      NotificationType.VIDEO_APPROVED,
      'Video Approved ✓',
      'Your submitted video passed moderation review.',
      {requestId: video.requestId, screen: 'CreatorRequestDetail'},
    );

    return {request: presentRequest(updatedRequest), video: presentRequestVideo(updatedVideo)};
  },

  /** Reject (mandatory reason) → `MODERATOR_REVIEW -> RECORDING` (PRD §5.9 item 2 — Creator re-records). */
  async reject(adminId: string, videoId: string, reason: VideoRejectionReason, remarks: string | undefined) {
    const video = await loadModeratableVideo(videoId);

    assertTransition('MODERATOR_REVIEW', 'RECORDING');
    const now = new Date();
    const reasonLabel = VIDEO_REJECTION_REASON_LABELS[reason];

    const [updatedVideo, updatedRequest] = await Promise.all([
      requestVideoRepository.update(videoId, {
        moderationStatus: 'REJECTED',
        moderationRejectionReason: reason,
        moderationRemarks: remarks ?? null,
        moderatedAt: now,
        moderatedByAdmin: {connect: {id: adminId}},
      }),
      requestRepository.update(video.requestId, {
        status: 'RECORDING',
        moderatorDecisionAt: now,
        moderatorRejectionReason: remarks ? `${reasonLabel}: ${remarks}` : reasonLabel,
        uploadedAt: null,
      }),
    ]);

    await adminAuditLogService.log(adminId, 'VIDEO_REJECTED', 'RequestVideo', videoId, {
      requestId: video.requestId,
      reason,
    });

    // "Re-record Requested" (Moderation matrix item) is satisfied by this same notification —
    // it already instructs the Creator to re-record; a separate notification for the identical
    // trigger would be duplicated notification logic, which this milestone explicitly disallows.
    await notificationService.notifyUser(
      video.creatorId,
      NotificationType.VIDEO_REJECTED,
      'Video Rejected',
      `Your video was rejected: ${reasonLabel}. Please re-record.`,
      {requestId: video.requestId, reason, screen: 'CreatorRequestDetail'},
    );

    return {request: presentRequest(updatedRequest), video: presentRequestVideo(updatedVideo)};
  },

  /** Bulk moderation — best-effort per item; one item's failure never blocks the rest. */
  async bulkApprove(adminId: string, videoIds: string[], remarks: string | undefined) {
    const results = await Promise.allSettled(videoIds.map(videoId => this.approve(adminId, videoId, remarks)));
    return results.map((result, i) => ({
      videoId: videoIds[i],
      success: result.status === 'fulfilled',
      error: result.status === 'rejected' ? (result.reason as Error).message : undefined,
    }));
  },

  async bulkReject(
    adminId: string,
    videoIds: string[],
    reason: VideoRejectionReason,
    remarks: string | undefined,
  ) {
    const results = await Promise.allSettled(
      videoIds.map(videoId => this.reject(adminId, videoId, reason, remarks)),
    );
    return results.map((result, i) => ({
      videoId: videoIds[i],
      success: result.status === 'fulfilled',
      error: result.status === 'rejected' ? (result.reason as Error).message : undefined,
    }));
  },

  /**
   * `POST /admin/moderation/videos/:videoId/escalate` (admin frontend Phase 3, backend Phase 5
   * item 6) — Moderator/Admin escalation straight to the Dispute Center, bypassing the normal
   * approve/reject decision when the case needs Admin arbitration instead (e.g. ambiguous
   * content, a dispute between what the Requester described and what was recorded). Delegates
   * the actual dispute-creation mechanics to `disputeService.adminEscalate`.
   */
  async escalate(adminId: string, videoId: string, reason: DisputeReason, description: string) {
    const video = await loadModeratableVideo(videoId);
    return disputeService.adminEscalate(adminId, video.requestId, {reason, description});
  },

  // --- Pre-publish Pending Requests queue (PRD §5.9.2, §5.14.7) ---------------------------
  // Distinct from the video-moderation queue above (different entity — `Request` before it's
  // ever published, not `RequestVideo` after upload), gated by the same `MODERATION_TOGGLE`
  // (wired in `requestService.create`) but otherwise operating independently.

  async getRequestQueue(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      requestRepository.findManyByStatus('PENDING_MODERATION', skip, limit),
      requestRepository.countByStatus('PENDING_MODERATION'),
    ]);

    return {
      items: items.map(presentPendingRequest),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async getRequestDetail(requestId: string) {
    const request = await loadPendingRequest(requestId);
    return presentPendingRequest(request);
  },

  /** Approve → `PENDING_MODERATION -> PUBLISHED` (same publish path as moderation-OFF creation). */
  async approveRequest(adminId: string, requestId: string) {
    const request = await loadPendingRequest(requestId);
    const published = await publishFromDraft(requestId, 'PENDING_MODERATION', request.acceptanceMode);
    await adminAuditLogService.log(adminId, 'REQUEST_APPROVED', 'Request', requestId, {});
    return published;
  },

  /** Reject (mandatory reason) → `PENDING_MODERATION -> REJECTED`, full refund (never published, no Creator involved yet). */
  async rejectRequest(adminId: string, requestId: string, reason: string) {
    const request = await loadPendingRequest(requestId);

    assertTransition('PENDING_MODERATION', 'REJECTED');
    const now = new Date();
    const updated = await requestRepository.update(requestId, {
      status: 'REJECTED',
      moderatorDecisionAt: now,
      prePublishRejectionReason: reason,
    });
    await escrowService.refund(requestId);

    await adminAuditLogService.log(adminId, 'REQUEST_REJECTED', 'Request', requestId, {reason});

    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.REQUEST_REJECTED,
      'Request Rejected',
      `Your request was rejected during review: ${reason}. Your balance has been refunded.`,
      {requestId, screen: 'RequestDetail'},
    );

    return presentRequest(updated);
  },
};
