import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {privacyService} from '../services/privacyService';
import {sendSuccess} from '../utils/apiResponse';

/** Privacy Settings hub (backend Phase 13). */
export const privacyController = {
  async getSettings(req: AuthenticatedRequest, res: Response) {
    const data = await privacyService.getSettings(req.user!.id);
    sendSuccess(res, 200, 'Privacy settings fetched.', data);
  },
};
