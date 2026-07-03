import {RestrictedLocationCategory} from '@prisma/client';

import {env} from '../config/env';
import {restrictedLocationRepository} from '../repositories/restrictedLocationRepository';
import {haversineMeters} from '../utils/geo';
import {placesService, ReverseGeocodeResult} from './placesService';

export type LocationCategory = 'PUBLIC' | 'RESTRICTED' | 'PROHIBITED';
export type ClassificationSource = 'MANUAL_LIST' | 'GOOGLE_GEOCODE' | 'DEFAULT';

export type LocationClassification = {
  category: LocationCategory;
  source: ClassificationSource;
  matchedLocation?: {id: string; label: string | null};
  reverseGeocode?: ReverseGeocodeResult;
};

// Manual-list category always wins over an automated best-guess. PROHIBITED (hard block) is
// reserved for admin-curated entries only — never auto-assigned from a Google geocode match,
// since a heuristic keyword match is a false-positive risk the PRD doesn't ask us to hard-block on.
const CATEGORY_SEVERITY: Record<RestrictedLocationCategory, number> = {
  RESTRICTED: 1,
  PROHIBITED: 2,
};

// Best-effort signal only — flags a location for Admin review (RESTRICTED), never a hard block.
const SENSITIVE_ADDRESS_KEYWORDS = [
  'airport',
  'military',
  'embassy',
  'courthouse',
  'police',
  'government',
];

function findManualMatch(
  lat: number,
  lng: number,
  locations: {id: string; latitude: number; longitude: number; radiusMeters: number; category: RestrictedLocationCategory; label: string | null}[],
) {
  const matches = locations.filter(loc => haversineMeters(lat, lng, loc.latitude, loc.longitude) <= loc.radiusMeters);
  if (matches.length === 0) return null;

  return matches.reduce((worst, current) =>
    CATEGORY_SEVERITY[current.category] > CATEGORY_SEVERITY[worst.category] ? current : worst,
  );
}

export const locationCategoryService = {
  async classify(lat: number, lng: number): Promise<LocationClassification> {
    const manualLocations = await restrictedLocationRepository.findAll();
    const manualMatch = findManualMatch(lat, lng, manualLocations);

    if (manualMatch) {
      return {
        category: manualMatch.category,
        source: 'MANUAL_LIST',
        matchedLocation: {id: manualMatch.id, label: manualMatch.label},
      };
    }

    if (!env.GOOGLE_PLACES_API_KEY) {
      return {category: 'PUBLIC', source: 'DEFAULT'};
    }

    // Google geocode is a best-effort assist — if it errors (network issue, no address found),
    // fall back to PUBLIC rather than failing the whole classification.
    try {
      const reverseGeocode = await placesService.reverseGeocode({lat, lng});
      const address = reverseGeocode.formattedAddress.toLowerCase();
      const isSensitive = SENSITIVE_ADDRESS_KEYWORDS.some(keyword => address.includes(keyword));

      return {
        category: isSensitive ? 'RESTRICTED' : 'PUBLIC',
        source: 'GOOGLE_GEOCODE',
        reverseGeocode,
      };
    } catch {
      return {category: 'PUBLIC', source: 'DEFAULT'};
    }
  },
};
