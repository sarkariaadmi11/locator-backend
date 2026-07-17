import {requestRepository} from '../repositories/requestRepository';
import {userRepository} from '../repositories/userRepository';
import {HttpError} from '../utils/httpError';
import {presentRequest} from '../utils/requestPresenter';
import {assertTransition} from './requestStateMachine';
import {escrowService} from './escrowService';
import {ComplianceConfigKey, complianceConfigService} from './complianceConfigService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {verifiedCreatorService} from './verifiedCreatorService';
import {MAX_RESHOOT_ATTEMPTS} from '../validations/requesterReviewValidation';

/**
 * Loads a request the caller owns as Requester and currently sitting in REQUESTER_REVIEW.
 * Requester-only (Creator/Moderator cannot review, PRD §5.10) and single-shot per review
 * cycle — once a decision moves the status off REQUESTER_REVIEW, calling any of these three
 * actions again 409s here rather than at the state-machine layer, giving a clearer message.
 */
async function loadReviewableRequest(requesterId: string, requestId: string) {
  const request = await requestRepository.findById(requestId);
  if (!request) {
    throw new HttpError(404, 'Request not found.');
  }
  if (request.requesterId !== requesterId) {
    throw new HttpError(403, 'Only the Requester can review this request.');
  }
  if (request.status !== 'REQUESTER_REVIEW') {
    throw new HttpError(409, 'This request is not currently awaiting your review, or has already been reviewed.');
  }
  return request;
}

/** Requester Review & Re-shoot Workflow (PRD §5.10, §4.6, backend Phase 7). */
export const requesterReviewService = {
  /**
   * `POST /requests/:id/accept-video` — Requester approves. Chains straight through escrow
   * release into `PAYMENT_RELEASED -> COMPLETED` in the same call (backend Phase 8), mirroring
   * the auto-chain pattern `requestService.accept`/`requestReshoot` already use elsewhere in
   * this domain — `ACCEPTED` is not a state a client will typically observe lingering in.
   */
  async acceptVideo(requesterId: string, requestId: string, remarks: string | undefined) {
    const request = await loadReviewableRequest(requesterId, requestId);

    assertTransition('REQUESTER_REVIEW', 'ACCEPTED');
    const now = new Date();
    await requestRepository.update(requestId, {
      status: 'ACCEPTED',
      requesterDecisionAt: now,
      requesterReviewRemarks: remarks ?? null,
    });

    // Welcome-video re-prompt counter (PRD §5.11b.3, backend Phase 13) — resets on any approved
    // submission, mirroring the file-level doc comment on `User.consecutiveRejections`.
    if (request.creatorId) {
      await userRepository.update(request.creatorId, {consecutiveRejections: 0});
    }

    if (request.creatorId) {
      await notificationService.notifyUser(
        request.creatorId,
        NotificationType.VIDEO_ACCEPTED,
        'Video Accepted ✓',
        'The Requester accepted your video. Releasing payment now.',
        {requestId, screen: 'CreatorRequestDetail'},
      );
    }

    // Escrow release (fcmService's own 'Payment Released' notification fires from inside this
    // call) then the two remaining terminal transitions — both edges already exist in
    // requestStateMachine, untouched by this phase.
    await escrowService.release(requestId);

    assertTransition('ACCEPTED', 'PAYMENT_RELEASED');
    await requestRepository.update(requestId, {status: 'PAYMENT_RELEASED'});

    assertTransition('PAYMENT_RELEASED', 'COMPLETED');
    const updated = await requestRepository.update(requestId, {status: 'COMPLETED'});

    // Verified Creator Badge re-evaluation (PRD_TRD_SUMMARY.md §4.12, backend Phase 7) —
    // event-driven on every Completed transition, per TRD 9. Awaited (not fire-and-forget) so
    // the badge state is guaranteed current by the time this call returns, but wrapped so a
    // failure here can never block the Requester's Accept action from completing.
    if (updated.creatorId) {
      try {
        await verifiedCreatorService.evaluate(updated.creatorId);
      } catch {
        // Best-effort — the next Completed transition or rating will re-evaluate anyway.
      }
    }

    // "Payment Completed" (Escrow matrix item) — distinct from escrowService's "Payment
    // Released" (which goes to the Creator confirming their payout): this confirms to the
    // Requester that the whole request/transaction is done, not just that money moved.
    await notificationService.notifyUser(
      requesterId,
      NotificationType.PAYMENT_COMPLETED,
      'Payment completed',
      'Your request has been completed and payment has been fully processed.',
      {requestId, screen: 'RequestDetail'},
    );

    return presentRequest(updated);
  },

  /**
   * `POST /requests/:id/request-reshoot` — once only (PRD "one free re-shoot"). Chains
   * REQUESTER_REVIEW -> RESHOOT_REQUESTED -> RECORDING in one call (mirrors how
   * `requestService.accept` chains CREATOR_ASSIGNED -> TEMPORARY_CHAT) so the Creator lands
   * directly back in the recording stage. The previously approved video row is left untouched
   * (preserves moderation history / prior-recording audit trail, PRD's re-shoot requirements)
   * — `recordingService.createUploadSession` was extended to allow a fresh session once the
   * request is back in RECORDING even if the latest video is APPROVED, not just FAILED/REJECTED.
   */
  async requestReshoot(requesterId: string, requestId: string, reason: string, remarks: string | undefined) {
    const request = await loadReviewableRequest(requesterId, requestId);

    if (request.reshootUsed || request.reshootCount >= MAX_RESHOOT_ATTEMPTS) {
      throw new HttpError(409, 'The one free re-shoot for this request has already been used.');
    }

    assertTransition('REQUESTER_REVIEW', 'RESHOOT_REQUESTED');
    assertTransition('RESHOOT_REQUESTED', 'RECORDING');
    const now = new Date();
    const updated = await requestRepository.update(requestId, {
      status: 'RECORDING',
      requesterDecisionAt: now,
      reshootUsed: true,
      reshootCount: {increment: 1},
      reshootReason: reason,
      requesterReviewRemarks: remarks ?? null,
      recordingStartedAt: null,
      uploadedAt: null,
    });

    if (request.creatorId) {
      await notificationService.notifyUser(
        request.creatorId,
        NotificationType.RESHOOT_REQUESTED,
        'Re-shoot Requested',
        `The Requester asked for a re-shoot: ${reason}`,
        {requestId, reason, screen: 'CreatorRequestDetail'},
      );
    }

    return presentRequest(updated);
  },

  /**
   * `POST /requests/:id/reject` — terminal decision. No second re-shoot; no Dispute Center this
   * milestone. Refunds the locked escrow back to the Requester (backend Phase 8) before flipping
   * status, so a refund failure leaves the request in the still-reviewable REQUESTER_REVIEW
   * state rather than a REJECTED-but-unrefunded one.
   */
  async reject(requesterId: string, requestId: string, reason: string, remarks: string | undefined) {
    const request = await loadReviewableRequest(requesterId, requestId);

    assertTransition('REQUESTER_REVIEW', 'REJECTED');
    await escrowService.refund(requestId);
    const now = new Date();
    const updated = await requestRepository.update(requestId, {
      status: 'REJECTED',
      requesterDecisionAt: now,
      requesterRejectionReason: reason,
      requesterReviewRemarks: remarks ?? null,
    });

    // Welcome-video re-prompt trigger (PRD §5.11b.3, backend Phase 13): 3 consecutive rejections
    // (ComplianceConfig-configurable threshold) flips `welcomeVideoRepromptPending` and resets
    // the counter in the same update — mobile clears the flag via `POST /account/welcome-video-ack`
    // once it has shown the video again.
    if (request.creatorId) {
      const threshold = await complianceConfigService.getNumber(
        ComplianceConfigKey.CONSECUTIVE_REJECTIONS_REPROMPT_THRESHOLD,
      );
      const creator = await userRepository.findById(request.creatorId);
      const consecutiveRejections = (creator?.consecutiveRejections ?? 0) + 1;
      if (consecutiveRejections >= threshold) {
        await userRepository.update(request.creatorId, {
          consecutiveRejections: 0,
          welcomeVideoRepromptPending: true,
        });
      } else {
        await userRepository.update(request.creatorId, {consecutiveRejections});
      }
    }

    if (request.creatorId) {
      await notificationService.notifyUser(
        request.creatorId,
        NotificationType.VIDEO_REQUESTER_REJECTED,
        'Video Rejected',
        `The Requester rejected your video: ${reason}`,
        {requestId, reason, screen: 'CreatorRequestDetail'},
      );
    }

    return presentRequest(updated);
  },
};
