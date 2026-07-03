import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {placesDiscoveryService} from '../services/placesDiscoveryService';
import {sendSuccess} from '../utils/apiResponse';

export const placesController = {
  async nearby(req: AuthenticatedRequest, res: Response) {
    const {lat, lng, radius, category, pageToken} = req.query as unknown as {
      lat: number;
      lng: number;
      radius: number;
      category?: string;
      pageToken?: string;
    };
    const data = await placesDiscoveryService.nearby(req.user!.id, {lat, lng, radius, category, pageToken});
    sendSuccess(res, 200, 'Nearby places fetched.', data);
  },

  async search(req: AuthenticatedRequest, res: Response) {
    const {query, lat, lng, pageToken} = req.query as unknown as {
      query: string;
      lat?: number;
      lng?: number;
      pageToken?: string;
    };
    const data = await placesDiscoveryService.search(req.user!.id, {query, lat, lng, pageToken});
    sendSuccess(res, 200, 'Search results fetched.', data);
  },

  async details(req: AuthenticatedRequest, res: Response) {
    const data = await placesDiscoveryService.details(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Place details fetched.', data);
  },

  async reverseGeocode(req: AuthenticatedRequest, res: Response) {
    const {lat, lng} = req.query as unknown as {lat: number; lng: number};
    const data = await placesDiscoveryService.reverseGeocode({lat, lng});
    sendSuccess(res, 200, 'Address resolved.', data);
  },

  async addFavorite(req: AuthenticatedRequest, res: Response) {
    const {place, alreadyExisted} = await placesDiscoveryService.addFavorite(req.user!.id, req.body);
    sendSuccess(res, alreadyExisted ? 200 : 201, alreadyExisted ? 'Already saved.' : 'Place saved.', place);
  },

  async removeFavorite(req: AuthenticatedRequest, res: Response) {
    await placesDiscoveryService.removeFavorite(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Favorite removed.', null);
  },

  async listFavorites(req: AuthenticatedRequest, res: Response) {
    const {page, limit} = req.query as unknown as {page: number; limit: number};
    const data = await placesDiscoveryService.listFavorites(req.user!.id, page, limit);
    sendSuccess(res, 200, 'Favorites fetched.', data);
  },

  async listHistory(req: AuthenticatedRequest, res: Response) {
    const {page, limit} = req.query as unknown as {page: number; limit: number};
    const data = await placesDiscoveryService.listHistory(req.user!.id, page, limit);
    sendSuccess(res, 200, 'Search history fetched.', data);
  },

  async clearHistory(req: AuthenticatedRequest, res: Response) {
    await placesDiscoveryService.clearHistory(req.user!.id);
    sendSuccess(res, 200, 'Search history cleared.', null);
  },
};
