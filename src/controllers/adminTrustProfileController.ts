import {Response} from 'express';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {trustScoreService} from '../services/trustScoreService';
import {sendSuccess} from '../utils/apiResponse';

/** Admin Trust Profile sub-module (backend Phase 10). */
export const adminTrustProfileController = {
  async list(req: AdminRequest, res: Response) {
    const {isSuspicious, isVerified, isActive, search, page, limit} = req.query as unknown as {
      isSuspicious?: boolean;
      isVerified?: boolean;
      isActive?: boolean;
      search?: string;
      page: number;
      limit: number;
    };
    const data = await trustScoreService.adminList({isSuspicious, isVerified, isActive, search}, page, limit);
    sendSuccess(res, 200, 'Trust profiles fetched.', data);
  },

  async detail(req: AdminRequest, res: Response) {
    const data = await trustScoreService.adminDetail(req.params.userId as string);
    sendSuccess(res, 200, 'Trust profile detail fetched.', data);
  },

  async stats(_req: AdminRequest, res: Response) {
    const data = await trustScoreService.adminStats();
    sendSuccess(res, 200, 'Trust profile statistics fetched.', data);
  },

  async verify(req: AdminRequest, res: Response) {
    const data = await trustScoreService.adminSetVerified(req.admin!.id, req.params.userId as string, true);
    sendSuccess(res, 200, 'User verified.', data);
  },

  async unverify(req: AdminRequest, res: Response) {
    const data = await trustScoreService.adminSetVerified(req.admin!.id, req.params.userId as string, false);
    sendSuccess(res, 200, 'User verification revoked.', data);
  },

  async listNotes(req: AdminRequest, res: Response) {
    const data = await trustScoreService.adminListNotes(req.params.userId as string);
    sendSuccess(res, 200, 'Review notes fetched.', data);
  },

  async addNote(req: AdminRequest, res: Response) {
    const data = await trustScoreService.adminAddNote(req.admin!.id, req.params.userId as string, req.body.note);
    sendSuccess(res, 201, 'Review note added.', data);
  },
};
