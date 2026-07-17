import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {homeService} from '../services/homeService';
import {settingsService} from '../services/settingsService';
import {sendSuccess} from '../utils/apiResponse';

export const homeController = {
  async index(req: AuthenticatedRequest, res: Response) {
    sendSuccess(res, 200, 'Home fetched.', homeService.getHome(req.user!));
  },

  // User-facing Moderation Toggle signal (mobile Phase 4/9, mirrors GET /wallet's
  // `realMoneyEnabled` pattern) — lets the client know whether Post-Submission Chat is even
  // reachable before attempting it, rather than discovering a 409 on first use.
  async moderationStatus(_req: AuthenticatedRequest, res: Response) {
    const enabled = await settingsService.isModerationEnabled();
    sendSuccess(res, 200, 'Moderation status fetched.', {moderationEnabled: enabled});
  },
};
