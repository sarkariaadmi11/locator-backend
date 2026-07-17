import {Router} from 'express';

import {authController} from '../controllers/authController';
import {asyncHandler} from '../middlewares/asyncHandler';
import {authenticate} from '../middlewares/authMiddleware';
import {authRateLimit} from '../middlewares/authRateLimit';
import {validate} from '../middlewares/validate';
import {
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  requestPhoneOtpSchema,
  verifyPhoneOtpSchema,
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

// Phone OTP Registration & Login (PRD §5.1.1 "OTP-based phone login (primary)")
authRoutes.post(
  '/phone/register/request-otp',
  authRateLimit,
  validate({body: requestPhoneOtpSchema}),
  asyncHandler(authController.requestPhoneRegistrationOtp),
);
authRoutes.post(
  '/phone/register/verify-otp',
  authRateLimit,
  validate({body: verifyPhoneOtpSchema}),
  asyncHandler(authController.verifyPhoneRegistrationOtp),
);
authRoutes.post(
  '/phone/login/request-otp',
  authRateLimit,
  validate({body: requestPhoneOtpSchema}),
  asyncHandler(authController.requestPhoneLoginOtp),
);
authRoutes.post(
  '/phone/login/verify-otp',
  authRateLimit,
  validate({body: verifyPhoneOtpSchema}),
  asyncHandler(authController.verifyPhoneLoginOtp),
);

// Refresh Token Rotation & Session Restore (PRD §5.1.1, §11)
authRoutes.post(
  '/refresh',
  authRateLimit,
  validate({body: refreshTokenSchema}),
  asyncHandler(authController.refresh),
);
authRoutes.post(
  '/logout',
  authRateLimit,
  validate({body: refreshTokenSchema}),
  asyncHandler(authController.logout),
);
