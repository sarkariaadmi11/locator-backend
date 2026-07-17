import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {postSubmissionChatService} from '../services/postSubmissionChatService';
import {sendSuccess} from '../utils/apiResponse';

export const postSubmissionChatController = {
  async list(req: AuthenticatedRequest, res: Response) {
    const data = await postSubmissionChatService.list(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Messages fetched.', data);
  },

  async send(req: AuthenticatedRequest, res: Response) {
    const data = await postSubmissionChatService.send(req.user!.id, req.params.id as string, req.body.body);
    sendSuccess(res, 201, 'Message sent.', data);
  },
};
