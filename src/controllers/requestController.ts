import {Response} from 'express';
import {RequestCategory, RequestStatus, RequestType} from '@prisma/client';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {requestService} from '../services/requestService';
import {sendSuccess} from '../utils/apiResponse';

export const requestController = {
  async create(req: AuthenticatedRequest, res: Response) {
    const data = await requestService.create(req.user!.id, req.body);
    sendSuccess(res, 201, 'Request created.', data);
  },

  async getById(req: AuthenticatedRequest, res: Response) {
    const data = await requestService.getById(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Request fetched.', data);
  },

  async listMine(req: AuthenticatedRequest, res: Response) {
    const {page, limit, status} = req.query as unknown as {
      page: number;
      limit: number;
      status?: RequestStatus;
    };
    const data = await requestService.listMine(req.user!.id, status, page, limit);
    sendSuccess(res, 200, 'Requests fetched.', data);
  },

  async update(req: AuthenticatedRequest, res: Response) {
    const data = await requestService.update(req.user!.id, req.params.id as string, req.body);
    sendSuccess(res, 200, 'Request updated.', data);
  },

  async cancel(req: AuthenticatedRequest, res: Response) {
    const data = await requestService.cancel(req.user!.id, req.params.id as string, req.body.reason);
    sendSuccess(res, 200, 'Request cancelled.', data);
  },

  async nearby(req: AuthenticatedRequest, res: Response) {
    const {latitude, longitude, radiusMeters, category, minReward, maxReward, type, page, limit} =
      req.query as unknown as {
        latitude: number;
        longitude: number;
        radiusMeters: number;
        category?: RequestCategory;
        minReward?: number;
        maxReward?: number;
        type?: RequestType;
        page: number;
        limit: number;
      };
    const data = await requestService.nearby(
      req.user!.id,
      {latitude, longitude},
      radiusMeters,
      {category, minReward, maxReward, type},
      page,
      limit,
    );
    sendSuccess(res, 200, 'Nearby requests fetched.', data);
  },

  async available(req: AuthenticatedRequest, res: Response) {
    const {category, minReward, maxReward, type, page, limit} = req.query as unknown as {
      category?: RequestCategory;
      minReward?: number;
      maxReward?: number;
      type?: RequestType;
      page: number;
      limit: number;
    };
    const data = await requestService.available(
      req.user!.id,
      {category, minReward, maxReward, type},
      page,
      limit,
    );
    sendSuccess(res, 200, 'Available requests fetched.', data);
  },

  async details(req: AuthenticatedRequest, res: Response) {
    const {latitude, longitude} = req.query as unknown as {latitude?: number; longitude?: number};
    const origin = latitude !== undefined && longitude !== undefined ? {latitude, longitude} : undefined;
    const data = await requestService.getDetailsForCreator(req.user!.id, req.params.id as string, origin);
    sendSuccess(res, 200, 'Request details fetched.', data);
  },

  async accept(req: AuthenticatedRequest, res: Response) {
    const {latitude, longitude} = req.body as {latitude: number; longitude: number};
    const data = await requestService.accept(req.user!.id, req.params.id as string, {latitude, longitude});
    sendSuccess(res, 200, 'Request accepted.', data);
  },
};
