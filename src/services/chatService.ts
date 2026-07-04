import {ChatMessage, Request} from '@prisma/client';

import {chatRepository} from '../repositories/chatRepository';
import {requestRepository} from '../repositories/requestRepository';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {CHAT_BLOCKED_MESSAGE, checkChatContent} from '../utils/chatContentFilter';
import {HttpError} from '../utils/httpError';

/** 3 blocked attempts in one request's chat -> flag for Moderator review (PRD §5.4). */
const CHAT_MODERATION_FLAG_THRESHOLD = 3;

function assertParticipant(request: Request, userId: string): void {
  if (request.requesterId !== userId && request.creatorId !== userId) {
    throw new HttpError(403, 'You are not a participant in this request.');
  }
}

function presentChatMessage(message: ChatMessage) {
  return {
    id: message.id,
    requestId: message.requestId,
    senderId: message.senderId,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

/** Temporary per-request chat (PRD §5.4) — opens on GPS-validated acceptance, closes permanently on Start Recording. */
export const chatService = {
  async list(userId: string, requestId: string) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    assertParticipant(request, userId);

    if (!request.creatorId) {
      // Chat has never opened for this request (still PUBLISHED/DRAFT).
      return [];
    }

    const messages = await chatRepository.findByRequestId(requestId);
    // Blocked messages are logged for moderation but never delivered to the other
    // participant — surfacing them here would defeat the point of blocking them.
    return messages.filter(message => !message.blocked).map(presentChatMessage);
  },

  async send(userId: string, requestId: string, body: string) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    assertParticipant(request, userId);

    if (request.status !== 'TEMPORARY_CHAT') {
      throw new HttpError(409, 'Chat is not open for this request.');
    }

    const {blocked, reason} = checkChatContent(body);

    const message = await chatRepository.create({
      request: {connect: {id: requestId}},
      sender: {connect: {id: userId}},
      body,
      blocked,
      blockReason: reason,
    });

    if (blocked) {
      if (!request.chatFlaggedForReview) {
        const blockedCount = await chatRepository.countBlocked(requestId);
        if (blockedCount >= CHAT_MODERATION_FLAG_THRESHOLD) {
          await requestRepository.update(requestId, {chatFlaggedForReview: true});
        }
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
        {requestId, screen: 'Chat'},
      );
    }

    return presentChatMessage(message);
  },
};
