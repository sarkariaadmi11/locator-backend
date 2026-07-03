import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {profileService} from '../services/profileService';
import {sendSuccess} from '../utils/apiResponse';

export const profileController = {
  async update(req: AuthenticatedRequest, res: Response) {
    const data = await profileService.update(req.user!.id, req.body);
    sendSuccess(res, 200, 'Profile updated.', data);
  },

  async uploadImage(req: AuthenticatedRequest, res: Response) {
    const data = await profileService.uploadImage(req.user!.id, req.file);
    sendSuccess(res, 200, 'Profile image uploaded.', data);
  },
};
