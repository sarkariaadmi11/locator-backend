import {prisma} from '../prisma/client';
import {requestEscrowRepository} from '../repositories/requestEscrowRepository';
import {requestRepository} from '../repositories/requestRepository';
import {transactionRepository} from '../repositories/transactionRepository';
import {HttpError} from '../utils/httpError';
import {presentRequestEscrow} from '../utils/requestEscrowPresenter';
import {adminAuditLogService} from './adminAuditLogService';
import {ComplianceConfigKey, complianceConfigService} from './complianceConfigService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
// Reused as the "large refund" admin-alert threshold (backend Phase 12) — no separate PRD number
// exists for this, so the existing high-value-review threshold is the nearest documented
// [REVIEW] value rather than inventing a new one silently (docs/CLAUDE.md §8 rule 11).
import {REQUEST_HIGH_VALUE_THRESHOLD as LARGE_REFUND_THRESHOLD} from '../validations/requestValidation';
import {splitCommission} from '../utils/money';

/**
 * Escrow & Payment Release (PRD §7.1, §7.2, §5.2, §5.14.5, backend Phase 8). Reuses the same
 * ledger mechanics as walletService/adminService (`transactionRepository.runTransaction` — a
 * plain array of independent Prisma operations run inside one `$transaction`), just against the
 * Creator/Requester's `walletBalance` instead of a standalone deposit/payout.
 */
export const escrowService = {
  /**
   * Reserves escrow for a newly created Request — debits the Requester's wallet by the full
   * reward amount and creates the `RequestEscrow` row (RESERVED). Caller (`requestService.create`)
   * is responsible for the upfront sufficient-balance check so a failed reservation never leaves
   * a Request row without a matching escrow.
   */
  async reserve(requestId: string, requesterId: string, amount: number) {
    // Commission Settings (backend Phase 11) — Admin-configurable via
    // `GET/PATCH /admin/compliance/config[/COMMISSION_RATE_PERCENT]`, snapshotted onto the
    // escrow row below so a later Admin change never retroactively alters this reservation.
    const commissionRatePercent = await complianceConfigService.getNumber(ComplianceConfigKey.COMMISSION_RATE_PERCENT);
    const {commissionAmount, creatorEarnings} = splitCommission(amount, commissionRatePercent);

    const [, , escrow] = await transactionRepository.runTransaction([
      prisma.user.update({
        where: {id: requesterId},
        data: {walletBalance: {decrement: amount}},
      }),
      prisma.transaction.create({
        data: {
          userId: requesterId,
          type: 'DEBIT',
          status: 'SUCCESS',
          amount,
          description: 'Escrow reserved for request',
          requestId,
        },
      }),
      prisma.requestEscrow.create({
        data: {
          requestId,
          amountLocked: amount,
          commissionRate: commissionRatePercent,
          commissionAmount,
          creatorEarnings,
          state: 'RESERVED',
        },
      }),
    ]);

    await notificationService.notifyUser(
      requesterId,
      NotificationType.ESCROW_RESERVED,
      'Escrow reserved',
      `₹${amount.toFixed(2)} has been locked in escrow for your request.`,
      {requestId, amount: amount.toFixed(2), screen: 'RequestDetail'},
    );

    return escrow;
  },

  /**
   * Releases escrow to the Creator (minus platform commission) — called automatically from
   * `requesterReviewService.acceptVideo` (ACCEPTED -> PAYMENT_RELEASED -> COMPLETED), and
   * reusable as-is for an Admin manual override (§5.14.5) since it only gates on the escrow's
   * own state, not the Request's current status.
   */
  async release(requestId: string) {
    const escrow = await requestEscrowRepository.findByRequestId(requestId);
    if (!escrow) {
      throw new HttpError(404, 'No escrow exists for this request.');
    }
    if (escrow.state !== 'RESERVED') {
      throw new HttpError(409, `Escrow cannot be released from state ${escrow.state}.`);
    }

    const request = await requestRepository.findById(requestId);
    if (!request?.creatorId) {
      throw new HttpError(409, 'This request has no assigned Creator to pay out.');
    }

    const now = new Date();
    const [, , updatedEscrow] = await transactionRepository.runTransaction([
      prisma.user.update({
        where: {id: request.creatorId},
        data: {walletBalance: {increment: escrow.creatorEarnings}},
      }),
      prisma.transaction.create({
        data: {
          userId: request.creatorId,
          type: 'CREDIT',
          status: 'SUCCESS',
          amount: escrow.creatorEarnings,
          description: 'Payment released for completed request',
          requestId,
        },
      }),
      prisma.requestEscrow.update({
        where: {id: escrow.id},
        data: {state: 'RELEASED', releasedAt: now, settledAt: now},
      }),
    ]);

    await notificationService.notifyUser(
      request.creatorId,
      NotificationType.PAYMENT_RELEASED,
      'Payment Released',
      `₹${Number(escrow.creatorEarnings).toFixed(2)} has been credited to your wallet.`,
      {requestId, amount: Number(escrow.creatorEarnings).toFixed(2), screen: 'Wallet'},
    );

    return updatedEscrow;
  },

  /**
   * Refunds the locked reward back to the Requester — called from pre-acceptance cancel,
   * Requester rejection, and the expiry sweep, and reusable as-is for an Admin manual override.
   */
  async refund(requestId: string) {
    const escrow = await requestEscrowRepository.findByRequestId(requestId);
    if (!escrow) {
      throw new HttpError(404, 'No escrow exists for this request.');
    }
    if (escrow.state !== 'RESERVED') {
      throw new HttpError(409, `Escrow cannot be refunded from state ${escrow.state}.`);
    }

    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    const now = new Date();
    const [, , updatedEscrow] = await transactionRepository.runTransaction([
      prisma.user.update({
        where: {id: request.requesterId},
        data: {walletBalance: {increment: escrow.amountLocked}},
      }),
      prisma.transaction.create({
        data: {
          userId: request.requesterId,
          type: 'CREDIT',
          status: 'SUCCESS',
          amount: escrow.amountLocked,
          description: 'Refund for cancelled/rejected/expired request',
          requestId,
        },
      }),
      prisma.requestEscrow.update({
        where: {id: escrow.id},
        data: {state: 'REFUNDED', refundAmount: escrow.amountLocked, refundedAt: now, settledAt: now},
      }),
    ]);

    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.REFUND_ISSUED,
      'Refund Issued',
      `₹${Number(escrow.amountLocked).toFixed(2)} has been refunded to your wallet.`,
      {requestId, amount: Number(escrow.amountLocked).toFixed(2), screen: 'Wallet'},
    );

    if (Number(escrow.amountLocked) >= LARGE_REFUND_THRESHOLD) {
      await notificationService.notifyAdmins(
        NotificationType.LARGE_REFUND,
        'Large refund issued',
        `₹${Number(escrow.amountLocked).toFixed(2)} was refunded for request ${requestId}.`,
        {requestId, amount: Number(escrow.amountLocked).toFixed(2)},
      );
    }

    return updatedEscrow;
  },

  /**
   * Freezes a still-`RESERVED` escrow the moment a Dispute is raised (backend Phase 11) —
   * blocks any further automatic release/refund (both gate on `state !== 'RESERVED'`). A no-op
   * if the escrow already settled (`RELEASED`/`REFUNDED`) before the dispute was raised, or is
   * already `FROZEN`/`SPLIT` — disputeService's delta-based resolution math handles reversing an
   * already-settled outcome itself, it doesn't depend on this freeze having taken effect.
   */
  async freeze(requestId: string) {
    const escrow = await requestEscrowRepository.findByRequestId(requestId);
    if (!escrow || escrow.state !== 'RESERVED') {
      return escrow;
    }
    return requestEscrowRepository.update(escrow.id, {state: 'FROZEN'});
  },

  /** `GET /requests/:id/escrow` — Requester or the assigned Creator only. */
  async getForParticipant(userId: string, requestId: string) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    if (request.requesterId !== userId && request.creatorId !== userId) {
      throw new HttpError(403, 'You are not a participant in this request.');
    }

    const escrow = await requestEscrowRepository.findByRequestId(requestId);
    if (!escrow) {
      throw new HttpError(404, 'No escrow exists for this request.');
    }
    return presentRequestEscrow(escrow);
  },

  // --- Admin (PRD §5.14.5 Refund Management, Finance Management) -------------------------

  async adminList(filters: {state?: 'RESERVED' | 'RELEASED' | 'REFUNDED' | 'FROZEN' | 'SPLIT'; requestId?: string}, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = {
      ...(filters.state ? {state: filters.state} : {}),
      ...(filters.requestId ? {requestId: filters.requestId} : {}),
    };

    const [items, total] = await Promise.all([
      requestEscrowRepository.findMany({
        where,
        orderBy: {createdAt: 'desc'},
        skip,
        take: limit,
        include: {
          request: {
            select: {id: true, description: true, status: true, requesterId: true, creatorId: true},
          },
        },
      }),
      requestEscrowRepository.count(where),
    ]);

    return {
      items: items.map(item => ({...presentRequestEscrow(item), request: item.request})),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async adminDetail(requestId: string) {
    const escrow = await requestEscrowRepository.findByRequestId(requestId);
    if (!escrow) {
      throw new HttpError(404, 'No escrow exists for this request.');
    }
    const request = await requestRepository.findById(requestId);
    return {...presentRequestEscrow(escrow), request};
  },

  /** Financial audit summary (PRD §5.14.5) — totals across every escrow state. */
  async adminSummary() {
    const [reserved, released, refunded] = await Promise.all([
      requestEscrowRepository.aggregateSum({state: 'RESERVED'}),
      requestEscrowRepository.aggregateSum({state: 'RELEASED'}),
      requestEscrowRepository.aggregateSum({state: 'REFUNDED'}),
    ]);

    return {
      totalLocked: Number(reserved._sum.amountLocked ?? 0),
      totalCommissionEarned: Number(released._sum.commissionAmount ?? 0),
      totalPaidToCreators: Number(released._sum.creatorEarnings ?? 0),
      totalRefunded: Number(refunded._sum.refundAmount ?? 0),
    };
  },

  /** Manual override — Admin can release any still-RESERVED escrow regardless of the Request's current status. */
  async adminRelease(adminId: string, requestId: string, reason: string) {
    const escrow = await this.release(requestId);
    await adminAuditLogService.log(adminId, 'ESCROW_RELEASED_MANUAL', 'RequestEscrow', escrow.id, {requestId, reason});
    return presentRequestEscrow(escrow);
  },

  /** Manual override — Admin can refund any still-RESERVED escrow regardless of the Request's current status. */
  async adminRefund(adminId: string, requestId: string, reason: string) {
    const escrow = await this.refund(requestId);
    await adminAuditLogService.log(adminId, 'ESCROW_REFUNDED_MANUAL', 'RequestEscrow', escrow.id, {requestId, reason});
    return presentRequestEscrow(escrow);
  },
};
