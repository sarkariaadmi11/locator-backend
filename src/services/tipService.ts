import {LedgerReasonCode} from '@prisma/client';

import {BETA_ECONOMY_DEFAULTS} from '../config/betaEconomy';
import {prisma} from '../prisma/client';
import {requestRepository} from '../repositories/requestRepository';
import {transactionRepository} from '../repositories/transactionRepository';
import {HttpError} from '../utils/httpError';
import {ledgerService} from './ledgerService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {SettingsKey, settingsService} from './settingsService';

/**
 * Tipping (PRD_TRD_SUMMARY.md §3.3, §4.13, backend Phase 2 item 6). Optional, post-Completed,
 * non-blocking, one-way Requester -> Creator. 100% to Creator, zero commission in any mode —
 * unlike `escrowService.release`, no commission split is ever applied here. One tip per request
 * (`Tip.requestId` is `@unique`), 7-day window from the Requester's completion decision.
 *
 * Branches on `request.currencyMode`: CREDIT mode debits via `ledgerService` (the v2.1 Beta
 * path); INR mode mirrors `escrowService.release`'s existing `walletBalance`/`Transaction`
 * pattern (today's only reachable path, since Phase 2 item 5 — currency-aware escrow — hasn't
 * landed yet and every existing request is still `currencyMode: INR`). Both branches are wired
 * now so INR-mode tipping works today and CREDIT-mode tipping works the moment item 5 starts
 * producing CREDIT-mode requests, with no further change needed here.
 */
export const tipService = {
  async tip(requesterId: string, requestId: string, amount: number) {
    const request = await requestRepository.findById(requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }
    if (request.requesterId !== requesterId) {
      throw new HttpError(403, 'Only the Requester can tip on this request.');
    }
    if (request.status !== 'COMPLETED') {
      throw new HttpError(409, 'You can only tip after the request is completed.');
    }
    if (!request.creatorId) {
      throw new HttpError(409, 'This request has no assigned Creator to tip.');
    }

    const existing = await prisma.tip.findUnique({where: {requestId}});
    if (existing) {
      throw new HttpError(409, 'You have already tipped on this request.');
    }

    // Admin-configurable bounds/window (PRD §7.3, backend Phase 6) — authoritative here, not in
    // the zod schema, since that runs before any settings read is possible (see tipValidation.ts).
    const [tipMin, tipMax, tipWindowDays] = await Promise.all([
      settingsService.getNumber(SettingsKey.TIP_MIN, BETA_ECONOMY_DEFAULTS.TIP_MIN),
      settingsService.getNumber(SettingsKey.TIP_MAX, BETA_ECONOMY_DEFAULTS.TIP_MAX),
      settingsService.getNumber(SettingsKey.TIP_WINDOW_DAYS, BETA_ECONOMY_DEFAULTS.TIP_WINDOW_DAYS),
    ]);
    if (amount < tipMin || amount > tipMax) {
      throw new HttpError(400, `Tip amount must be between ${tipMin} and ${tipMax}.`);
    }

    // requesterDecisionAt is stamped at the same moment the request transitions to COMPLETED
    // (requesterReviewService.acceptVideo chains straight through) — the nearest available
    // "completed at" timestamp on this row.
    const completedAt = request.requesterDecisionAt ?? request.updatedAt;
    if (Date.now() - completedAt.getTime() > tipWindowDays * 24 * 60 * 60 * 1000) {
      throw new HttpError(409, `The ${tipWindowDays}-day tipping window for this request has closed.`);
    }

    const creatorId = request.creatorId;

    if (request.currencyMode === 'CREDIT') {
      await ledgerService.debitCredits(requesterId, amount, LedgerReasonCode.TIP_SENT, {
        requestId,
        idempotencyKey: `tip_debit_${requestId}`,
      });
      await ledgerService.creditCredits(creatorId, amount, 'earned', LedgerReasonCode.TIP_RECEIVED, {
        requestId,
        idempotencyKey: `tip_credit_${requestId}`,
      });
    } else {
      const requester = await prisma.user.findUnique({where: {id: requesterId}, select: {walletBalance: true}});
      if (!requester || Number(requester.walletBalance) < amount) {
        throw new HttpError(402, 'Insufficient wallet balance to send this tip.');
      }

      await transactionRepository.runTransaction([
        prisma.user.update({where: {id: requesterId}, data: {walletBalance: {decrement: amount}}}),
        prisma.transaction.create({
          data: {userId: requesterId, type: 'DEBIT', status: 'SUCCESS', amount, description: 'Tip sent', requestId},
        }),
        prisma.user.update({where: {id: creatorId}, data: {walletBalance: {increment: amount}}}),
        prisma.transaction.create({
          data: {userId: creatorId, type: 'CREDIT', status: 'SUCCESS', amount, description: 'Tip received', requestId},
        }),
      ]);
    }

    const tip = await prisma.tip.create({
      data: {requestId, fromUserId: requesterId, amount},
    });

    await notificationService.notifyUser(
      creatorId,
      NotificationType.TIP_RECEIVED,
      'You received a tip!',
      `The Requester sent you a tip of ${amount} ${request.currencyMode === 'CREDIT' ? 'Credits' : 'INR'}.`,
      {requestId, amount: String(amount), screen: 'Wallet'},
    );

    return tip;
  },

  async getForRequest(requestId: string) {
    return prisma.tip.findUnique({where: {requestId}});
  },
};
