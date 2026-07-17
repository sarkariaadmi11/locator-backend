import {adminAlertRepository} from '../repositories/adminAlertRepository';
import {queryRepository} from '../repositories/queryRepository';
import {requestRepository} from '../repositories/requestRepository';
import {CHAT_BLOCKED_MESSAGE, checkChatContent} from '../utils/chatContentFilter';
import {HttpError} from '../utils/httpError';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';

/** PRD §5.4.0 — "maximum of 3 query–reply exchanges per Creator per request", counted as the Creator's questions only (Requester replies are unlimited). */
const MAX_CREATOR_EXCHANGES = 3;
/** 3+ blocked attempts in one thread -> flag for Moderator review (mirrors chatService's CHAT_MODERATION_FLAG_THRESHOLD, PRD §5.4.2). */
const QUERY_MODERATION_FLAG_THRESHOLD = 3;

function presentMessage(message: {id: string; senderId: string; body: string; blocked: boolean; createdAt: Date}) {
  return {id: message.id, senderId: message.senderId, body: message.body, createdAt: message.createdAt.toISOString()};
}

function presentThread(thread: {
  id: string;
  requestId: string;
  creatorId: string;
  exchangeCount: number;
  status: string;
  messages: Array<{id: string; senderId: string; body: string; blocked: boolean; createdAt: Date}>;
}) {
  return {
    id: thread.id,
    requestId: thread.requestId,
    creatorId: thread.creatorId,
    exchangeCount: thread.exchangeCount,
    status: thread.status,
    // Blocked messages are logged for moderation audit but never surfaced to either
    // participant — mirrors chatService's identical filtering.
    messages: thread.messages.filter(m => !m.blocked).map(presentMessage),
  };
}

async function loadOpenRequestForQuery(requestId: string) {
  const request = await requestRepository.findById(requestId);
  if (!request) {
    throw new HttpError(404, 'Request not found.');
  }
  // Pre-Acceptance Query is reachable while a request is still searching for a Creator
  // (PUBLISHED — v2.1's "published_searching") — once a Creator is assigned, all threads
  // close (see closeAllForRequest, called from requestService.accept).
  if (request.status !== 'PUBLISHED') {
    throw new HttpError(409, 'Pre-acceptance questions can only be asked while this request is searching for a Creator.');
  }
  return request;
}

export const queryService = {
  /** `POST /requests/:id/queries` — Creator asks a question (creates the thread on first ask). */
  async ask(creatorId: string, requestId: string, body: string) {
    const request = await loadOpenRequestForQuery(requestId);
    if (request.requesterId === creatorId) {
      throw new HttpError(403, 'You cannot query your own request.');
    }

    const existing = await queryRepository.findThread(requestId, creatorId);
    const thread: {id: string; status: string; exchangeCount: number} =
      existing ?? (await queryRepository.createThread(requestId, creatorId));
    if (thread.status !== 'OPEN') {
      throw new HttpError(409, 'This question thread is no longer open.');
    }
    if (thread.exchangeCount >= MAX_CREATOR_EXCHANGES) {
      throw new HttpError(
        409,
        "You've used all your questions for this request. Please accept or decline to continue.",
      );
    }

    const {blocked, reason} = checkChatContent(body);
    await queryRepository.addMessage(thread.id, creatorId, body, blocked);

    if (blocked) {
      const refreshed = await queryRepository.findThreadById(thread.id);
      const blockedCount = refreshed?.messages.filter(m => m.blocked).length ?? 0;
      if (blockedCount >= QUERY_MODERATION_FLAG_THRESHOLD && !request.chatFlaggedForReview) {
        await requestRepository.update(requestId, {chatFlaggedForReview: true});
        // Live Monitoring alert feed (PRD §5.14.2 "blocked message attempts") — the aggregate
        // count already surfaces via `flaggedChats` in `adminService.getLiveMonitoring`; this
        // adds the individual, queryable alert entry. Fires once per request (guarded above).
        await adminAlertRepository.create({
          type: 'BLOCKED_MESSAGE_THRESHOLD',
          message: `Query thread on request ${requestId} hit ${blockedCount} blocked message attempts and was flagged for review.`,
          metadata: {blockedCount, threadId: thread.id},
          requestId,
        });
      }
      throw new HttpError(422, CHAT_BLOCKED_MESSAGE, {blockReason: reason});
    }

    await queryRepository.incrementExchangeCount(thread.id);

    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.QUERY_RECEIVED,
      'New question from a Creator',
      body.length > 80 ? `${body.slice(0, 80)}…` : body,
      {requestId, screen: 'RequestDetail'},
    );

    const updated = await queryRepository.findThreadById(thread.id);
    return presentThread(updated!);
  },

  /** `POST /requests/:id/queries/:threadId/reply` — Requester replies (unlimited, not counted against the Creator's cap). */
  async reply(requesterId: string, requestId: string, threadId: string, body: string) {
    const request = await loadOpenRequestForQuery(requestId);
    if (request.requesterId !== requesterId) {
      throw new HttpError(403, 'Only the Requester can reply on this request.');
    }

    const thread = await queryRepository.findThreadById(threadId);
    if (!thread || thread.requestId !== requestId) {
      throw new HttpError(404, 'Question thread not found.');
    }
    if (thread.status !== 'OPEN') {
      throw new HttpError(409, 'This question thread is no longer open.');
    }

    const {blocked, reason} = checkChatContent(body);
    await queryRepository.addMessage(thread.id, requesterId, body, blocked);

    if (blocked) {
      throw new HttpError(422, CHAT_BLOCKED_MESSAGE, {blockReason: reason});
    }

    await notificationService.notifyUser(
      thread.creatorId,
      NotificationType.QUERY_REPLY_RECEIVED,
      'Requester replied',
      body.length > 80 ? `${body.slice(0, 80)}…` : body,
      {requestId, screen: 'CreatorRequestDetail'},
    );

    const updated = await queryRepository.findThreadById(threadId);
    return presentThread(updated!);
  },

  /** `POST /requests/:id/queries/:threadId/decline` — Creator opts out without accepting. */
  async decline(creatorId: string, requestId: string, threadId: string) {
    const thread = await queryRepository.findThreadById(threadId);
    if (!thread || thread.requestId !== requestId) {
      throw new HttpError(404, 'Question thread not found.');
    }
    if (thread.creatorId !== creatorId) {
      throw new HttpError(403, 'You do not own this question thread.');
    }
    if (thread.status !== 'OPEN') {
      throw new HttpError(409, 'This question thread is already closed.');
    }

    const updated = await queryRepository.updateThreadStatus(threadId, 'CLOSED_DECLINED');
    return presentThread({...updated, messages: thread.messages});
  },

  /** `GET /requests/:id/queries` — Requester sees every Creator's thread; a Creator sees only their own. */
  async list(userId: string, requestId: string) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    if (request.requesterId === userId) {
      const threads = await queryRepository.findAllThreadsForRequest(requestId);
      return threads.map(presentThread);
    }

    const thread = await queryRepository.findThread(requestId, userId);
    return thread ? [presentThread(thread)] : [];
  },

  /**
   * Admin/Moderator read of every query thread on a request (PRD §5.9.2/§5.14.6 "query thread
   * viewer") — bypasses the requester/creator participant check `list` above enforces, since an
   * Admin's ID never matches either. Read-only, no thread-status mutation.
   */
  async adminList(requestId: string) {
    const threads = await queryRepository.findAllThreadsForRequest(requestId);
    return threads.map(presentThread);
  },

  /**
   * Closes every open thread on a request the moment a Creator is assigned (PRD §5.4.0 "all
   * open query threads on this request close" / §5.4.1) — called from `requestService.accept`.
   */
  async closeAllForRequest(requestId: string) {
    await queryRepository.closeAllOpenForRequest(requestId);
  },
};
