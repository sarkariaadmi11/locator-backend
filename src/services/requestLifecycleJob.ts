import {logger} from '../config/logger';
import {requestRepository} from '../repositories/requestRepository';
import {escrowService} from './escrowService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {notifyEligibleCreatorsOfNewRequest} from './requestService';
import {assertTransition} from './requestStateMachine';

/**
 * Runs the two time-driven Request transitions this domain owns:
 *  - SCHEDULED requests publish once scheduledAt arrives (DRAFT -> PUBLISHED).
 *  - DRAFT/PUBLISHED requests past expiresAt with no Creator ever assigned auto-expire, refunding
 *    escrow back to the Requester (PRD §7.3, backend Phase 8). Refund happens per-row,
 *    best-effort — one row's refund failure is logged and does not block the rest of the sweep
 *    or the row's own expiry (an unrefunded escrow is a data problem to investigate via the
 *    Admin's manual-override endpoint, not a reason to leave the request stuck un-expired).
 */
export const requestLifecycleJob = {
  async publishDueScheduled() {
    const due = await requestRepository.findScheduledDueForPublish(new Date());
    let published = 0;

    for (const request of due) {
      assertTransition('DRAFT', 'PUBLISHED');
      const result = await requestRepository.updateStatusIfCurrently(request.id, 'DRAFT', {
        status: 'PUBLISHED',
      });
      if (result.count > 0) {
        published += 1;
        const publishedRequest = await requestRepository.findById(request.id);
        await notifyEligibleCreatorsOfNewRequest(publishedRequest);
      }
    }

    if (published > 0) {
      logger.info(`[requestLifecycleJob.publishDueScheduled] Published ${published} scheduled request(s).`);
    }
    return published;
  },

  async expireDueRequests() {
    const candidates = await requestRepository.findExpiredCandidates(new Date());
    let expired = 0;

    for (const request of candidates) {
      if (!assertTransitionSafe(request.status, 'EXPIRED')) continue;

      try {
        await escrowService.refund(request.id);
      } catch (err) {
        logger.error(
          `[requestLifecycleJob.expireDueRequests] Escrow refund failed for request ${request.id}: ${(err as Error).message}`,
        );
      }

      const result = await requestRepository.updateStatusIfCurrently(request.id, request.status, {
        status: 'EXPIRED',
      });
      if (result.count > 0) {
        expired += 1;
        await notificationService.notifyUser(
          request.requesterId,
          NotificationType.REQUEST_EXPIRED,
          'Request expired',
          'Your request expired with no Creator accepting it in time. Any locked amount has been refunded.',
          {requestId: request.id, screen: 'RequestDetail'},
        );
      }
    }

    if (expired > 0) {
      logger.info(`[requestLifecycleJob.expireDueRequests] Expired ${expired} request(s).`);
    }
    return expired;
  },

  async runSweep() {
    const published = await this.publishDueScheduled();
    const expired = await this.expireDueRequests();
    return {published, expired};
  },
};

function assertTransitionSafe(from: Parameters<typeof assertTransition>[0], to: Parameters<typeof assertTransition>[1]) {
  try {
    assertTransition(from, to);
    return true;
  } catch {
    return false;
  }
}
