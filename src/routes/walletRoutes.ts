import {Router} from 'express';

import {walletController} from '../controllers/walletController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {idempotency} from '../middlewares/idempotency';
import {validate} from '../middlewares/validate';
import {
  createOrderSchema,
  verifyPaymentSchema,
  withdrawSchema,
} from '../validations/walletValidation';

export const walletRoutes = Router();

// Public — Razorpay calls this server-to-server; authenticated via HMAC signature, not JWT.
walletRoutes.post('/webhook', asyncHandler(walletController.webhook));

walletRoutes.use(authenticate);
walletRoutes.get('/', asyncHandler(walletController.getWallet));
walletRoutes.post(
  '/create-order',
  idempotency,
  validate({body: createOrderSchema}),
  asyncHandler(walletController.createOrder),
);
walletRoutes.post(
  '/verify-payment',
  idempotency,
  validate({body: verifyPaymentSchema}),
  asyncHandler(walletController.verifyPayment),
);
walletRoutes.post(
  '/withdraw',
  idempotency,
  validate({body: withdrawSchema}),
  asyncHandler(walletController.withdraw),
);
walletRoutes.get('/transactions', asyncHandler(walletController.getTransactions));
