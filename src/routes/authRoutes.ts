import {Router} from 'express';

import {authController} from '../controllers/authController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
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
  validate({body: registerSchema}),
  asyncHandler(authController.register),
);

authRoutes.post(
  '/register/verify-otp',
  validate({body: verifyRegistrationOtpSchema}),
  asyncHandler(authController.verifyRegistrationOtp),
);

authRoutes.post('/login', validate({body: loginSchema}), asyncHandler(authController.login));
authRoutes.get('/me', authenticate, asyncHandler(authController.me));

authRoutes.post(
  '/forgot-password',
  validate({body: forgotPasswordSchema}),
  asyncHandler(authController.requestPasswordReset),
);

authRoutes.post(
  '/forgot-password/verify-otp',
  validate({body: verifyPasswordResetOtpSchema}),
  asyncHandler(authController.verifyPasswordResetOtp),
);

authRoutes.post(
  '/reset-password',
  validate({body: resetPasswordSchema}),
  asyncHandler(authController.resetPassword),
);
