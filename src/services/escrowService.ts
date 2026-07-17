import {EscrowCurrency} from '@prisma/client';

import {BETA_ECONOMY_DEFAULTS} from '../config/betaEconomy';
import {prisma} from '../prisma/client';
import {requestEscrowRepository} from '../repositories/requestEscrowRepository';
import {requestRepository} from '../repositories/requestRepository';
import {transactionRepository} from '../repositories/transactionRepository';
import {HttpError} from '../utils/httpError';
import {presentRequestEscrow} from '../utils/requestEscrowPresenter';
import {adminAuditLogService} from './adminAuditLogService';
import {ComplianceConfigKey, complianceConfigService} from './complianceConfigService';
import {ledgerService} from './ledgerService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {SettingsKey, settingsService} from './settingsService';
// Reused as the "large refund" admin-alert threshold (backend Phase 12) — no separate PRD number
// exists for this, so the existing high-value-review threshold is the nearest documented
// [REVIEW] value rather than inventing a new one silently (docs/CLAUDE.md §8 rule 11).
import {REQUEST_HIGH_VALUE_THRESHOLD as LARGE_REFUND_THRESHOLD} from '../validations/requestValidation';
import {round2, splitCommission} from '../utils/money';

function formatAmount(amount: number, currency: EscrowCurrency): string {
  return currency === 'CREDIT' ? `${amount} Credits` : `₹${amount.toFixed(2)}`;
}

/**
 * Escrow & Payment Release (PRD §7.1, §7.2, §5.2, §5.14.5, backend Phase 8). Reuses the same
 * ledger mechanics as walletService/adminService (`transactionRepository.runTransaction` — a
 * plain array of independent Prisma operations run inside one `$transaction`), just against the
 * Creator/Requester's `walletBalance` instead of a standalone deposit/payout.
 */
export const escrowService = {
  /**
   * Reserves escrow for a newly created Request — debits the Requester by the full reward
   * amount (Credits via `ledgerService`, or INR via `walletBalance`/`Transaction`, per
   * `currency`) and creates the `RequestEscrow` row (RESERVED). Caller (`requestService.create`)
   * is responsible for the upfront sufficient-balance check so a failed reservation never leaves
   * a Request row without a matching escrow.
   *
   * CREDIT mode (v2.1 Beta, backend Phase 2 item 5): zero commission, and `creatorEarnings` is
   * the independently-configured Creator Reward (PRD §7.3 `creator_reward`, default 150 —
   * *not* derived from `amount`/Request Cost, even though they're equal by default) rather than
   * a commission split of the held amount.
   */
  async reserve(requestId: string, requesterId: string, amount: number, currency: EscrowCurrency = 'INR') {
    if (currency === 'CREDIT') {
      await ledgerService.debitCredits(requesterId, amount, 'REQUEST_HOLD', {requestId});

      const creatorReward = await settingsService.getNumber(
        SettingsKey.CREATOR_REWARD_CREDITS,
        BETA_ECONOMY_DEFAULTS.CREATOR_REWARD_CREDITS,
      );
      const escrow = await prisma.requestEscrow.create({
        data: {
          requestId,
          currency: 'CREDIT',
          amountLocked: amount,
          commissionRate: 0,
          commissionAmount: 0,
          creatorEarnings: creatorReward,
          state: 'RESERVED',
        },
      });

      await notificationService.notifyUser(
        requesterId,
        NotificationType.ESCROW_RESERVED,
        'Escrow reserved',
        `${formatAmount(amount, 'CREDIT')} has been reserved for your request.`,
        {requestId, amount: String(amount), screen: 'RequestDetail'},
      );

      return escrow;
    }

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
          currency: 'INR',
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
      `${formatAmount(amount, 'INR')} has been locked in escrow for your request.`,
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
    const creatorEarnings = Number(escrow.creatorEarnings);

    let updatedEscrow;
    if (escrow.currency === 'CREDIT') {
      await ledgerService.creditCredits(request.creatorId, creatorEarnings, 'earned', 'CREATOR_REWARD', {requestId});
      updatedEscrow = await prisma.requestEscrow.update({
        where: {id: escrow.id},
        data: {state: 'RELEASED', releasedAt: now, settledAt: now},
      });
    } else {
      const [, , escrowRow] = await transactionRepository.runTransaction([
        prisma.user.update({
          where: {id: request.creatorId},
          data: {walletBalance: {increment: creatorEarnings}},
        }),
        prisma.transaction.create({
          data: {
            userId: request.creatorId,
            type: 'CREDIT',
            status: 'SUCCESS',
            amount: creatorEarnings,
            description: 'Payment released for completed request',
            requestId,
          },
        }),
        prisma.requestEscrow.update({
          where: {id: escrow.id},
          data: {state: 'RELEASED', releasedAt: now, settledAt: now},
        }),
      ]);
      updatedEscrow = escrowRow;
    }

    await notificationService.notifyUser(
      request.creatorId,
      NotificationType.PAYMENT_RELEASED,
      'Payment Released',
      `${formatAmount(creatorEarnings, escrow.currency)} has been credited to your wallet.`,
      {requestId, amount: creatorEarnings.toFixed(2), screen: 'Wallet'},
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
    const amountLocked = Number(escrow.amountLocked);

    let updatedEscrow;
    if (escrow.currency === 'CREDIT') {
      // Refunded to the `bonus` bucket by convention (backend Phase 2 item 5 decision): Credits
      // have no cash value in Beta Mode (PRD_TRD_SUMMARY.md §8.4 — "not money" while
      // allow_cash_withdrawal=OFF), so the earned/bonus/purchased distinction has no withdrawal
      // consequence yet; refunding to `bonus` keeps refunded Credits first-in-line to be spent
      // again (matches spend order) without inflating `earnedCredits`, which Phase 9 will make
      // withdrawal-relevant. Revisit if/when Beta Credits ever become independently convertible.
      await ledgerService.creditCredits(request.requesterId, amountLocked, 'bonus', 'REQUEST_REFUND', {requestId});
      updatedEscrow = await prisma.requestEscrow.update({
        where: {id: escrow.id},
        data: {state: 'REFUNDED', refundAmount: amountLocked, refundedAt: now, settledAt: now},
      });
    } else {
      const [, , escrowRow] = await transactionRepository.runTransaction([
        prisma.user.update({
          where: {id: request.requesterId},
          data: {walletBalance: {increment: amountLocked}},
        }),
        prisma.transaction.create({
          data: {
            userId: request.requesterId,
            type: 'CREDIT',
            status: 'SUCCESS',
            amount: amountLocked,
            description: 'Refund for cancelled/rejected/expired request',
            requestId,
          },
        }),
        prisma.requestEscrow.update({
          where: {id: escrow.id},
          data: {state: 'REFUNDED', refundAmount: amountLocked, refundedAt: now, settledAt: now},
        }),
      ]);
      updatedEscrow = escrowRow;
    }

    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.REFUND_ISSUED,
      'Refund Issued',
      `${formatAmount(amountLocked, escrow.currency)} has been refunded to your wallet.`,
      {requestId, amount: amountLocked.toFixed(2), screen: 'Wallet'},
    );

    if (escrow.currency === 'INR' && amountLocked >= LARGE_REFUND_THRESHOLD) {
      await notificationService.notifyAdmins(
        NotificationType.LARGE_REFUND,
        'Large refund issued',
        `₹${amountLocked.toFixed(2)} was refunded for request ${requestId}.`,
        {requestId, amount: amountLocked.toFixed(2)},
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

  /**
   * Financial audit summary (PRD §5.14.5) — totals across every escrow state, **INR only**.
   * Backend Phase 2 item 5 note: now that `RequestEscrow` can hold Credits or INR, summing both
   * currencies into one number would be misleading (they're not fungible) — this stays INR-only
   * until the Admin Panel's Feature Flags/Economy Settings dashboard (Phase 6) adds a proper
   * per-currency breakdown. `adminList`/`adminDetail` already expose `currency` per-row for
   * anyone who needs the Credits-side figures in the meantime.
   */
  async adminSummary() {
    const [reserved, released, refunded] = await Promise.all([
      requestEscrowRepository.aggregateSum({state: 'RESERVED', currency: 'INR'}),
      requestEscrowRepository.aggregateSum({state: 'RELEASED', currency: 'INR'}),
      requestEscrowRepository.aggregateSum({state: 'REFUNDED', currency: 'INR'}),
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

  /**
   * Manual override — Admin refunds only part of a still-RESERVED escrow to the Requester; the
   * remainder is released to the assigned Creator (minus commission), same split-math
   * (`splitCommission`) `reserve` uses for a fresh reservation. PRD §5.14.5/§5.14.6 "Refund
   * Management (full/partial, logged reason)" — `refund`/`adminRefund` above remain the
   * full-refund path; this is the partial one, kept as a separate method rather than an
   * amount-optional param on `refund` since it moves money on *both* sides (unlike a full
   * refund, which only ever touches the Requester) and every other caller of `refund` (cancel,
   * rejection, expiry sweep) must never partially refund.
   */
  async adminPartialRefund(adminId: string, requestId: string, refundAmount: number, reason: string) {
    const escrow = await requestEscrowRepository.findByRequestId(requestId);
    if (!escrow) {
      throw new HttpError(404, 'No escrow exists for this request.');
    }
    if (escrow.state !== 'RESERVED') {
      throw new HttpError(409, `Escrow cannot be refunded from state ${escrow.state}.`);
    }

    const amountLocked = Number(escrow.amountLocked);
    if (refundAmount <= 0 || refundAmount >= amountLocked) {
      throw new HttpError(
        400,
        `Partial refund amount must be greater than 0 and less than the locked amount (${amountLocked}). Use the full refund action to refund the entire amount.`,
      );
    }

    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    if (!request.creatorId) {
      throw new HttpError(409, 'This request has no assigned Creator to release the remainder to — use a full refund instead.');
    }

    const now = new Date();
    const creatorGross = round2(amountLocked - refundAmount);
    const {commissionAmount, creatorEarnings} =
      escrow.currency === 'CREDIT' ? {commissionAmount: 0, creatorEarnings: creatorGross} : splitCommission(creatorGross, Number(escrow.commissionRate));

    let updatedEscrow;
    if (escrow.currency === 'CREDIT') {
      await ledgerService.creditCredits(request.requesterId, refundAmount, 'bonus', 'REQUEST_REFUND', {requestId});
      await ledgerService.creditCredits(request.creatorId, creatorEarnings, 'earned', 'CREATOR_REWARD', {requestId});
      updatedEscrow = await prisma.requestEscrow.update({
        where: {id: escrow.id},
        data: {
          state: 'SPLIT',
          refundAmount,
          creatorEarnings,
          commissionAmount,
          releasedAt: now,
          refundedAt: now,
          settledAt: now,
        },
      });
    } else {
      const [, , , , escrowRow] = await transactionRepository.runTransaction([
        prisma.user.update({where: {id: request.requesterId}, data: {walletBalance: {increment: refundAmount}}}),
        prisma.transaction.create({
          data: {
            userId: request.requesterId,
            type: 'CREDIT',
            status: 'SUCCESS',
            amount: refundAmount,
            description: 'Partial refund (Admin override)',
            requestId,
          },
        }),
        prisma.user.update({where: {id: request.creatorId}, data: {walletBalance: {increment: creatorEarnings}}}),
        prisma.transaction.create({
          data: {
            userId: request.creatorId,
            type: 'CREDIT',
            status: 'SUCCESS',
            amount: creatorEarnings,
            description: 'Partial payment release (Admin override)',
            requestId,
          },
        }),
        prisma.requestEscrow.update({
          where: {id: escrow.id},
          data: {
            state: 'SPLIT',
            refundAmount,
            creatorEarnings,
            commissionAmount,
            releasedAt: now,
            refundedAt: now,
            settledAt: now,
          },
        }),
      ]);
      updatedEscrow = escrowRow;
    }

    await notificationService.notifyUser(
      request.requesterId,
      NotificationType.REFUND_ISSUED,
      'Partial Refund Issued',
      `${formatAmount(refundAmount, escrow.currency)} has been refunded to your wallet.`,
      {requestId, amount: refundAmount.toFixed(2), screen: 'Wallet'},
    );
    await notificationService.notifyUser(
      request.creatorId,
      NotificationType.PAYMENT_RELEASED,
      'Partial Payment Released',
      `${formatAmount(creatorEarnings, escrow.currency)} has been credited to your wallet.`,
      {requestId, amount: creatorEarnings.toFixed(2), screen: 'Wallet'},
    );

    await adminAuditLogService.log(adminId, 'ESCROW_PARTIAL_REFUND_MANUAL', 'RequestEscrow', escrow.id, {
      requestId,
      reason,
      refundAmount,
      creatorEarnings,
    });

    return presentRequestEscrow(updatedEscrow);
  },
};
