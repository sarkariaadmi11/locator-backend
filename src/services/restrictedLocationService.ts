import {RestrictedLocationCategory} from '@prisma/client';

import {restrictedLocationRepository} from '../repositories/restrictedLocationRepository';
import {HttpError} from '../utils/httpError';

type RestrictedLocationInput = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  category: RestrictedLocationCategory;
  label?: string;
};

export const restrictedLocationService = {
  async list(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      restrictedLocationRepository.findMany(skip, limit),
      restrictedLocationRepository.count(),
    ]);
    return {items, total, page, limit};
  },

  create(data: RestrictedLocationInput) {
    return restrictedLocationRepository.create(data);
  },

  async update(id: string, data: Partial<RestrictedLocationInput>) {
    const existing = await restrictedLocationRepository.findById(id);
    if (!existing) {
      throw new HttpError(404, 'Restricted location not found.');
    }
    return restrictedLocationRepository.update(id, data);
  },

  async remove(id: string) {
    const existing = await restrictedLocationRepository.findById(id);
    if (!existing) {
      throw new HttpError(404, 'Restricted location not found.');
    }
    await restrictedLocationRepository.delete(id);
  },
};
