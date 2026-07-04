import {ConsentType} from '@prisma/client';
import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {consentService} from '../services/consentService';
import {sendSuccess} from '../utils/apiResponse';

/** Consent capture (PRD §9.1, §5.7.3, backend Phase 13). */
export const consentController = {
  async accept(req: AuthenticatedRequest, res: Response) {
    const {type} = req.body as {type: ConsentType};
    const data = await consentService.accept(req.user!.id, type, req.ip, req.get('user-agent') ?? undefined);
    sendSuccess(res, 201, 'Consent recorded.', data);
  },

  async status(req: AuthenticatedRequest, res: Response) {
    const data = await consentService.status(req.user!.id);
    sendSuccess(res, 200, 'Consent status fetched.', data);
  },

  async history(req: AuthenticatedRequest, res: Response) {
    const data = await consentService.history(req.user!.id);
    sendSuccess(res, 200, 'Consent history fetched.', data);
  },
};
