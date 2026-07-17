import crypto from 'crypto';

import Razorpay from 'razorpay';

import {env} from '../config/env';
import {logger} from '../config/logger';
import {prisma} from '../prisma/client';
import {payoutRequestRepository} from '../repositories/payoutRequestRepository';
import {transactionRepository} from '../repositories/transactionRepository';
import {ledgerService} from './ledgerService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {settingsService} from './settingsService';
import {HttpError} from '../utils/httpError';
import {presentUser} from '../utils/userPresenter';

/**
 * v2.1 real-money gate (PRD_TRD_SUMMARY.md §1, backend Phase 2 item 4, docs/CLAUDE.md §2.1).
 * Beta Mode (the v2.1 default launch mode) has no real-money top-up/withdrawal at all — only
 * these three Razorpay-backed flows are gated; escrow/request creation remain unconditional
 * INR until Phase 2 item 5 (currency-aware escrow) lands.
 */
function assertRealMoneyEnabled() {
  if (!env.ENABLE_REAL_MONEY) {
    throw new HttpError(403, 'Real-money wallet features are disabled in Beta Mode.');
  }
}

const razorpay = new Razorpay({
  key_id: env.RAZORPAY_KEY_ID,
  key_secret: env.RAZORPAY_KEY_SECRET,
});

/** A stale PENDING order is eligible for reconciliation after this long. */
const PENDING_RECONCILE_AFTER_MS = 30 * 60 * 1000;

function timingSafeEqualHex(expectedHex: string, providedHex: string): boolean {
  try {
    const expectedBuffer = Buffer.from(expectedHex, 'hex');
    const providedBuffer = Buffer.from(providedHex, 'hex');
    return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

export const walletService = {
  /**
   * v2.1 dual-currency wallet view (PRD_TRD_SUMMARY.md §4.3, backend Phase 2). Also opportunistically
   * grants the Daily Free Connects bonus if due today (TRD 9 "event-driven, on first API call of
   * the day" — GET /wallet is the natural hook since mobile fetches it on every app-open).
   */
  async getWallet(userId: string) {
    await ledgerService.grantDailyConnectBonusIfDue(userId);
    const balances = await ledgerService.getBalances(userId);
    // v2.1 client mode-detection signal (PRD_TRD_SUMMARY.md §1, mobile Phase 0 gap — no public
    // endpoint exposed which economy mode is active until this addition). Runtime/server-driven
    // per the mobile plan's own recommendation, so a mode switch never needs an app store release.
    return {...balances, realMoneyEnabled: env.ENABLE_REAL_MONEY};
  },

  async createOrder(userId: string, amount: number) {
    assertRealMoneyEnabled();
    let order;
    try {
      order = await razorpay.orders.create({
        amount: Math.round(amount * 100), // paise
        currency: 'INR',
        receipt: `rcpt_${userId.slice(0, 8)}_${Date.now()}`,
      });
    } catch (err) {
      const razorpayError = err as {statusCode?: number; error?: {code?: string; description?: string}};
      logger.error(
        `[walletService.createOrder] Razorpay order creation failed. ` +
          `status=${razorpayError.statusCode ?? 'unknown'} code=${razorpayError.error?.code ?? 'unknown'} ` +
          `description=${razorpayError.error?.description ?? (err as Error).message}`,
      );
      throw new HttpError(502, 'Unable to start payment right now. Please try again shortly.');
    }

    await transactionRepository.create({
      user: {connect: {id: userId}},
      type: 'CREDIT',
      amount,
      status: 'PENDING',
      razorpayOrderId: order.id,
      description: 'Add money to wallet',
    });

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: env.RAZORPAY_KEY_ID,
    };
  },

  async verifyPayment(
    userId: string,
    razorpayOrderId: string,
    razorpayPaymentId: string,
    razorpaySignature: string,
  ) {
    assertRealMoneyEnabled();
    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (!timingSafeEqualHex(expected, razorpaySignature)) {
      throw new HttpError(400, 'Payment verification failed. Invalid signature.');
    }

    const transaction = await transactionRepository.findPendingByOrderId(userId, razorpayOrderId);

    if (!transaction) {
      throw new HttpError(404, 'Pending transaction not found.');
    }

    const [, user] = await transactionRepository.runTransaction([
      prisma.transaction.update({
        where: {id: transaction.id},
        data: {status: 'SUCCESS', razorpayPaymentId},
      }),
      prisma.user.update({
        where: {id: userId},
        data: {walletBalance: {increment: transaction.amount}},
      }),
    ]);

    return presentUser(user as Parameters<typeof presentUser>[0]);
  },

  /**
   * Server-side reconciliation for a Razorpay payment event, independent of the client
   * ever calling /verify-payment. Idempotent: re-delivered events for an already-resolved
   * transaction are safe no-ops (the conditional update touches 0 rows).
   */
  async reconcilePayment(razorpayOrderId: string, razorpayPaymentId: string | undefined, outcome: 'captured' | 'failed') {
    const transaction = await transactionRepository.findByOrderId(razorpayOrderId);

    if (!transaction) {
      logger.warn(`[walletService.reconcilePayment] No transaction found for order ${razorpayOrderId}.`);
      return {reconciled: false, reason: 'transaction_not_found' as const};
    }

    if (transaction.status !== 'PENDING') {
      logger.info(
        `[walletService.reconcilePayment] Transaction ${transaction.id} already ${transaction.status} — skipping (idempotent).`,
      );
      return {reconciled: false, reason: 'already_resolved' as const};
    }

    if (outcome === 'captured') {
      const [updateResult] = await transactionRepository.runTransaction([
        prisma.transaction.updateMany({
          where: {id: transaction.id, status: 'PENDING'},
          data: {status: 'SUCCESS', ...(razorpayPaymentId ? {razorpayPaymentId} : {})},
        }),
        prisma.user.updateMany({
          where: {id: transaction.userId},
          data: {walletBalance: {increment: transaction.amount}},
        }),
      ]);

      if ((updateResult as {count: number}).count === 0) {
        // Lost the race to another concurrent reconciliation attempt — already handled.
        return {reconciled: false, reason: 'already_resolved' as const};
      }

      logger.info(`[walletService.reconcilePayment] Transaction ${transaction.id} marked SUCCESS via webhook.`);
      return {reconciled: true, transactionId: transaction.id};
    }

    const failResult = await transactionRepository.markFailedIfPending(transaction.id);
    if (failResult.count === 0) {
      return {reconciled: false, reason: 'already_resolved' as const};
    }

    logger.info(`[walletService.reconcilePayment] Transaction ${transaction.id} marked FAILED via webhook.`);
    return {reconciled: true, transactionId: transaction.id};
  },

  /**
   * Handles a verified Razorpay webhook payload. Signature verification happens in the
   * controller (needs the raw request body); this only interprets already-trusted events.
   */
  async handleWebhookEvent(event: string, payload: {
    payment?: {entity?: {order_id?: string; id?: string}};
  }) {
    const orderId = payload.payment?.entity?.order_id;
    const paymentId = payload.payment?.entity?.id;

    if (!orderId) {
      logger.warn(`[walletService.handleWebhookEvent] Event "${event}" had no order_id — ignoring.`);
      return {handled: false};
    }

    if (event === 'payment.captured') {
      return this.reconcilePayment(orderId, paymentId, 'captured');
    }

    if (event === 'payment.failed') {
      return this.reconcilePayment(orderId, paymentId, 'failed');
    }

    logger.info(`[walletService.handleWebhookEvent] Unhandled event type "${event}" — ignoring.`);
    return {handled: false};
  },

  /**
   * Finds PENDING deposit transactions older than the reconciliation window and asks
   * Razorpay directly for the order's true payment status, so an abandoned client
   * (app closed after paying, before calling /verify-payment) doesn't stay PENDING forever.
   */
  async reconcileStalePendingTransactions() {
    const cutoff = new Date(Date.now() - PENDING_RECONCILE_AFTER_MS);
    const stale = await transactionRepository.findPendingOlderThan(cutoff);

    const results = await Promise.allSettled(
      stale.map(async txn => {
        if (!txn.razorpayOrderId) return {id: txn.id, outcome: 'skipped' as const};

        const payments = await razorpay.orders.fetchPayments(txn.razorpayOrderId);
        const capturedPayment = payments.items.find(p => p.status === 'captured');
        const failedPayment = payments.items.find(p => p.status === 'failed');

        if (capturedPayment) {
          await this.reconcilePayment(txn.razorpayOrderId, capturedPayment.id, 'captured');
          return {id: txn.id, outcome: 'captured' as const};
        }

        if (failedPayment && payments.items.every(p => p.status !== 'captured')) {
          await this.reconcilePayment(txn.razorpayOrderId, failedPayment.id, 'failed');
          return {id: txn.id, outcome: 'failed' as const};
        }

        return {id: txn.id, outcome: 'still_pending' as const};
      }),
    );

    return {
      checked: stale.length,
      results: results.map(r => (r.status === 'fulfilled' ? r.value : {outcome: 'error' as const})),
    };
  },

  async withdraw(userId: string, amount: number) {
    assertRealMoneyEnabled();
    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user) {
      throw new HttpError(404, 'User not found.');
    }

    if (Number(user.walletBalance) < amount) {
      throw new HttpError(400, 'Insufficient wallet balance.');
    }

    const existing = await payoutRequestRepository.findPendingForUser(userId);
    if (existing) {
      throw new HttpError(409, 'You already have a pending payout request.');
    }

    const payout = await payoutRequestRepository.create({
      user: {connect: {id: userId}},
      amount,
    });

    // Auto-Payout Toggle (PRD §5.14.5/§4.8/§9.2 "Auto-Payout Toggle. Payout approval queue when
    // OFF."). ON: process immediately below, same debit mechanism the Admin "approve" action
    // uses (`adminService.processPayout`) — this codebase has no RazorpayX payout-API
    // integration yet (only Razorpay Checkout for top-up), so "auto-processed" here means
    // "auto-approved, skipping the manual admin queue," matching every other admin-approval
    // action's actual money-movement mechanism. OFF (default, current-only behavior until this
    // toggle exists): unchanged — PENDING queue entry, admin notified.
    if (await settingsService.isAutoPayoutEnabled()) {
      await transactionRepository.runTransaction([
        prisma.payoutRequest.update({
          where: {id: payout.id},
          data: {status: 'APPROVED', adminNote: 'Auto-processed (Auto-Payout Toggle ON)', processedAt: new Date()},
        }),
        prisma.transaction.create({
          data: {
            userId,
            type: 'DEBIT',
            amount,
            status: 'SUCCESS',
            description: 'Payout withdrawal auto-processed',
          },
        }),
        prisma.user.update({
          where: {id: userId},
          data: {walletBalance: {decrement: amount}},
        }),
      ]);

      await notificationService.notifyUser(
        userId,
        NotificationType.PAYOUT_APPROVED,
        'Withdrawal Processed ✓',
        `Your withdrawal of ₹${amount.toFixed(2)} has been processed and deducted from your wallet.`,
        {payoutId: payout.id, amount: amount.toFixed(2), screen: 'Wallet'},
      );

      return {message: 'Payout processed automatically.'};
    }

    await notificationService.notifyAdmins(
      NotificationType.PAYOUT_REQUEST,
      'New Withdrawal Request',
      `${user.name} has requested a withdrawal of ₹${amount.toFixed(2)}.`,
      {userId, amount: String(amount), webRoute: '/payouts'},
    );

    return {message: 'Payout request submitted. An admin will process it shortly.'};
  },

  async getTransactions(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = {userId, status: 'SUCCESS' as const};

    const [rows, total] = await Promise.all([
      transactionRepository.findMany({
        where,
        orderBy: {createdAt: 'desc'},
        skip,
        take: limit,
        select: {id: true, type: true, amount: true, description: true, requestId: true, createdAt: true},
      }),
      transactionRepository.count(where),
    ]);

    return {
      items: rows.map(t => ({
        ...t,
        amount: Number(t.amount),
        createdAt: t.createdAt.toISOString(),
      })),
      page,
      hasMore: skip + rows.length < total,
    };
  },
};
