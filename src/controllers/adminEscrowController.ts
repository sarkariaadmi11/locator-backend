import {Response} from 'express';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {escrowService} from '../services/escrowService';
import {sendSuccess} from '../utils/apiResponse';

/** Admin Escrow & Finance sub-module (PRD §5.14.5, backend Phase 8). */
export const adminEscrowController = {
  async list(req: AdminRequest, res: Response) {
    const {page, limit, state, requestId} = req.query as unknown as {
      page: number;
      limit: number;
      state?: 'RESERVED' | 'RELEASED' | 'REFUNDED' | 'FROZEN' | 'SPLIT';
      requestId?: string;
    };
    const data = await escrowService.adminList({state, requestId}, page, limit);
    sendSuccess(res, 200, 'Escrow records fetched.', data);
  },

  async detail(req: AdminRequest, res: Response) {
    const data = await escrowService.adminDetail(req.params.id as string);
    sendSuccess(res, 200, 'Escrow detail fetched.', data);
  },

  async summary(_req: AdminRequest, res: Response) {
    const data = await escrowService.adminSummary();
    sendSuccess(res, 200, 'Escrow financial summary fetched.', data);
  },

  async release(req: AdminRequest, res: Response) {
    const data = await escrowService.adminRelease(req.admin!.id, req.params.id as string, req.body.reason);
    sendSuccess(res, 200, 'Escrow released to Creator.', data);
  },

  async refund(req: AdminRequest, res: Response) {
    const {reason, amount} = req.body as {reason: string; amount?: number};
    const data =
      amount !== undefined
        ? await escrowService.adminPartialRefund(req.admin!.id, req.params.id as string, amount, reason)
        : await escrowService.adminRefund(req.admin!.id, req.params.id as string, reason);
    sendSuccess(res, 200, amount !== undefined ? 'Escrow partially refunded.' : 'Escrow refunded to Requester.', data);
  },
};
