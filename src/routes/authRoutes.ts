import {Router} from 'express';

import {authController} from '../controllers/authController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {authRateLimit} from '../middlewares/authRateLimit';
import {validate} from '../middlewares/validate';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyPasswordResetOtpSchema,
  verifyRegistrationOtpSchema,
} from '../validations/authValidation';

export const authRoutes = Router();

authRoutes.post(
  '/register',
  authRateLimit,
  validate({body: registerSchema}),
  asyncHandler(authController.register),
);

authRoutes.post(
  '/register/verify-otp',
  authRateLimit,
  validate({body: verifyRegistrationOtpSchema}),
  asyncHandler(authController.verifyRegistrationOtp),
);

authRoutes.post('/login', authRateLimit, validate({body: loginSchema}), asyncHandler(authController.login));
authRoutes.get('/me', authenticate, asyncHandler(authController.me));

authRoutes.post(
  '/forgot-password',
  authRateLimit,
  validate({body: forgotPasswordSchema}),
  asyncHandler(authController.requestPasswordReset),
);

authRoutes.post(
  '/forgot-password/verify-otp',
  authRateLimit,
  validate({body: verifyPasswordResetOtpSchema}),
  asyncHandler(authController.verifyPasswordResetOtp),
);

authRoutes.post(
  '/reset-password',
  authRateLimit,
  validate({body: resetPasswordSchema}),
  asyncHandler(authController.resetPassword),
);
