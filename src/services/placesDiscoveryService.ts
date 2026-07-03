import {logger} from '../config/logger';
import {savedPlaceRepository} from '../repositories/savedPlaceRepository';
import {searchHistoryRepository} from '../repositories/searchHistoryRepository';
import {HttpError} from '../utils/httpError';
import {PlaceSummary, placesService} from './placesService';

function recordHistory(
  userId: string,
  entry: {searchType: 'TEXT' | 'NEARBY' | 'PLACE_SELECT'; query?: string; placeId?: string; snapshot?: PlaceSummary},
) {
  // Best-effort — a history write failure must never break the underlying search response.
  searchHistoryRepository
    .create({
      user: {connect: {id: userId}},
      searchType: entry.searchType,
      query: entry.query,
      placeId: entry.placeId,
      resultSnapshot: entry.snapshot
        ? {
            name: entry.snapshot.name,
            address: entry.snapshot.address,
            latitude: entry.snapshot.latitude,
            longitude: entry.snapshot.longitude,
            category: entry.snapshot.category,
            photoReference: entry.snapshot.photoReference,
          }
        : undefined,
    })
    .then(() => searchHistoryRepository.pruneOldest(userId))
    .catch(err => logger.error(`[placesDiscoveryService.recordHistory] Failed to record history: ${(err as Error).message}`));
}

export const placesDiscoveryService = {
  async nearby(
    userId: string,
    params: {lat: number; lng: number; radius: number; category?: string; pageToken?: string},
  ) {
    const result = await placesService.nearbySearch(params);
    if (!params.pageToken) {
      recordHistory(userId, {searchType: 'NEARBY'});
    }
    return result;
  },

  async search(userId: string, params: {query: string; lat?: number; lng?: number; pageToken?: string}) {
    const result = await placesService.textSearch(params);
    if (!params.pageToken) {
      recordHistory(userId, {searchType: 'TEXT', query: params.query});
    }
    return result;
  },

  async details(userId: string, placeId: string) {
    const result = await placesService.getPlaceDetails(placeId);
    recordHistory(userId, {searchType: 'PLACE_SELECT', placeId, snapshot: result});
    return result;
  },

  async reverseGeocode(params: {lat: number; lng: number}) {
    return placesService.reverseGeocode(params);
  },

  async addFavorite(
    userId: string,
    body: {
      placeId: string;
      name: string;
      address?: string;
      latitude: number;
      longitude: number;
      category?: string;
      label?: string;
    },
  ) {
    const existing = await savedPlaceRepository.findByUserAndPlaceId(userId, body.placeId);
    if (existing) {
      return {place: existing, alreadyExisted: true};
    }

    const created = await savedPlaceRepository.create({
      user: {connect: {id: userId}},
      placeId: body.placeId,
      name: body.name,
      address: body.address,
      latitude: body.latitude,
      longitude: body.longitude,
      category: body.category,
      label: body.label,
    });

    return {place: created, alreadyExisted: false};
  },

  async removeFavorite(userId: string, id: string) {
    const result = await savedPlaceRepository.deleteByIdForUser(id, userId);
    if (result.count === 0) {
      throw new HttpError(404, 'Favorite not found.');
    }
  },

  async listFavorites(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      savedPlaceRepository.findManyForUser(userId, skip, limit),
      savedPlaceRepository.countForUser(userId),
    ]);

    return {items, page, hasMore: skip + items.length < total};
  },

  async listHistory(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      searchHistoryRepository.findManyForUser(userId, skip, limit),
      searchHistoryRepository.countForUser(userId),
    ]);

    return {items, page, hasMore: skip + items.length < total};
  },

  async clearHistory(userId: string) {
    await searchHistoryRepository.deleteAllForUser(userId);
  },
};
