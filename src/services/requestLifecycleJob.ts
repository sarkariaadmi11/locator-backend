import {logger} from '../config/logger';
import {requestRepository} from '../repositories/requestRepository';
import {notifyEligibleCreatorsOfNewRequest} from './requestService';
import {assertTransition} from './requestStateMachine';

/**
 * Runs the two time-driven Request transitions this domain owns:
 *  - SCHEDULED requests publish once scheduledAt arrives (DRAFT -> PUBLISHED).
 *  - DRAFT/PUBLISHED requests past expiresAt with no Creator ever assigned auto-expire.
 * Escrow refund-on-expiry (PRD §7.3) is deliberately not wired here — `RequestEscrow` doesn't
 * exist yet (escrow is out of scope for this domain, see MASTER_EXECUTION_PLAN.md Phase 8);
 * only the status transition is applied for now.
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

      const result = await requestRepository.updateStatusIfCurrently(request.id, request.status, {
        status: 'EXPIRED',
      });
      if (result.count > 0) expired += 1;
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
