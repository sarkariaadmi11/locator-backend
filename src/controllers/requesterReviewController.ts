import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {requesterReviewService} from '../services/requesterReviewService';
import {sendSuccess} from '../utils/apiResponse';

export const requesterReviewController = {
  async acceptVideo(req: AuthenticatedRequest, res: Response) {
    const data = await requesterReviewService.acceptVideo(
      req.user!.id,
      req.params.id as string,
      req.body.remarks,
    );
    sendSuccess(res, 200, 'Video accepted.', data);
  },

  async requestReshoot(req: AuthenticatedRequest, res: Response) {
    const data = await requesterReviewService.requestReshoot(
      req.user!.id,
      req.params.id as string,
      req.body.reason,
      req.body.remarks,
    );
    sendSuccess(res, 200, 'Re-shoot requested.', data);
  },

  async reject(req: AuthenticatedRequest, res: Response) {
    const data = await requesterReviewService.reject(
      req.user!.id,
      req.params.id as string,
      req.body.reason,
      req.body.remarks,
    );
    sendSuccess(res, 200, 'Request rejected.', data);
  },
};
