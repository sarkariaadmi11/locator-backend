import {Response} from 'express';
import {DisputeReason, DisputeStatus} from '@prisma/client';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {disputeService} from '../services/disputeService';
import {sendSuccess} from '../utils/apiResponse';

/** Dispute Center (PRD §5.14.2, backend Phase 11) — Requester/Creator-facing. */
export const disputeController = {
  async create(req: AuthenticatedRequest, res: Response) {
    const {requestId, reason, description} = req.body as {
      requestId: string;
      reason: DisputeReason;
      description: string;
    };
    const data = await disputeService.create(req.user!.id, {requestId, reason, description});
    sendSuccess(res, 201, 'Dispute raised.', data);
  },

  async listMine(req: AuthenticatedRequest, res: Response) {
    const {status, page, limit} = req.query as unknown as {status?: DisputeStatus; page: number; limit: number};
    const data = await disputeService.listMine(req.user!.id, status, page, limit);
    sendSuccess(res, 200, 'Disputes fetched.', data);
  },

  async detail(req: AuthenticatedRequest, res: Response) {
    const data = await disputeService.getForParticipant(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Dispute detail fetched.', data);
  },

  async postMessage(req: AuthenticatedRequest, res: Response) {
    const data = await disputeService.postMessage(req.user!.id, req.params.id as string, req.body.body);
    sendSuccess(res, 201, 'Message sent.', data);
  },

  async submitEvidence(req: AuthenticatedRequest, res: Response) {
    const data = await disputeService.submitEvidence(
      req.user!.id,
      req.params.id as string,
      req.file,
      req.body.caption,
    );
    sendSuccess(res, 201, 'Evidence submitted.', data);
  },
};
