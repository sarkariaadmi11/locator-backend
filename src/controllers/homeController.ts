import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {homeService} from '../services/homeService';
import {sendSuccess} from '../utils/apiResponse';

export const homeController = {
  async index(req: AuthenticatedRequest, res: Response) {
    sendSuccess(res, 200, 'Home fetched.', homeService.getHome(req.user!));
  },
};
