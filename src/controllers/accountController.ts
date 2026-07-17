import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {consentService} from '../services/consentService';
import {dataExportService} from '../services/dataExportService';
import {sendSuccess} from '../utils/apiResponse';

/** Data Export & Welcome Video ack (PRD §9, backend Phase 13). */
export const accountController = {
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
