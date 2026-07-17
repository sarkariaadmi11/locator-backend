import {Response} from 'express';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {notificationTemplateService} from '../services/notificationTemplateService';
import {sendSuccess} from '../utils/apiResponse';

/** Notification Templates (PRD §5.14.9, admin-only). */
export const adminNotificationTemplateController = {
  async listAll(_req: AdminRequest, res: Response) {
    const data = await notificationTemplateService.listAll();
    sendSuccess(res, 200, 'Notification templates fetched.', data);
  },

  async upsert(req: AdminRequest, res: Response) {
    const {title, body, enabled} = req.body as {title: string; body: string; enabled: boolean};
    const data = await notificationTemplateService.upsert(req.admin!.id, req.params.type as string, title, body, enabled);
    sendSuccess(res, 200, 'Notification template saved.', data);
  },

  async remove(req: AdminRequest, res: Response) {
    await notificationTemplateService.remove(req.admin!.id, req.params.type as string);
    sendSuccess(res, 200, 'Notification template reverted to default.', null);
  },
};
