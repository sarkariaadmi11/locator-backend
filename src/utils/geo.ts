const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Recording-GPS-vs-request-pin comparison (PRD §5.9.2 "GPS Map View") — shared by the
 * Moderation queue detail (`moderationPresenter.ts`) and the Dispute detail admin view
 * (`disputeService.adminDetail`), so both surfaces compute the same verdict the same way.
 */
export function buildGpsCheck(
  request: {latitude: number; longitude: number; radiusMeters: number},
  video: {gpsLatitude: number | null; gpsLongitude: number | null} | null,
) {
  const distanceMeters =
    video?.gpsLatitude != null && video?.gpsLongitude != null
      ? Math.round(haversineMeters(video.gpsLatitude, video.gpsLongitude, request.latitude, request.longitude))
      : null;

  return {
    requestLocation: {
      latitude: request.latitude,
      longitude: request.longitude,
      radiusMeters: request.radiusMeters,
    },
    recordingLocation:
      video?.gpsLatitude != null && video?.gpsLongitude != null
        ? {latitude: video.gpsLatitude, longitude: video.gpsLongitude}
        : null,
    distanceMeters,
    withinRadius: distanceMeters === null ? null : distanceMeters <= request.radiusMeters,
  };
}

export type BoundingBox = {minLat: number; maxLat: number; minLng: number; maxLng: number};

/**
 * Cheap rectangular prefilter for a DB query — must always be followed by an exact
 * `haversineMeters` filter, since a bounding box is not a circle (worse near the poles,
 * corners are ~1.4x the radius away). MVP-scale approach, not a PostGIS radius query.
 */
export function boundingBox(lat: number, lng: number, radiusMeters: number): BoundingBox {
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(toRadians(lat)) || 1);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
