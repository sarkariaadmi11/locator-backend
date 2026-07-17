import {Request} from '@prisma/client';

import {adminAlertRepository} from '../repositories/adminAlertRepository';
import {postSubmissionChatRepository} from '../repositories/postSubmissionChatRepository';
import {requestRepository} from '../repositories/requestRepository';
import {CHAT_BLOCKED_MESSAGE, checkChatContent} from '../utils/chatContentFilter';
import {HttpError} from '../utils/httpError';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {settingsService} from './settingsService';

/** 3+ blocked attempts in one session -> flag for Moderator review, mirroring chatService/queryService. */
const MODERATION_FLAG_THRESHOLD = 3;

function assertParticipant(request: Request, userId: string): void {
  if (request.requesterId !== userId && request.creatorId !== userId) {
    throw new HttpError(403, 'You are not a participant in this request.');
  }
}

function presentMessage(message: {id: string; senderId: string; body: string; createdAt: Date}) {
  return {id: message.id, senderId: message.senderId, body: message.body, createdAt: message.createdAt.toISOString()};
}

/**
 * Post-Submission Chat (PRD_TRD_SUMMARY.md §4.10, §5.6/§10 item 6, backend Phase 4/5). Only
 * reachable when the Moderation Toggle is OFF — an informal chat on the video-review screen,
 * open while a video sits in REQUESTER_REVIEW. Distinct from Pre-Acceptance Query (`queryService`,
 * pre-acceptance, capped at 3 exchanges) and the retired `TEMPORARY_CHAT` (post-acceptance,
 * pre-recording). Chatting here does **not** itself trigger a re-shoot — the Requester must
 * explicitly use the Request Re-shoot action (`requesterReviewService.requestReshoot`).
 */
export const postSubmissionChatService = {
  async list(userId: string, requestId: string) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    assertParticipant(request, userId);

    const messages = await postSubmissionChatRepository.findByRequestId(requestId);
    return messages.filter(m => !m.blockedAttempt).map(presentMessage);
  },

  /**
   * Admin/Moderator read of the post-submission chat log (PRD §5.9.2/§5.14.6 "post-submission
   * chat log viewer") — bypasses the participant check `list` above enforces. Includes blocked
   * attempts too (unlike the participant-facing `list`), since seeing what was blocked is the
   * point of an admin/moderation view.
   */
  async adminList(requestId: string) {
    const messages = await postSubmissionChatRepository.findByRequestId(requestId);
    return messages.map(m => ({...presentMessage(m), blocked: m.blockedAttempt}));
  },

  async send(userId: string, requestId: string, body: string) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    assertParticipant(request, userId);

    const moderationEnabled = await settingsService.isModerationEnabled();
    if (moderationEnabled) {
      throw new HttpError(409, 'Post-submission chat is only available when moderation is disabled.');
    }
    if (request.status !== 'REQUESTER_REVIEW') {
      throw new HttpError(409, 'Post-submission chat is only open while this video is under Requester review.');
    }

    const {blocked, reason} = checkChatContent(body);
    const message = await postSubmissionChatRepository.create({
      request: {connect: {id: requestId}},
      sender: {connect: {id: userId}},
      body,
      blockedAttempt: blocked,
    });

    if (blocked) {
      const blockedCount = await postSubmissionChatRepository.countBlocked(requestId);
      if (blockedCount >= MODERATION_FLAG_THRESHOLD && !request.chatFlaggedForReview) {
        await requestRepository.update(requestId, {chatFlaggedForReview: true});
        // Live Monitoring alert feed (PRD §5.14.2 "blocked message attempts") — see
        // `queryService.ask`'s identical addition for the aggregate-vs-individual split.
        await adminAlertRepository.create({
          type: 'BLOCKED_MESSAGE_THRESHOLD',
          message: `Post-submission chat on request ${requestId} hit ${blockedCount} blocked message attempts and was flagged for review.`,
          metadata: {blockedCount},
          requestId,
        });
      }
      throw new HttpError(422, CHAT_BLOCKED_MESSAGE, {blockReason: reason});
    }

    const otherParticipantId = request.requesterId === userId ? request.creatorId : request.requesterId;
    if (otherParticipantId) {
      await notificationService.notifyUser(
        otherParticipantId,
        NotificationType.NEW_MESSAGE,
        'New message',
        body.length > 80 ? `${body.slice(0, 80)}…` : body,
        {requestId, screen: 'VideoReview'},
      );
    }

    return presentMessage(message);
  },
};
