import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {queryService} from '../services/queryService';
import {sendSuccess} from '../utils/apiResponse';

export const queryController = {
  async ask(req: AuthenticatedRequest, res: Response) {
    const data = await queryService.ask(req.user!.id, req.params.id as string, req.body.body);
    sendSuccess(res, 201, 'Question sent.', data);
  },

  async reply(req: AuthenticatedRequest, res: Response) {
    const data = await queryService.reply(
      req.user!.id,
      req.params.id as string,
      req.params.threadId as string,
      req.body.body,
    );
    sendSuccess(res, 201, 'Reply sent.', data);
  },

  async decline(req: AuthenticatedRequest, res: Response) {
    const data = await queryService.decline(req.user!.id, req.params.id as string, req.params.threadId as string);
    sendSuccess(res, 200, 'Question thread declined.', data);
  },

  async list(req: AuthenticatedRequest, res: Response) {
    const data = await queryService.list(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Question threads fetched.', data);
  },
};
