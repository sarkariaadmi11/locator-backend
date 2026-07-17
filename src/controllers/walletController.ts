import crypto from 'crypto';

import {Request, Response} from 'express';

import {env} from '../config/env';
import {logger} from '../config/logger';
import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {walletService} from '../services/walletService';
import {recordWebhookFailure} from '../services/webhookHealthTracker';
import {sendSuccess} from '../utils/apiResponse';
import {HttpError} from '../utils/httpError';

function verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET || !rawBody || !signature) return false;

  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export const walletController = {
  async getWallet(req: AuthenticatedRequest, res: Response) {
    const data = await walletService.getWallet(req.user!.id);
    sendSuccess(res, 200, 'Wallet fetched.', data);
  },

  async createOrder(req: AuthenticatedRequest, res: Response) {
    const data = await walletService.createOrder(req.user!.id, req.body.amount);
    sendSuccess(res, 200, 'Order created.', data);
  },

  async verifyPayment(req: AuthenticatedRequest, res: Response) {
    const {razorpayOrderId, razorpayPaymentId, razorpaySignature} = req.body;
    const data = await walletService.verifyPayment(
      req.user!.id,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    );
    sendSuccess(res, 200, 'Payment verified. Wallet credited.', data);
  },

  async withdraw(req: AuthenticatedRequest, res: Response) {
    const data = await walletService.withdraw(req.user!.id, req.body.amount);
    sendSuccess(res, 200, 'Withdrawal successful.', data);
  },

  async getTransactions(req: AuthenticatedRequest, res: Response) {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10)));
    const data = await walletService.getTransactions(req.user!.id, page, limit);
    sendSuccess(res, 200, 'Transactions fetched.', data);
  },

  /**
   * Razorpay webhook (server-to-server, no user JWT). Reconciles payment state
   * independent of whether the client ever calls /verify-payment. Retry-safe:
   * walletService.handleWebhookEvent is idempotent, so Razorpay's automatic
   * retries on non-2xx responses cannot double-credit a wallet.
   */
  async webhook(req: Request & {rawBody?: Buffer}, res: Response) {
    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      logger.warn('[walletController.webhook] RAZORPAY_WEBHOOK_SECRET not set — webhook disabled.');
      recordWebhookFailure();
      throw new HttpError(503, 'Webhook not configured.');
    }

    const signature = req.header('x-razorpay-signature');
    if (!verifyWebhookSignature(req.rawBody, signature)) {
      logger.warn('[walletController.webhook] Rejected webhook — invalid or missing signature.');
      recordWebhookFailure();
      throw new HttpError(400, 'Invalid webhook signature.');
    }

    const {event, payload} = req.body as {
      event?: string;
      payload?: {payment?: {entity?: {order_id?: string; id?: string}}};
    };

    if (!event) {
      recordWebhookFailure();
      throw new HttpError(400, 'Missing event type.');
    }

    let result;
    try {
      result = await walletService.handleWebhookEvent(event, payload ?? {});
    } catch (err) {
      recordWebhookFailure();
      throw err;
    }
    logger.info(`[walletController.webhook] event="${event}" result=${JSON.stringify(result)}`);
    sendSuccess(res, 200, 'Webhook processed.', null);
  },
};
