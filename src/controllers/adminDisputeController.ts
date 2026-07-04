import {Response} from 'express';
import {DisputeReason, DisputeResolution, DisputeStatus} from '@prisma/client';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {disputeService} from '../services/disputeService';
import {sendSuccess} from '../utils/apiResponse';

/** Admin Dispute Center sub-module (PRD §5.14.2/§5.14.3/§5.14.6/§5.14.8/§5.14.10, backend Phase 11). */
export const adminDisputeController = {
  async list(req: AdminRequest, res: Response) {
    const {status, reason, caseOwnerAdminId, raisedById, requestId, search, page, limit} = req.query as unknown as {
      status?: DisputeStatus;
      reason?: DisputeReason;
      caseOwnerAdminId?: string;
      raisedById?: string;
      requestId?: string;
      search?: string;
      page: number;
      limit: number;
    };
    const data = await disputeService.adminList(
      {status, reason, caseOwnerAdminId, raisedById, requestId, search},
      page,
      limit,
    );
    sendSuccess(res, 200, 'Disputes fetched.', data);
  },

  async stats(_req: AdminRequest, res: Response) {
    const data = await disputeService.adminStats();
    sendSuccess(res, 200, 'Dispute statistics fetched.', data);
  },

  async detail(req: AdminRequest, res: Response) {
    const data = await disputeService.adminDetail(req.params.id as string);
    sendSuccess(res, 200, 'Dispute detail fetched.', data);
  },

  async assign(req: AdminRequest, res: Response) {
    const data = await disputeService.adminAssign(req.admin!.id, req.params.id as string, req.body.adminId);
    sendSuccess(res, 200, 'Dispute case assigned.', data);
  },

  async postMessage(req: AdminRequest, res: Response) {
    const {body, isInternalNote} = req.body as {body: string; isInternalNote?: boolean};
    const data = await disputeService.adminPostMessage(req.admin!.id, req.params.id as string, body, !!isInternalNote);
    sendSuccess(res, 201, 'Message posted.', data);
  },

  async submitEvidence(req: AdminRequest, res: Response) {
    const data = await disputeService.adminSubmitEvidence(
      req.admin!.id,
      req.params.id as string,
      req.file,
      req.body.caption,
    );
    sendSuccess(res, 201, 'Evidence submitted.', data);
  },

  async listNotes(req: AdminRequest, res: Response) {
    const data = await disputeService.adminListNotes(req.params.id as string);
    sendSuccess(res, 200, 'Review notes fetched.', data);
  },

  async addNote(req: AdminRequest, res: Response) {
    const data = await disputeService.adminAddNote(req.admin!.id, req.params.id as string, req.body.note);
    sendSuccess(res, 201, 'Review note added.', data);
  },

  async auditTrail(req: AdminRequest, res: Response) {
    const data = await disputeService.adminAuditTrail(req.params.id as string);
    sendSuccess(res, 200, 'Dispute timeline fetched.', data);
  },

  async resolve(req: AdminRequest, res: Response) {
    const {resolution, splitPercentage, notes} = req.body as {
      resolution: DisputeResolution;
      splitPercentage?: number;
      notes?: string;
    };
    const data = await disputeService.adminResolve(req.admin!.id, req.params.id as string, {
      resolution,
      splitPercentage,
      notes,
    });
    sendSuccess(res, 200, 'Dispute resolved.', data);
  },

  async close(req: AdminRequest, res: Response) {
    const data = await disputeService.adminClose(req.admin!.id, req.params.id as string, req.body.notes);
    sendSuccess(res, 200, 'Dispute closed.', data);
  },

  async reopen(req: AdminRequest, res: Response) {
    const data = await disputeService.adminReopen(req.admin!.id, req.params.id as string, req.body.reason);
    sendSuccess(res, 200, 'Dispute reopened.', data);
  },
};
