import {logger} from '../config/logger';
import {ratingRepository} from '../repositories/ratingRepository';
import {requestRepository} from '../repositories/requestRepository';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';

/**
 * Time-driven reminder notifications (backend Phase 12, PRD §8.1 "Recording Reminder"/"Review
 * Reminder"/"Rating Reminder"). Each is a real, once-per-request trigger — not a fake/placeholder
 * event — gated on a dedicated `*ReminderSentAt` timestamp on `Request` so the sweep never
 * re-notifies for a state it already reminded about. The exact thresholds below are engineering
 * defaults, not PRD-specified numbers (the PRD names the trigger, not a wait time) — flagged the
 * same way every other undocumented-PRD-number in this codebase is (docs/CLAUDE.md §8 rule 11).
 */
const RECORDING_REMINDER_AFTER_MINUTES = 10;
const REVIEW_REMINDER_AFTER_HOURS = 2;
const RATING_REMINDER_AFTER_HOURS = 24;

export const notificationReminderJob = {
  async remindStalledRecordings() {
    const cutoff = new Date(Date.now() - RECORDING_REMINDER_AFTER_MINUTES * 60 * 1000);
    const candidates = await requestRepository.findRecordingReminderCandidates(cutoff);
    let sent = 0;

    for (const request of candidates) {
      if (!request.creatorId) continue;
      await notificationService.notifyUser(
        request.creatorId,
        NotificationType.RECORDING_REMINDER,
        'Recording Reminder',
        "Don't forget to finish recording and upload your video for this request.",
        {requestId: request.id, screen: 'CreatorRequestDetail'},
      );
      await requestRepository.update(request.id, {recordingReminderSentAt: new Date()});
      sent += 1;
    }
    return sent;
  },

  async remindPendingReviews() {
    const cutoff = new Date(Date.now() - REVIEW_REMINDER_AFTER_HOURS * 60 * 60 * 1000);
    const candidates = await requestRepository.findReviewReminderCandidates(cutoff);
    let sent = 0;

    for (const request of candidates) {
      await notificationService.notifyUser(
        request.requesterId,
        NotificationType.REVIEW_REMINDER,
        'Review Reminder',
        'Your requested video is waiting for your review.',
        {requestId: request.id, screen: 'VideoReview'},
      );
      await requestRepository.update(request.id, {reviewReminderSentAt: new Date()});
      sent += 1;
    }
    return sent;
  },

  async remindMissingRatings() {
    const cutoff = new Date(Date.now() - RATING_REMINDER_AFTER_HOURS * 60 * 60 * 1000);
    const candidates = await requestRepository.findRatingReminderCandidates(cutoff);
    let sent = 0;

    for (const request of candidates) {
      const [requesterRated, creatorRated] = await Promise.all([
        ratingRepository.findByRequestAndRater(request.id, request.requesterId),
        request.creatorId ? ratingRepository.findByRequestAndRater(request.id, request.creatorId) : Promise.resolve(true),
      ]);

      if (!requesterRated) {
        await notificationService.notifyUser(
          request.requesterId,
          NotificationType.RATING_REMINDER,
          'Rating Reminder',
          'Rate your experience with the Creator on your completed request.',
          {requestId: request.id, screen: 'RequestDetail'},
        );
      }
      if (!creatorRated && request.creatorId) {
        await notificationService.notifyUser(
          request.creatorId,
          NotificationType.RATING_REMINDER,
          'Rating Reminder',
          'Rate your experience with the Requester on your completed request.',
          {requestId: request.id, screen: 'CreatorRequestDetail'},
        );
      }
      await requestRepository.update(request.id, {ratingReminderSentAt: new Date()});
      sent += 1;
    }
    return sent;
  },

  async runSweep() {
    const [recording, review, rating] = await Promise.all([
      this.remindStalledRecordings(),
      this.remindPendingReviews(),
      this.remindMissingRatings(),
    ]);
    const total = recording + review + rating;
    if (total > 0) {
      logger.info(
        `[notificationReminderJob] Sent ${recording} recording, ${review} review, ${rating} rating reminder(s).`,
      );
    }
    return {recording, review, rating};
  },
};
