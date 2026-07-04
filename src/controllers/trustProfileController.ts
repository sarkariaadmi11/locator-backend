import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {trustScoreService} from '../services/trustScoreService';
import {sendSuccess} from '../utils/apiResponse';

/** Trust Profile (PRD §5.8, backend Phase 10) — read-only, user-facing. */
export const trustProfileController = {
  /** `GET /trust-profile/me?role=requester|creator` — own profile, defaults to requester. */
  async me(req: AuthenticatedRequest, res: Response) {
    const role = (req.query.role as 'requester' | 'creator' | undefined) ?? 'requester';
    const data = await trustScoreService.getProfile(req.user!.id, role);
    await trustScoreService.checkAndNotifyChanges(req.user!.id, data);
    sendSuccess(res, 200, 'Trust profile fetched.', data);
  },

  /**
   * `GET /trust-profile/:userId?role=requester|creator` — any authenticated user may view
   * another user's trust profile (discovery-facing, not participant-gated — a Creator needs to
   * see a Requester's trust profile before ever accepting their request, same as Creator
   * Discovery itself isn't participant-gated).
   */
  async byUserId(req: AuthenticatedRequest, res: Response) {
    const role = (req.query.role as 'requester' | 'creator' | undefined) ?? 'requester';
    const data = await trustScoreService.getProfile(req.params.userId as string, role);
    sendSuccess(res, 200, 'Trust profile fetched.', data);
  },
};
