import {userRepository} from '../repositories/userRepository';
import {presentUser} from '../utils/userPresenter';
import {placesService} from './placesService';

type LocationInput = {
  city?: string;
  latitude?: number;
  longitude?: number;
};

// GPS-detect path (no explicit city given) — resolve a city name via reverse geocoding so
// "Current city"/"Current location" displays never fall back to raw coordinates. Best-effort: if
// Google is unavailable/unconfigured, returns null rather than failing the caller's save.
export async function resolveCity(latitude: number, longitude: number): Promise<string | null> {
  try {
    const geocode = await placesService.reverseGeocode({lat: latitude, lng: longitude});
    return geocode.city;
  } catch {
    return null;
  }
}

export const locationService = {
  async save(userId: string, input: LocationInput) {
    let city = input.city ?? null;

    if (!city && input.latitude !== undefined && input.longitude !== undefined) {
      city = await resolveCity(input.latitude, input.longitude);
    }

    const user = await userRepository.update(userId, {
      city,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    });

    return presentUser(user);
  },
};
