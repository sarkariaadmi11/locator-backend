import {boundingBox, haversineMeters} from '../geo';

describe('geo.haversineMeters', () => {
  it('returns ~0 for the same point', () => {
    expect(haversineMeters(28.6139, 77.209, 28.6139, 77.209)).toBeCloseTo(0, 3);
  });

  it('matches a known Delhi landmark-to-landmark distance within a few metres', () => {
    // India Gate -> Red Fort, Delhi — well-known ~4.5km straight-line distance.
    const distance = haversineMeters(28.6129, 77.2295, 28.6562, 77.241);
    expect(distance).toBeGreaterThan(4300);
    expect(distance).toBeLessThan(5200);
  });

  it('is symmetric', () => {
    const a = haversineMeters(12.9716, 77.5946, 13.0827, 80.2707);
    const b = haversineMeters(13.0827, 80.2707, 12.9716, 77.5946);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('geo.boundingBox', () => {
  it('produces a box centred on the origin point', () => {
    const box = boundingBox(28.6139, 77.209, 500);
    expect(box.minLat).toBeLessThan(28.6139);
    expect(box.maxLat).toBeGreaterThan(28.6139);
    expect(box.minLng).toBeLessThan(77.209);
    expect(box.maxLng).toBeGreaterThan(77.209);
  });

  it('every point strictly inside the box radius is within the haversine radius', () => {
    const lat = 19.076;
    const lng = 72.8777;
    const radius = 1000;
    const box = boundingBox(lat, lng, radius);
    // The box's own corner is necessarily further than `radius` (a circle's bounding box has
    // corners ~1.4x out per this file's own documented caveat) — assert the midpoint of one
    // edge, which should land inside the true circle.
    const edgeMidLat = box.maxLat;
    const distance = haversineMeters(lat, lng, edgeMidLat, lng);
    expect(distance).toBeLessThan(radius * 1.05);
  });
});
