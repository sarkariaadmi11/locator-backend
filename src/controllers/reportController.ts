import {Response} from 'express';
import {ReportCategory} from '@prisma/client';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {reportService} from '../services/reportService';
import {sendSuccess} from '../utils/apiResponse';

/** Report/Abuse workflow (PRD §5.12, backend Phase 9) — user-facing submission. */
export const reportController = {
  async create(req: AuthenticatedRequest, res: Response) {
    const {reportedUserId, requestId, category, description, evidence} = req.body as {
      reportedUserId: string;
      requestId: string;
      category: ReportCategory;
      description: string;
      evidence?: string[];
    };
    const data = await reportService.create(req.user!.id, {reportedUserId, requestId, category, description, evidence});
    sendSuccess(res, 201, 'Report submitted.', data);
  },
};
