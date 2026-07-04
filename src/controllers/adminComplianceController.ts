import {DeletionLogAction} from '@prisma/client';
import {Response} from 'express';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {dataDeletionLogRepository} from '../repositories/dataDeletionLogRepository';
import {complianceConfigService} from '../services/complianceConfigService';
import {sendSuccess} from '../utils/apiResponse';

/** Compliance & Data Management admin sub-module (PRD §9, §5.14.8, backend Phase 13). */
export const adminComplianceController = {
  async listConfig(_req: AdminRequest, res: Response) {
    const data = await complianceConfigService.listAll();
    sendSuccess(res, 200, 'Compliance configuration fetched.', data);
  },

  async updateConfig(req: AdminRequest, res: Response) {
    const data = await complianceConfigService.adminUpdate(req.admin!.id, req.params.key as string, req.body.value);
    sendSuccess(res, 200, 'Compliance configuration updated.', data);
  },

  async listDeletionLogs(req: AdminRequest, res: Response) {
    const {userId, action, page, limit} = req.query as unknown as {
      userId?: string;
      action?: DeletionLogAction;
      page: number;
      limit: number;
    };
    const skip = (page - 1) * limit;
    const [items, total] = await dataDeletionLogRepository.findMany({userId, action}, skip, limit);
    sendSuccess(res, 200, 'Data deletion logs fetched.', {
      items: items.map(entry => ({
        id: entry.id,
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  },
};
