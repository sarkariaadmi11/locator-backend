import {env} from '../config/env';
import {logger} from '../config/logger';
import {HttpError} from '../utils/httpError';
import {createTtlCache} from '../utils/ttlCache';

const PLACES_BASE_URL = 'https://maps.googleapis.com/maps/api/place';
const GEOCODE_BASE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

const PLACE_DETAILS_TTL_MS = 24 * 60 * 60 * 1000;
const REVERSE_GEOCODE_TTL_MS = 60 * 60 * 1000;

const placeDetailsCache = createTtlCache<PlaceDetails>();
const reverseGeocodeCache = createTtlCache<ReverseGeocodeResult>();

const UNAVAILABLE_MESSAGE = 'Unable to fetch places right now. Please try again shortly.';

export type PlaceSummary = {
  placeId: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  rating: number | null;
  userRatingsTotal: number | null;
  photoReference: string | null;
  openNow: boolean | null;
};

export type PlaceDetails = PlaceSummary & {
  phoneNumber: string | null;
  website: string | null;
  openingHours: string[];
  photoReferences: string[];
};

export type ReverseGeocodeResult = {
  formattedAddress: string;
  placeId: string;
  latitude: number;
  longitude: number;
  city: string | null;
};

export type PlacesSearchResult = {
  results: PlaceSummary[];
  nextPageToken: string | null;
};

type GooglePlaceResult = {
  place_id: string;
  name: string;
  vicinity?: string;
  formatted_address?: string;
  geometry?: {location?: {lat: number; lng: number}};
  types?: string[];
  rating?: number;
  user_ratings_total?: number;
  photos?: {photo_reference: string}[];
  opening_hours?: {open_now?: boolean};
};

type GooglePlacesResponse = {
  status: string;
  error_message?: string;
  results?: GooglePlaceResult[];
  next_page_token?: string;
};

type GooglePlaceDetailsResponse = {
  status: string;
  error_message?: string;
  result?: GooglePlaceResult & {
    formatted_phone_number?: string;
    website?: string;
    opening_hours?: {open_now?: boolean; weekday_text?: string[]};
  };
};

type GoogleAddressComponent = {long_name: string; short_name: string; types: string[]};

type GoogleGeocodeResponse = {
  status: string;
  error_message?: string;
  results?: {
    formatted_address: string;
    place_id: string;
    geometry?: {location?: {lat: number; lng: number}};
    address_components?: GoogleAddressComponent[];
  }[];
};

// Google doesn't return a single "city" field — derive one from address_components, preferring
// `locality` (the common case) and falling back to broader administrative levels for addresses
// that don't have one (e.g. resolve to an unincorporated area).
const CITY_COMPONENT_TYPES = ['locality', 'administrative_area_level_2', 'administrative_area_level_3'];

function extractCity(components: GoogleAddressComponent[] | undefined): string | null {
  if (!components) return null;
  for (const type of CITY_COMPONENT_TYPES) {
    const match = components.find(c => c.types.includes(type));
    if (match) return match.long_name;
  }
  return null;
}

function requireApiKey(): string {
  if (!env.GOOGLE_PLACES_API_KEY) {
    throw new HttpError(503, 'Places service is not configured.');
  }
  return env.GOOGLE_PLACES_API_KEY;
}

async function googleFetch<T extends {status: string; error_message?: string}>(
  context: string,
  url: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    logger.error(`[placesService.${context}] Network error calling Google: ${(err as Error).message}`);
    throw new HttpError(502, UNAVAILABLE_MESSAGE);
  }

  if (!res.ok) {
    const body = await res.text();
    logger.error(`[placesService.${context}] Google responded with HTTP ${res.status}: ${body}`);
    throw new HttpError(502, UNAVAILABLE_MESSAGE);
  }

  const data = (await res.json()) as T;

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    logger.error(
      `[placesService.${context}] Google status="${data.status}" error_message="${data.error_message ?? ''}"`,
    );
    throw new HttpError(502, UNAVAILABLE_MESSAGE);
  }

  return data;
}

function normalizeResult(result: GooglePlaceResult): PlaceSummary {
  return {
    placeId: result.place_id,
    name: result.name,
    address: result.formatted_address ?? result.vicinity ?? null,
    latitude: result.geometry?.location?.lat ?? 0,
    longitude: result.geometry?.location?.lng ?? 0,
    category: result.types?.[0] ?? null,
    rating: result.rating ?? null,
    userRatingsTotal: result.user_ratings_total ?? null,
    photoReference: result.photos?.[0]?.photo_reference ?? null,
    openNow: result.opening_hours?.open_now ?? null,
  };
}

function roundCoord(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

export const placesService = {
  async nearbySearch(params: {
    lat: number;
    lng: number;
    radius: number;
    category?: string;
    pageToken?: string;
  }): Promise<PlacesSearchResult> {
    const apiKey = requireApiKey();

    const query = new URLSearchParams({key: apiKey});
    if (params.pageToken) {
      query.set('pagetoken', params.pageToken);
    } else {
      query.set('location', `${params.lat},${params.lng}`);
      query.set('radius', String(params.radius));
      if (params.category) query.set('type', params.category);
    }

    const data = await googleFetch<GooglePlacesResponse>(
      'nearbySearch',
      `${PLACES_BASE_URL}/nearbysearch/json?${query.toString()}`,
    );

    return {
      results: (data.results ?? []).map(normalizeResult),
      nextPageToken: data.next_page_token ?? null,
    };
  },

  async textSearch(params: {
    query: string;
    lat?: number;
    lng?: number;
    pageToken?: string;
  }): Promise<PlacesSearchResult> {
    const apiKey = requireApiKey();

    const query = new URLSearchParams({key: apiKey});
    if (params.pageToken) {
      query.set('pagetoken', params.pageToken);
    } else {
      query.set('query', params.query);
      if (params.lat !== undefined && params.lng !== undefined) {
        query.set('location', `${params.lat},${params.lng}`);
      }
    }

    const data = await googleFetch<GooglePlacesResponse>(
      'textSearch',
      `${PLACES_BASE_URL}/textsearch/json?${query.toString()}`,
    );

    return {
      results: (data.results ?? []).map(normalizeResult),
      nextPageToken: data.next_page_token ?? null,
    };
  },

  async getPlaceDetails(placeId: string): Promise<PlaceDetails> {
    const cached = placeDetailsCache.get(placeId);
    if (cached) return cached;

    const apiKey = requireApiKey();
    const query = new URLSearchParams({
      key: apiKey,
      place_id: placeId,
      fields:
        'place_id,name,formatted_address,geometry,type,rating,user_ratings_total,photo,opening_hours,formatted_phone_number,website',
    });

    const data = await googleFetch<GooglePlaceDetailsResponse>(
      'getPlaceDetails',
      `${PLACES_BASE_URL}/details/json?${query.toString()}`,
    );

    if (!data.result) {
      throw new HttpError(404, 'Place not found.');
    }

    const summary = normalizeResult(data.result);
    const details: PlaceDetails = {
      ...summary,
      phoneNumber: data.result.formatted_phone_number ?? null,
      website: data.result.website ?? null,
      openingHours: data.result.opening_hours?.weekday_text ?? [],
      photoReferences: (data.result.photos ?? []).map(p => p.photo_reference),
    };

    placeDetailsCache.set(placeId, details, PLACE_DETAILS_TTL_MS);
    return details;
  },

  async reverseGeocode(params: {lat: number; lng: number}): Promise<ReverseGeocodeResult> {
    const cacheKey = `${roundCoord(params.lat)},${roundCoord(params.lng)}`;
    const cached = reverseGeocodeCache.get(cacheKey);
    if (cached) return cached;

    const apiKey = requireApiKey();
    const query = new URLSearchParams({key: apiKey, latlng: `${params.lat},${params.lng}`});

    const data = await googleFetch<GoogleGeocodeResponse>(
      'reverseGeocode',
      `${GEOCODE_BASE_URL}?${query.toString()}`,
    );

    const first = data.results?.[0];
    if (!first) {
      throw new HttpError(404, 'No address found for this location.');
    }

    const result: ReverseGeocodeResult = {
      formattedAddress: first.formatted_address,
      placeId: first.place_id,
      latitude: first.geometry?.location?.lat ?? params.lat,
      longitude: first.geometry?.location?.lng ?? params.lng,
      city: extractCity(first.address_components),
    };

    reverseGeocodeCache.set(cacheKey, result, REVERSE_GEOCODE_TTL_MS);
    return result;
  },
};
