import {Response} from 'express';
import {ReportCategory} from '@prisma/client';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {reportService} from '../services/reportService';
import {sendSuccess} from '../utils/apiResponse';

/** Admin Report Queue (PRD §5.12, §5.14, backend Phase 9). */
export const adminReportController = {
  async list(req: AdminRequest, res: Response) {
    const {status, category, reportedUserId, reporterId, page, limit} = req.query as unknown as {
      status?: 'PENDING' | 'RESOLVED' | 'DISMISSED';
      category?: ReportCategory;
      reportedUserId?: string;
      reporterId?: string;
      page: number;
      limit: number;
    };
    const data = await reportService.adminList({status, category, reportedUserId, reporterId}, page, limit);
    sendSuccess(res, 200, 'Reports fetched.', data);
  },

  async detail(req: AdminRequest, res: Response) {
    const data = await reportService.adminDetail(req.params.id as string);
    sendSuccess(res, 200, 'Report detail fetched.', data);
  },

  async stats(_req: AdminRequest, res: Response) {
    const data = await reportService.adminStats();
    sendSuccess(res, 200, 'Report statistics fetched.', data);
  },

  async resolve(req: AdminRequest, res: Response) {
    const data = await reportService.resolve(req.admin!.id, req.params.id as string, req.body.notes);
    sendSuccess(res, 200, 'Report resolved.', data);
  },

  async dismiss(req: AdminRequest, res: Response) {
    const data = await reportService.dismiss(req.admin!.id, req.params.id as string, req.body.notes);
    sendSuccess(res, 200, 'Report dismissed.', data);
  },
};
