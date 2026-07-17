import {DisputeReason, DisputeResolution, DisputeStatus, Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';
import {cloudinary} from '../config/cloudinary';
import {logger} from '../config/logger';
import {disputeRepository} from '../repositories/disputeRepository';
import {requestEscrowRepository} from '../repositories/requestEscrowRepository';
import {requestRepository} from '../repositories/requestRepository';
import {requestVideoRepository} from '../repositories/requestVideoRepository';
import {transactionRepository} from '../repositories/transactionRepository';
import {HttpError} from '../utils/httpError';
import {buildGpsCheck} from '../utils/geo';
import {presentDispute, presentDisputeDetail} from '../utils/disputePresenter';
import {presentRequestVideo} from '../utils/requestVideoPresenter';
import {DISPUTE_ALLOWED_SOURCE_STATUSES} from '../validations/disputeValidation';
import {REQUEST_HIGH_VALUE_THRESHOLD as LARGE_REFUND_THRESHOLD} from '../validations/requestValidation';
import {adminAuditLogService} from './adminAuditLogService';
import {escrowService} from './escrowService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {postSubmissionChatService} from './postSubmissionChatService';
import {queryService} from './queryService';
import {assertTransition} from './requestStateMachine';
import {round2} from '../utils/money';

function uploadEvidenceToCloudinary(buffer: Buffer, disputeId: string): Promise<{secure_url: string; format?: string}> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {folder: `locator/dispute-evidence/${disputeId}`, resource_type: 'auto'},
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve(result);
      },
    );
    stream.end(buffer);
  });
}

async function loadDisputeDetailOr404(disputeId: string) {
  const dispute = await disputeRepository.findById(disputeId);
  if (!dispute) {
    throw new HttpError(404, 'Dispute not found.');
  }
  return dispute;
}

/** Requester or the assigned Creator on the dispute's underlying request — not a third party. */
function assertParticipant(dispute: {request: {requesterId: string; creatorId: string | null}}, userId: string) {
  if (dispute.request.requesterId !== userId && dispute.request.creatorId !== userId) {
    throw new HttpError(403, 'You are not a participant in this dispute.');
  }
}

function roleOf(request: {requesterId: string; creatorId: string | null}, userId: string): 'REQUESTER' | 'CREATOR' {
  return request.requesterId === userId ? 'REQUESTER' : 'CREATOR';
}

/**
 * Dispute Center (PRD §5.14.2, §5.14.3, §5.14.6, §5.14.8, §5.14.10, §4.9, backend Phase 11).
 * Reuses `transactionRepository.runTransaction` for money movement (same ledger mechanics as
 * escrowService/walletService), `fcmService` for notifications, and `adminAuditLogService` for
 * both the immutable admin action log and — mirroring trustScoreService's "manual review notes"
 * precedent — Admin case notes (filtered from the same log by action, not a new table).
 */
export const disputeService = {
  // --- Participant-facing (Requester or Creator) ------------------------------------------

  /**
   * `POST /disputes` — only a participant of the request may raise a dispute, only from a
   * status where the PRD's business rule allows it (see DISPUTE_ALLOWED_SOURCE_STATUSES), and
   * only once per request (`@@unique` on `Dispute.requestId`). Automatically freezes escrow,
   * blocks payout, and notifies the other participant + all Admins.
   */
  async create(userId: string, input: {requestId: string; reason: DisputeReason; description: string}) {
    const request = await requestRepository.findById(input.requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    if (request.requesterId !== userId && request.creatorId !== userId) {
      throw new HttpError(403, 'Only participants of this request may raise a dispute.');
    }

    if (!(DISPUTE_ALLOWED_SOURCE_STATUSES as readonly string[]).includes(request.status)) {
      throw new HttpError(409, `A dispute cannot be raised while this request is ${request.status}.`);
    }

    const existing = await disputeRepository.findByRequestId(input.requestId);
    if (existing) {
      throw new HttpError(409, 'A dispute has already been raised for this request.');
    }

    const escrow = await requestEscrowRepository.findByRequestId(input.requestId);
    if (!escrow) {
      throw new HttpError(404, 'No escrow exists for this request.');
    }

    assertTransition(request.status, 'DISPUTED');

    const raisedByRole = roleOf(request, userId);
    const created = await disputeRepository.create({
      request: {connect: {id: input.requestId}},
      raisedBy: {connect: {id: userId}},
      raisedByRole,
      reason: input.reason,
      description: input.description,
      amountLocked: escrow.amountLocked,
      commissionRate: escrow.commissionRate,
      escrowStateAtCreation: escrow.state,
      alreadyReleasedToCreator: escrow.state === 'RELEASED' ? escrow.creatorEarnings : 0,
      alreadyRefundedToRequester: escrow.state === 'REFUNDED' ? escrow.amountLocked : 0,
    });

    await escrowService.freeze(input.requestId);
    await requestRepository.update(input.requestId, {status: 'DISPUTED'});

    const otherPartyId = raisedByRole === 'REQUESTER' ? request.creatorId : request.requesterId;
    if (otherPartyId) {
      await notificationService.notifyUser(
        otherPartyId,
        NotificationType.DISPUTE_CREATED,
        'Dispute Raised',
        'A dispute has been raised on your request. Our team will review it shortly.',
        {requestId: input.requestId, disputeId: created.id, screen: 'DisputeDetail'},
      );
    }
    await notificationService.notifyAdmins(
      NotificationType.DISPUTE_CREATED,
      'New Dispute Raised',
      `A ${raisedByRole.toLowerCase()} raised a dispute (${input.reason}).`,
      {requestId: input.requestId, disputeId: created.id},
    );

    return presentDispute(created);
  },

  /**
   * `POST /admin/moderation/videos/:videoId/escalate` — Admin/Moderator "Escalate to Dispute
   * Center" (PRD §5.14.7, admin frontend Phase 3, backend Phase 5 item 6). Unlike `create()`
   * above, the caller is staff, not a participant — `Dispute.raisedById` is a hard FK to `User`
   * (no `Admin` variant), so this attributes the case to the request's Requester with
   * `raisedByRole: 'ADMIN'` (an existing enum value, previously unused) to correctly mark it as
   * staff-initiated, not a Requester self-service dispute. The escalating Admin is set as
   * `caseOwnerAdmin` immediately, skipping the normal manual "assign" step.
   */
  async adminEscalate(adminId: string, requestId: string, input: {reason: DisputeReason; description: string}) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    if (!(DISPUTE_ALLOWED_SOURCE_STATUSES as readonly string[]).includes(request.status)) {
      throw new HttpError(409, `A dispute cannot be raised while this request is ${request.status}.`);
    }

    const existing = await disputeRepository.findByRequestId(requestId);
    if (existing) {
      throw new HttpError(409, 'A dispute has already been raised for this request.');
    }

    const escrow = await requestEscrowRepository.findByRequestId(requestId);
    if (!escrow) {
      throw new HttpError(404, 'No escrow exists for this request.');
    }

    assertTransition(request.status, 'DISPUTED');

    const created = await disputeRepository.create({
      request: {connect: {id: requestId}},
      raisedBy: {connect: {id: request.requesterId}},
      raisedByRole: 'ADMIN',
      reason: input.reason,
      description: input.description,
      amountLocked: escrow.amountLocked,
      commissionRate: escrow.commissionRate,
      escrowStateAtCreation: escrow.state,
      alreadyReleasedToCreator: escrow.state === 'RELEASED' ? escrow.creatorEarnings : 0,
      alreadyRefundedToRequester: escrow.state === 'REFUNDED' ? escrow.amountLocked : 0,
      caseOwnerAdmin: {connect: {id: adminId}},
    });

    await escrowService.freeze(requestId);
    await requestRepository.update(requestId, {status: 'DISPUTED'});
    await adminAuditLogService.log(adminId, 'MODERATION_ESCALATED_TO_DISPUTE', 'Request', requestId, {
      disputeId: created.id,
      reason: input.reason,
    });

    for (const partyId of [request.requesterId, request.creatorId]) {
      if (!partyId) continue;
      await notificationService.notifyUser(
        partyId,
        NotificationType.DISPUTE_CREATED,
        'Dispute Raised',
        'Our moderation team has escalated your request to the Dispute Center for review.',
        {requestId, disputeId: created.id, screen: 'DisputeDetail'},
      );
    }

    return presentDispute(created);
  },

  /** `GET /disputes/mine` — disputes where the caller is a participant of the underlying request. */
  async listMine(userId: string, status: DisputeStatus | undefined, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where: Prisma.DisputeWhereInput = {
      request: {OR: [{requesterId: userId}, {creatorId: userId}]},
      ...(status ? {status} : {}),
    };

    const [items, total] = await Promise.all([
      disputeRepository.findMany({
        where,
        orderBy: {createdAt: 'desc'},
        skip,
        take: limit,
        include: {request: {select: {id: true, description: true, status: true}}},
      }),
      disputeRepository.count(where),
    ]);

    return {
      items: items.map(item => ({...presentDispute(item), status: item.status, request: item.request})),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  /** `GET /disputes/:id` — participant-only, internal admin notes/messages filtered out. */
  async getForParticipant(userId: string, disputeId: string) {
    const dispute = await loadDisputeDetailOr404(disputeId);
    assertParticipant(dispute, userId);
    return presentDisputeDetail(dispute, false);
  },

  /** `POST /disputes/:id/messages` — participant case communication. */
  async postMessage(userId: string, disputeId: string, body: string) {
    const dispute = await loadDisputeDetailOr404(disputeId);
    assertParticipant(dispute, userId);

    await disputeRepository.createMessage({
      dispute: {connect: {id: disputeId}},
      authorType: roleOf(dispute.request, userId),
      authorUser: {connect: {id: userId}},
      body,
    });

    const otherPartyId =
      dispute.request.requesterId === userId ? dispute.request.creatorId : dispute.request.requesterId;
    if (otherPartyId) {
      await notificationService.notifyUser(
        otherPartyId,
        NotificationType.DISPUTE_MESSAGE,
        'New Dispute Message',
        'There is a new message on your dispute case.',
        {requestId: dispute.requestId, disputeId, screen: 'DisputeDetail'},
      );
    }

    return presentDisputeDetail(await loadDisputeDetailOr404(disputeId), false);
  },

  /** `POST /disputes/:id/evidence` — Requester/Creator evidence upload (Cloudinary, image/PDF). */
  async submitEvidence(userId: string, disputeId: string, file: Express.Multer.File | undefined, caption: string | undefined) {
    const dispute = await loadDisputeDetailOr404(disputeId);
    assertParticipant(dispute, userId);
    if (!file) {
      throw new HttpError(422, 'Evidence file is required.');
    }

    let result: {secure_url: string; format?: string};
    try {
      result = await uploadEvidenceToCloudinary(file.buffer, disputeId);
    } catch (err) {
      const cloudinaryError = err as {http_code?: number; message?: string};
      logger.error(
        `[disputeService.submitEvidence] Cloudinary upload failed for dispute=${disputeId}. ` +
          `http_code=${cloudinaryError.http_code ?? 'unknown'} message=${cloudinaryError.message ?? (err as Error).message}`,
      );
      throw new HttpError(502, 'Unable to upload evidence right now. Please try again shortly.');
    }

    await disputeRepository.createEvidence({
      dispute: {connect: {id: disputeId}},
      uploadedByType: roleOf(dispute.request, userId),
      uploadedByUser: {connect: {id: userId}},
      url: result.secure_url,
      mimeType: file.mimetype,
      caption: caption ?? null,
    });

    const otherPartyId =
      dispute.request.requesterId === userId ? dispute.request.creatorId : dispute.request.requesterId;
    if (otherPartyId) {
      await notificationService.notifyUser(
        otherPartyId,
        NotificationType.NEW_EVIDENCE,
        'New Evidence Submitted',
        'New evidence was submitted on your dispute case.',
        {requestId: dispute.requestId, disputeId, screen: 'DisputeDetail'},
      );
    }
    await notificationService.notifyAdmins(
      NotificationType.NEW_EVIDENCE,
      'New dispute evidence submitted',
      'A participant submitted new evidence on a dispute case.',
      {requestId: dispute.requestId, disputeId},
    );

    return presentDisputeDetail(await loadDisputeDetailOr404(disputeId), false);
  },

  // --- Admin (PRD §5.14.2/§5.14.3/§5.14.6/§5.14.8/§5.14.10 — Dispute Dashboard/Queue/Case Detail/
  // Evidence Viewer/Escrow Status/Timeline/Notes/Resolution/Statistics/Filters/Search) ---------

  async adminList(
    filters: {
      status?: DisputeStatus;
      reason?: DisputeReason;
      caseOwnerAdminId?: string;
      raisedById?: string;
      requestId?: string;
      search?: string;
    },
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.DisputeWhereInput = {
      ...(filters.status ? {status: filters.status} : {}),
      ...(filters.reason ? {reason: filters.reason} : {}),
      ...(filters.caseOwnerAdminId ? {caseOwnerAdminId: filters.caseOwnerAdminId} : {}),
      ...(filters.raisedById ? {raisedById: filters.raisedById} : {}),
      ...(filters.requestId ? {requestId: filters.requestId} : {}),
      ...(filters.search ? {description: {contains: filters.search, mode: 'insensitive'}} : {}),
    };

    const [items, total] = await Promise.all([
      disputeRepository.findMany({
        where,
        orderBy: {createdAt: 'desc'},
        skip,
        take: limit,
        include: {
          request: {select: {id: true, description: true, status: true, requesterId: true, creatorId: true}},
          raisedBy: {select: {id: true, name: true, username: true}},
          caseOwnerAdmin: {select: {id: true, name: true}},
        },
      }),
      disputeRepository.count(where),
    ]);

    return {
      items: items.map(item => ({
        ...presentDispute(item),
        status: item.status,
        request: item.request,
        raisedBy: item.raisedBy,
        caseOwnerAdmin: item.caseOwnerAdmin,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  /**
   * Case Detail + Evidence Viewer + Escrow Status — full detail, internal notes included.
   * PRD §5.14.6 "views video, query threads, post-submission chat, GPS data, both parties'
   * input" — the base `presentDisputeDetail` already covers messages/evidence/both parties;
   * this adds the remaining four via the same admin-bypass pattern used elsewhere
   * (`queryService.adminList`/`postSubmissionChatService.adminList` skip the participant check
   * a normal user-facing call would enforce).
   */
  async adminDetail(disputeId: string) {
    const dispute = await loadDisputeDetailOr404(disputeId);
    const [escrow, video, queryThreads, postSubmissionChat] = await Promise.all([
      requestEscrowRepository.findByRequestId(dispute.requestId),
      requestVideoRepository.findActiveByRequestId(dispute.requestId),
      queryService.adminList(dispute.requestId),
      postSubmissionChatService.adminList(dispute.requestId),
    ]);

    return {
      ...presentDisputeDetail(dispute, true),
      escrow,
      video: video ? presentRequestVideo(video) : null,
      gpsCheck: buildGpsCheck(dispute.request, video),
      queryThreads,
      postSubmissionChat,
    };
  },

  /** Dispute Dashboard statistics. */
  async adminStats() {
    const grouped = await disputeRepository.groupStatsByStatus();
    const byStatus: Record<DisputeStatus, number> = {OPEN: 0, UNDER_REVIEW: 0, RESOLVED: 0, CLOSED: 0, REOPENED: 0};
    for (const row of grouped) {
      byStatus[row.status] = row._count._all;
    }
    return {
      open: byStatus.OPEN,
      underReview: byStatus.UNDER_REVIEW,
      resolved: byStatus.RESOLVED,
      closed: byStatus.CLOSED,
      reopened: byStatus.REOPENED,
      total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
    };
  },

  /** Case owner assignment — Admin claims/reassigns a case, advancing it into UNDER_REVIEW. */
  async adminAssign(adminId: string, disputeId: string, targetAdminId: string | undefined) {
    const dispute = await loadDisputeDetailOr404(disputeId);
    const ownerId = targetAdminId ?? adminId;

    await disputeRepository.update(disputeId, {
      caseOwnerAdmin: {connect: {id: ownerId}},
      ...(dispute.status === 'OPEN' ? {status: 'UNDER_REVIEW' as DisputeStatus} : {}),
    });
    await adminAuditLogService.log(adminId, 'DISPUTE_CASE_ASSIGNED', 'Dispute', disputeId, {caseOwnerAdminId: ownerId});

    for (const participantId of [dispute.request.requesterId, dispute.request.creatorId]) {
      if (!participantId) continue;
      await notificationService.notifyUser(
        participantId,
        NotificationType.ADMIN_ASSIGNED,
        'Case Assigned',
        'An Admin has been assigned to review your dispute case.',
        {requestId: dispute.requestId, disputeId, screen: 'DisputeDetail'},
      );
    }

    return presentDisputeDetail(await loadDisputeDetailOr404(disputeId), true);
  },

  /** Admin/Moderator message on the case — `isInternalNote` keeps it out of the participant view. */
  async adminPostMessage(adminId: string, disputeId: string, body: string, isInternalNote: boolean) {
    const dispute = await loadDisputeDetailOr404(disputeId);

    await disputeRepository.createMessage({
      dispute: {connect: {id: disputeId}},
      authorType: 'ADMIN',
      authorAdmin: {connect: {id: adminId}},
      body,
      isInternalNote,
    });

    if (!isInternalNote) {
      for (const participantId of [dispute.request.requesterId, dispute.request.creatorId]) {
        if (!participantId) continue;
        await notificationService.notifyUser(
          participantId,
          NotificationType.DISPUTE_MESSAGE,
          'Dispute Update',
          'The Locator team posted an update on your dispute case.',
          {requestId: dispute.requestId, disputeId, screen: 'DisputeDetail'},
        );
      }
    }

    return presentDisputeDetail(await loadDisputeDetailOr404(disputeId), true);
  },

  /** Admin evidence upload (e.g. moderation screenshots attached to the case). */
  async adminSubmitEvidence(adminId: string, disputeId: string, file: Express.Multer.File | undefined, caption: string | undefined) {
    await loadDisputeDetailOr404(disputeId);
    if (!file) {
      throw new HttpError(422, 'Evidence file is required.');
    }

    let result: {secure_url: string};
    try {
      result = await uploadEvidenceToCloudinary(file.buffer, disputeId);
    } catch (err) {
      const cloudinaryError = err as {http_code?: number; message?: string};
      logger.error(
        `[disputeService.adminSubmitEvidence] Cloudinary upload failed for dispute=${disputeId}. ` +
          `http_code=${cloudinaryError.http_code ?? 'unknown'} message=${cloudinaryError.message ?? (err as Error).message}`,
      );
      throw new HttpError(502, 'Unable to upload evidence right now. Please try again shortly.');
    }

    await disputeRepository.createEvidence({
      dispute: {connect: {id: disputeId}},
      uploadedByType: 'ADMIN',
      uploadedByAdmin: {connect: {id: adminId}},
      url: result.secure_url,
      mimeType: file.mimetype,
      caption: caption ?? null,
    });

    return presentDisputeDetail(await loadDisputeDetailOr404(disputeId), true);
  },

  /**
   * Resolution history/notes — reuses the immutable `AdminAuditLog` exactly like
   * trustScoreService's `adminAddNote`/`adminListNotes` (see docs/CLAUDE.md's "reuse existing"
   * instruction), rather than a new table. `adminAuditTrail` (unfiltered) doubles as the case's
   * Timeline — every assign/resolve/close/reopen/note action against this Dispute, oldest last.
   */
  async adminAddNote(adminId: string, disputeId: string, note: string) {
    await loadDisputeDetailOr404(disputeId);
    await adminAuditLogService.log(adminId, 'DISPUTE_NOTE_ADDED', 'Dispute', disputeId, {note});
    return this.adminListNotes(disputeId);
  },

  async adminListNotes(disputeId: string) {
    const {items} = await adminAuditLogService.list({targetEntityType: 'Dispute', targetEntityId: disputeId}, 1, 200);
    return items.filter(entry => entry.action === 'DISPUTE_NOTE_ADDED');
  },

  async adminAuditTrail(disputeId: string) {
    const {items} = await adminAuditLogService.list({targetEntityType: 'Dispute', targetEntityId: disputeId}, 1, 200);
    return items;
  },

  /**
   * `PATCH /admin/disputes/:id/resolve` — Approve Requester / Approve Creator / Split payment.
   * Delta-based against the dispute's creation-time snapshot (see schema.prisma's file-level
   * comment on `Dispute`) so this correctly handles all three cases the PRD's business rule
   * allows a dispute to be raised from: still-FROZEN funds (never settled), already-RELEASED
   * (COMPLETED before the dispute), and already-REFUNDED (REJECTED before the dispute) — the
   * same code path reverses an already-settled outcome or releases a still-frozen one.
   */
  async adminResolve(
    adminId: string,
    disputeId: string,
    input: {resolution: DisputeResolution; splitPercentage?: number; notes?: string},
  ) {
    const dispute = await loadDisputeDetailOr404(disputeId);
    if (dispute.status === 'RESOLVED' || dispute.status === 'CLOSED') {
      throw new HttpError(409, `This dispute has already been ${dispute.status.toLowerCase()}.`);
    }

    const amountLocked = Number(dispute.amountLocked);
    const commissionRate = Number(dispute.commissionRate);
    const alreadyReleased = Number(dispute.alreadyReleasedToCreator);
    const alreadyRefunded = Number(dispute.alreadyRefundedToRequester);

    let targetRequesterAmount: number;
    let targetCreatorNet: number;
    let newEscrowState: 'REFUNDED' | 'RELEASED' | 'SPLIT';

    if (input.resolution === 'REQUESTER_FAVOUR') {
      targetRequesterAmount = amountLocked;
      targetCreatorNet = 0;
      newEscrowState = 'REFUNDED';
    } else if (input.resolution === 'CREATOR_FAVOUR') {
      const commissionAmount = round2((amountLocked * commissionRate) / 100);
      targetRequesterAmount = 0;
      targetCreatorNet = round2(amountLocked - commissionAmount);
      newEscrowState = 'RELEASED';
    } else {
      const pct = input.splitPercentage ?? 50;
      targetRequesterAmount = round2((amountLocked * pct) / 100);
      const creatorGross = round2(amountLocked - targetRequesterAmount);
      const creatorCommission = round2((creatorGross * commissionRate) / 100);
      targetCreatorNet = round2(creatorGross - creatorCommission);
      newEscrowState = 'SPLIT';
    }

    const requesterDelta = round2(targetRequesterAmount - alreadyRefunded);
    const creatorDelta = round2(targetCreatorNet - alreadyReleased);

    const request = dispute.request;
    const now = new Date();
    const ops: Prisma.PrismaPromise<unknown>[] = [];

    if (requesterDelta !== 0) {
      ops.push(
        prisma.user.update({
          where: {id: request.requesterId},
          data: {
            walletBalance:
              requesterDelta > 0 ? {increment: requesterDelta} : {decrement: Math.abs(requesterDelta)},
          },
        }),
      );
      ops.push(
        prisma.transaction.create({
          data: {
            userId: request.requesterId,
            type: requesterDelta > 0 ? 'CREDIT' : 'DEBIT',
            status: 'SUCCESS',
            amount: Math.abs(requesterDelta),
            description: `Dispute resolution adjustment (${input.resolution})`,
            requestId: dispute.requestId,
          },
        }),
      );
    }

    if (creatorDelta !== 0 && request.creatorId) {
      ops.push(
        prisma.user.update({
          where: {id: request.creatorId},
          data: {
            walletBalance: creatorDelta > 0 ? {increment: creatorDelta} : {decrement: Math.abs(creatorDelta)},
          },
        }),
      );
      ops.push(
        prisma.transaction.create({
          data: {
            userId: request.creatorId,
            type: creatorDelta > 0 ? 'CREDIT' : 'DEBIT',
            status: 'SUCCESS',
            amount: Math.abs(creatorDelta),
            description: `Dispute resolution adjustment (${input.resolution})`,
            requestId: dispute.requestId,
          },
        }),
      );
    }

    const escrow = await requestEscrowRepository.findByRequestId(dispute.requestId);
    if (escrow) {
      ops.push(
        prisma.requestEscrow.update({
          where: {id: escrow.id},
          data: {
            state: newEscrowState,
            creatorEarnings: targetCreatorNet,
            refundAmount: targetRequesterAmount,
            releasedAt: newEscrowState !== 'REFUNDED' ? now : escrow.releasedAt,
            refundedAt: newEscrowState !== 'RELEASED' ? now : escrow.refundedAt,
            settledAt: now,
          },
        }),
      );
    }

    ops.push(
      prisma.dispute.update({
        where: {id: disputeId},
        data: {
          status: 'RESOLVED',
          resolution: input.resolution,
          splitPercentage: input.resolution === 'PARTIAL' ? input.splitPercentage : null,
          resolutionNotes: input.notes ?? null,
          resolvedByAdmin: {connect: {id: adminId}},
          resolvedAt: now,
          alreadyReleasedToCreator: targetCreatorNet,
          alreadyRefundedToRequester: targetRequesterAmount,
        },
      }),
    );

    await transactionRepository.runTransaction(ops);

    await adminAuditLogService.log(adminId, 'DISPUTE_RESOLVED', 'Dispute', disputeId, {
      resolution: input.resolution,
      splitPercentage: input.splitPercentage,
      requesterDelta,
      creatorDelta,
    });

    // A refund-direction resolution for the Requester gets the more specific "Refund Completed"
    // notification (Disputes matrix item) rather than the generic "Dispute Resolved" — avoids
    // sending two notifications for the same single event.
    if (requesterDelta > 0) {
      await notificationService.notifyUser(
        request.requesterId,
        NotificationType.REFUND_COMPLETED,
        'Refund Completed',
        `₹${requesterDelta.toFixed(2)} has been credited to your wallet.`,
        {requestId: dispute.requestId, disputeId, screen: 'Wallet'},
      );
      if (requesterDelta >= LARGE_REFUND_THRESHOLD) {
        await notificationService.notifyAdmins(
          NotificationType.LARGE_REFUND,
          'Large dispute refund issued',
          `₹${requesterDelta.toFixed(2)} was refunded via dispute resolution for request ${dispute.requestId}.`,
          {requestId: dispute.requestId, disputeId},
        );
      }
    } else if (requesterDelta !== 0) {
      await notificationService.notifyUser(
        request.requesterId,
        NotificationType.DISPUTE_RESOLVED,
        'Dispute Resolved',
        `₹${Math.abs(requesterDelta).toFixed(2)} has been deducted from your wallet per the dispute resolution.`,
        {requestId: dispute.requestId, disputeId, screen: 'DisputeDetail'},
      );
    }
    if (creatorDelta !== 0 && request.creatorId) {
      await notificationService.notifyUser(
        request.creatorId,
        NotificationType.DISPUTE_RESOLVED,
        'Dispute Resolved',
        creatorDelta > 0
          ? `₹${creatorDelta.toFixed(2)} has been credited to your wallet.`
          : `₹${Math.abs(creatorDelta).toFixed(2)} has been deducted from your wallet per the dispute resolution.`,
        {requestId: dispute.requestId, disputeId, screen: 'DisputeDetail'},
      );
    }

    return {...presentDisputeDetail(await loadDisputeDetailOr404(disputeId), true), escrow: await requestEscrowRepository.findByRequestId(dispute.requestId)};
  },

  /** Archives the case — no further fund movement (that already happened via `adminResolve`). */
  async adminClose(adminId: string, disputeId: string, notes: string | undefined) {
    const dispute = await loadDisputeDetailOr404(disputeId);
    if (dispute.status === 'CLOSED') {
      throw new HttpError(409, 'This dispute is already closed.');
    }

    await disputeRepository.update(disputeId, {
      status: 'CLOSED',
      closedAt: new Date(),
      resolutionNotes: notes ?? dispute.resolutionNotes,
    });
    await adminAuditLogService.log(adminId, 'DISPUTE_CLOSED', 'Dispute', disputeId, {notes});

    return presentDisputeDetail(await loadDisputeDetailOr404(disputeId), true);
  },

  /**
   * Reopen a resolved/closed case (interim decision — the PRD doesn't explicitly rule on this;
   * flagged per docs/CLAUDE.md §8 rule 11 convention). Does not touch escrow/wallet state by
   * itself — a reopened case must go through `adminResolve` again to move any further funds,
   * same delta-based math, so no double-payout risk from reopening alone.
   */
  async adminReopen(adminId: string, disputeId: string, reason: string) {
    const dispute = await loadDisputeDetailOr404(disputeId);
    if (dispute.status !== 'RESOLVED' && dispute.status !== 'CLOSED') {
      throw new HttpError(409, 'Only a resolved or closed dispute can be reopened.');
    }

    await disputeRepository.update(disputeId, {
      status: 'REOPENED',
      reopenCount: {increment: 1},
      reopenedAt: new Date(),
      closedAt: null,
    });
    await adminAuditLogService.log(adminId, 'DISPUTE_REOPENED', 'Dispute', disputeId, {reason});

    for (const participantId of [dispute.request.requesterId, dispute.request.creatorId]) {
      if (!participantId) continue;
      await notificationService.notifyUser(
        participantId,
        NotificationType.DISPUTE_REOPENED,
        'Dispute Reopened',
        'Your dispute case has been reopened for further review.',
        {requestId: dispute.requestId, disputeId, screen: 'DisputeDetail'},
      );
    }

    return presentDisputeDetail(await loadDisputeDetailOr404(disputeId), true);
  },
};
