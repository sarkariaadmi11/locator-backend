import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {ratingService} from '../services/ratingService';
import {sendSuccess} from '../utils/apiResponse';

/** Mutual Ratings (PRD §5.12, backend Phase 9) — mounted alongside the rest of the Requests module. */
export const ratingController = {
  async rate(req: AuthenticatedRequest, res: Response) {
    const {stars, comment} = req.body as {stars: number; comment?: string};
    const data = await ratingService.rate(req.user!.id, req.params.id as string, stars, comment);
    sendSuccess(res, 201, 'Rating submitted.', data);
  },

  async getForRequest(req: AuthenticatedRequest, res: Response) {
    const data = await ratingService.getForRequest(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Ratings fetched.', data);
  },
};
