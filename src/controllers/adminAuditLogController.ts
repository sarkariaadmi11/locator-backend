import {Response} from 'express';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {adminAuditLogService} from '../services/adminAuditLogService';
import {sendSuccess} from '../utils/apiResponse';

export const adminAuditLogController = {
  async list(req: AdminRequest, res: Response) {
    const {actorId, targetEntityType, targetEntityId, page, limit} = req.query as unknown as {
      actorId?: string;
      targetEntityType?: string;
      targetEntityId?: string;
      page: number;
      limit: number;
    };
    const data = await adminAuditLogService.list({actorId, targetEntityType, targetEntityId}, page, limit);
    sendSuccess(res, 200, 'Audit logs fetched.', data);
  },
};
