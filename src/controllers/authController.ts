import {Request, Response} from 'express';

import {logger} from '../config/logger';
import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {authService} from '../services/authService';
import {ratingService} from '../services/ratingService';
import {trustScoreService} from '../services/trustScoreService';
import {sendSuccess} from '../utils/apiResponse';
import {presentUser} from '../utils/userPresenter';

export const authController = {
  async register(req: Request, res: Response) {
    logger.debug(`[register] request received for email=${req.body?.email} username=${req.body?.username}`);
    const data = await authService.register(req.body);
    logger.debug(`[register] verification code dispatched for email=${req.body?.email}`);
    sendSuccess(res, 200, 'Verification code sent.', data);
  },

  async verifyRegistrationOtp(req: Request, res: Response) {
    logger.debug(`[verifyRegistrationOtp] request received for email=${req.body?.email}`);
    const data = await authService.verifyRegistrationOtp(req.body);
    logger.debug(`[verifyRegistrationOtp] registration completed for email=${req.body?.email}`);
    sendSuccess(res, 201, 'Registration successful.', data);
  },

  async login(req: Request, res: Response) {
    const data = await authService.login(req.body);
    sendSuccess(res, 200, 'Login successful.', data);
  },

  async requestPhoneRegistrationOtp(req: Request, res: Response) {
    const data = await authService.requestPhoneRegistrationOtp(req.body.phone);
    sendSuccess(res, 200, 'OTP sent.', data);
  },

  async verifyPhoneRegistrationOtp(req: Request, res: Response) {
    const data = await authService.verifyPhoneRegistrationOtp(req.body.phone, req.body.otp);
    sendSuccess(res, 201, 'Registration successful.', data);
  },

  async requestPhoneLoginOtp(req: Request, res: Response) {
    const data = await authService.requestPhoneLoginOtp(req.body.phone);
    sendSuccess(res, 200, 'OTP sent.', data);
  },

  async verifyPhoneLoginOtp(req: Request, res: Response) {
    const data = await authService.verifyPhoneLoginOtp(req.body.phone, req.body.otp);
    sendSuccess(res, 200, 'Login successful.', data);
  },

  async refresh(req: Request, res: Response) {
    const data = await authService.refresh(req.body.refreshToken);
    sendSuccess(res, 200, 'Session refreshed.', data);
  },

  async logout(req: Request, res: Response) {
    await authService.logout(req.body.refreshToken);
    sendSuccess(res, 200, 'Logged out successfully.', null);
  },

  async me(req: AuthenticatedRequest, res: Response) {
    // v2.1 (backend Phase 7): Trust Score removed from MVP display entirely, including self-view
    // — trustScoreService.getUserFacingProfile strips it.
    const [ratingSummary, requesterTrustProfile, creatorTrustProfile] = await Promise.all([
      ratingService.getSummaryForUser(req.user!.id),
      trustScoreService.getUserFacingProfile(req.user!.id, 'requester'),
      trustScoreService.getUserFacingProfile(req.user!.id, 'creator'),
    ]);
    sendSuccess(res, 200, 'Authenticated user fetched.', {
      ...presentUser(req.user!),
      ...ratingSummary,
      requesterTrustProfile,
      creatorTrustProfile,
    });
  },
};
