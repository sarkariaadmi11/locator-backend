import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {locationCategoryService} from '../services/locationCategoryService';
import {locationService} from '../services/locationService';
import {sendSuccess} from '../utils/apiResponse';

export const locationController = {
  async save(req: AuthenticatedRequest, res: Response) {
    const data = await locationService.save(req.user!.id, req.body);
    sendSuccess(res, 200, 'Location saved.', data);
  },

  async classify(req: AuthenticatedRequest, res: Response) {
    const {lat, lng} = req.query as unknown as {lat: number; lng: number};
    const data = await locationCategoryService.classify(lat, lng);
    sendSuccess(res, 200, 'Location classified.', data);
  },
};
