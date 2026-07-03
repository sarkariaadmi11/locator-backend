import {Request, Response} from 'express';

import {logger} from '../config/logger';
import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {authService} from '../services/authService';
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

  async me(req: AuthenticatedRequest, res: Response) {
    sendSuccess(res, 200, 'Authenticated user fetched.', presentUser(req.user!));
  },

  async requestPasswordReset(req: Request, res: Response) {
    const data = await authService.requestPasswordReset(req.body.email);
    sendSuccess(res, 200, 'Password reset code sent.', data);
  },

  async verifyPasswordResetOtp(req: Request, res: Response) {
    const data = await authService.verifyPasswordResetOtp(req.body);
    sendSuccess(res, 200, 'OTP verified.', data);
  },

  async resetPassword(req: Request, res: Response) {
    await authService.resetPassword(req.body);
    sendSuccess(res, 200, 'Password reset successfully.', null);
  },
};
