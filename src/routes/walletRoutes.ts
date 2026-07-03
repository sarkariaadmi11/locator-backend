import {Router} from 'express';

import {walletController} from '../controllers/walletController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
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
walletRoutes.post(
  '/create-order',
  validate({body: createOrderSchema}),
  asyncHandler(walletController.createOrder),
);
walletRoutes.post(
  '/verify-payment',
  validate({body: verifyPaymentSchema}),
  asyncHandler(walletController.verifyPayment),
);
walletRoutes.post(
  '/withdraw',
  validate({body: withdrawSchema}),
  asyncHandler(walletController.withdraw),
);
walletRoutes.get('/transactions', asyncHandler(walletController.getTransactions));
