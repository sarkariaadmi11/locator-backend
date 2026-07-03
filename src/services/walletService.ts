import crypto from 'crypto';

import Razorpay from 'razorpay';

import {env} from '../config/env';
import {logger} from '../config/logger';
import {prisma} from '../prisma/client';
import {payoutRequestRepository} from '../repositories/payoutRequestRepository';
import {transactionRepository} from '../repositories/transactionRepository';
import {fcmService} from './fcmService';
import {HttpError} from '../utils/httpError';
import {presentUser} from '../utils/userPresenter';

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
  async createOrder(userId: string, amount: number) {
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

    await payoutRequestRepository.create({
      user: {connect: {id: userId}},
      amount,
    });

    await fcmService.sendToAllAdmins({
      title: 'New Withdrawal Request',
      body: `${user.name} has requested a withdrawal of ₹${amount.toFixed(2)}.`,
      data: {type: 'PAYOUT_REQUEST', userId, amount: String(amount), webRoute: '/payouts'},
    });

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
        select: {id: true, type: true, amount: true, description: true, createdAt: true},
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
