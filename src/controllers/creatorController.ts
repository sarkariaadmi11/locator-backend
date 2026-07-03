import {Response} from 'express';
import {CreatorAvailability} from '@prisma/client';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {creatorService} from '../services/creatorService';
import {sendSuccess} from '../utils/apiResponse';

export const creatorController = {
  async updateLocation(req: AuthenticatedRequest, res: Response) {
    const {latitude, longitude} = req.body as {latitude: number; longitude: number};
    const data = await creatorService.updateLocation(req.user!.id, latitude, longitude);
    sendSuccess(res, 200, 'Location updated.', data);
  },

  async updateStatus(req: AuthenticatedRequest, res: Response) {
    const {availabilityStatus} = req.body as {availabilityStatus: CreatorAvailability};
    const data = await creatorService.updateStatus(req.user!.id, availabilityStatus);
    sendSuccess(res, 200, 'Status updated.', data);
  },

  async dashboard(req: AuthenticatedRequest, res: Response) {
    const data = await creatorService.dashboard(req.user!.id);
    sendSuccess(res, 200, 'Dashboard fetched.', data);
  },
};
