import {Request, Response} from 'express';

import {restrictedLocationService} from '../services/restrictedLocationService';
import {sendSuccess} from '../utils/apiResponse';

export const adminRestrictedLocationController = {
  async list(req: Request, res: Response) {
    const {page, limit} = req.query as unknown as {page: number; limit: number};
    const data = await restrictedLocationService.list(page, limit);
    sendSuccess(res, 200, 'Restricted locations fetched.', data);
  },

  async create(req: Request, res: Response) {
    const data = await restrictedLocationService.create(req.body);
    sendSuccess(res, 201, 'Restricted location created.', data);
  },

  async update(req: Request, res: Response) {
    const data = await restrictedLocationService.update(req.params.id as string, req.body);
    sendSuccess(res, 200, 'Restricted location updated.', data);
  },

  async remove(req: Request, res: Response) {
    await restrictedLocationService.remove(req.params.id as string);
    sendSuccess(res, 200, 'Restricted location removed.', null);
  },
};
