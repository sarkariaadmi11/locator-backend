import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {tipService} from '../services/tipService';
import {sendSuccess} from '../utils/apiResponse';

export const tipController = {
  async tip(req: AuthenticatedRequest, res: Response) {
    const data = await tipService.tip(req.user!.id, req.params.id as string, req.body.amount);
    sendSuccess(res, 201, 'Tip sent.', data);
  },

  async getForRequest(req: AuthenticatedRequest, res: Response) {
    const data = await tipService.getForRequest(req.params.id as string);
    sendSuccess(res, 200, 'Tip fetched.', data);
  },
};
