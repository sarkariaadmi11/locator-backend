import {userRepository} from '../repositories/userRepository';
import {presentUser} from '../utils/userPresenter';
import {placesService} from './placesService';

type LocationInput = {
  city?: string;
  latitude?: number;
  longitude?: number;
};

export const locationService = {
  async save(userId: string, input: LocationInput) {
    let city = input.city ?? null;

    // GPS-detect path (city omitted, only coordinates sent) — resolve a city name via reverse
    // geocoding so "Current city" never falls back to raw coordinates. Best-effort: if Google is
    // unavailable/unconfigured, save the coordinates anyway rather than failing location save.
    if (!city && input.latitude !== undefined && input.longitude !== undefined) {
      try {
        const geocode = await placesService.reverseGeocode({lat: input.latitude, lng: input.longitude});
        city = geocode.city;
      } catch {
        city = null;
      }
    }

    const user = await userRepository.update(userId, {
      city,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    });

    return presentUser(user);
  },
};
