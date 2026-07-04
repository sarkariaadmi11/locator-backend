import {Response} from 'express';
import {VideoModerationStatus, VideoRejectionReason} from '@prisma/client';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {moderationService} from '../services/moderationService';
import {sendSuccess} from '../utils/apiResponse';

export const adminModerationController = {
  async queue(req: AdminRequest, res: Response) {
    const {status, requestId, creatorId, search, page, limit} = req.query as unknown as {
      status: VideoModerationStatus;
      requestId?: string;
      creatorId?: string;
      search?: string;
      page: number;
      limit: number;
    };
    const data = await moderationService.getQueue(req.admin!.id, {status, requestId, creatorId, search}, page, limit);
    sendSuccess(res, 200, 'Moderation queue fetched.', data);
  },

  async history(req: AdminRequest, res: Response) {
    const {status, moderatedByAdminId, requestId, creatorId, search, dateFrom, dateTo, page, limit} =
      req.query as unknown as {
        status?: 'APPROVED' | 'REJECTED';
        moderatedByAdminId?: string;
        requestId?: string;
        creatorId?: string;
        search?: string;
        dateFrom?: Date;
        dateTo?: Date;
        page: number;
        limit: number;
      };
    const data = await moderationService.getHistory(
      {status, moderatedByAdminId, requestId, creatorId, search, dateFrom, dateTo},
      page,
      limit,
    );
    sendSuccess(res, 200, 'Moderation history fetched.', data);
  },

  async stats(_req: AdminRequest, res: Response) {
    const data = await moderationService.getStats();
    sendSuccess(res, 200, 'Moderation stats fetched.', data);
  },

  async detail(req: AdminRequest, res: Response) {
    const data = await moderationService.getVideoDetail(req.params.videoId as string);
    sendSuccess(res, 200, 'Video moderation detail fetched.', data);
  },

  async approve(req: AdminRequest, res: Response) {
    const data = await moderationService.approve(req.admin!.id, req.params.videoId as string, req.body.remarks);
    sendSuccess(res, 200, 'Video approved.', data);
  },

  async reject(req: AdminRequest, res: Response) {
    const {reason, remarks} = req.body as {reason: VideoRejectionReason; remarks?: string};
    const data = await moderationService.reject(req.admin!.id, req.params.videoId as string, reason, remarks);
    sendSuccess(res, 200, 'Video rejected.', data);
  },

  async bulkApprove(req: AdminRequest, res: Response) {
    const {videoIds, remarks} = req.body as {videoIds: string[]; remarks?: string};
    const data = await moderationService.bulkApprove(req.admin!.id, videoIds, remarks);
    sendSuccess(res, 200, 'Bulk approval processed.', data);
  },

  async bulkReject(req: AdminRequest, res: Response) {
    const {videoIds, reason, remarks} = req.body as {
      videoIds: string[];
      reason: VideoRejectionReason;
      remarks?: string;
    };
    const data = await moderationService.bulkReject(req.admin!.id, videoIds, reason, remarks);
    sendSuccess(res, 200, 'Bulk rejection processed.', data);
  },
};
