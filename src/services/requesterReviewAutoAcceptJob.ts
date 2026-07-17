import {logger} from '../config/logger';
import {requestRepository} from '../repositories/requestRepository';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {requesterReviewService} from './requesterReviewService';

/**
 * v2.1 Requester Review 48h auto-accept (PRD_TRD_SUMMARY.md §5.8 `requester_review_auto_accept`,
 * backend Phase 3 item 5). A Requester who never acts on a ready video is auto-accepted at 48h
 * (with a 42h warning push first) so a Creator's payout is never held hostage by an inactive
 * Requester. Both sweeps key off `moderatorDecisionAt` — the same "entered REQUESTER_REVIEW"
 * timestamp `notificationReminderJob.remindPendingReviews` already uses for its 2h reminder (see
 * that file's own note on why this doesn't yet cover the not-yet-built Moderation-OFF path).
 *
 * Runs every 15 minutes per TRD 9's schedule — see `server.ts`.
 */
const WARNING_AFTER_HOURS = 42;
const AUTO_ACCEPT_AFTER_HOURS = 48;

export const requesterReviewAutoAcceptJob = {
  async runWarningSweep() {
    const cutoff = new Date(Date.now() - WARNING_AFTER_HOURS * 60 * 60 * 1000);
    const candidates = await requestRepository.findAutoAcceptWarningCandidates(cutoff);
    let sent = 0;

    for (const request of candidates) {
      await notificationService.notifyUser(
        request.requesterId,
        NotificationType.REVIEW_AUTO_ACCEPT_WARNING,
        'Review window closing soon',
        'Your video will be auto-accepted and payment released in 6 hours if you take no action.',
        {requestId: request.id, screen: 'VideoReview'},
      );
      await requestRepository.update(request.id, {autoAcceptWarningSentAt: new Date()});
      sent += 1;
    }

    return sent;
  },

  async runAutoAcceptSweep() {
    const cutoff = new Date(Date.now() - AUTO_ACCEPT_AFTER_HOURS * 60 * 60 * 1000);
    const candidates = await requestRepository.findAutoAcceptCandidates(cutoff);
    let accepted = 0;

    for (const request of candidates) {
      try {
        // Reuses the exact same escrow-release + state-transition path as a manual Accept
        // (requesterReviewService.acceptVideo re-verifies REQUESTER_REVIEW itself, so this is
        // safe against a race with the Requester manually acting in between sweep ticks).
        await requesterReviewService.acceptVideo(request.requesterId, request.id, undefined);
        accepted += 1;
      } catch (err) {
        logger.error(
          `[requesterReviewAutoAcceptJob] Auto-accept failed for request ${request.id}: ${(err as Error).message}`,
        );
      }
    }

    return accepted;
  },

  async runSweep() {
    const [warned, accepted] = await Promise.all([this.runWarningSweep(), this.runAutoAcceptSweep()]);
    if (warned > 0 || accepted > 0) {
      logger.info(`[requesterReviewAutoAcceptJob] Warned ${warned}, auto-accepted ${accepted}.`);
    }
    return {warned, accepted};
  },
};
