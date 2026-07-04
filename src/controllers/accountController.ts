import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {accountDeletionService} from '../services/accountDeletionService';
import {consentService} from '../services/consentService';
import {dataExportService} from '../services/dataExportService';
import {sendSuccess} from '../utils/apiResponse';

/** Account Deletion & Data Export (PRD §9, backend Phase 13). */
export const accountController = {
  async requestDeletion(req: AuthenticatedRequest, res: Response) {
    const data = await accountDeletionService.requestDeletion(req.user!.id, req.body?.reason);
    sendSuccess(res, 200, 'Account deletion scheduled.', data);
  },

  async cancelDeletion(req: AuthenticatedRequest, res: Response) {
    const data = await accountDeletionService.cancelDeletion(req.user!.id);
    sendSuccess(res, 200, 'Account deletion cancelled.', data);
  },

  async deletionStatus(req: AuthenticatedRequest, res: Response) {
    const data = await accountDeletionService.status(req.user!.id);
    sendSuccess(res, 200, 'Account deletion status fetched.', data);
  },

  async createExport(req: AuthenticatedRequest, res: Response) {
    const data = await dataExportService.createExportRequest(req.user!.id);
    sendSuccess(res, 201, 'Data export requested.', data);
  },

  async listExports(req: AuthenticatedRequest, res: Response) {
    const {page, limit} = req.query as unknown as {page: number; limit: number};
    const data = await dataExportService.listForUser(req.user!.id, page, limit);
    sendSuccess(res, 200, 'Data export requests fetched.', data);
  },

  async getExport(req: AuthenticatedRequest, res: Response) {
    const data = await dataExportService.getForUser(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Data export request fetched.', data);
  },

  async acknowledgeWelcomeVideo(req: AuthenticatedRequest, res: Response) {
    await consentService.acknowledgeWelcomeVideoReprompt(req.user!.id);
    sendSuccess(res, 200, 'Welcome video acknowledged.', null);
  },
};
