/**
 * Plain geometry for the regional geography registry (D-048, docs/38 §3): great-circle distance,
 * point in polygon, and distance to a polygon's edge. Coordinates are [longitude, latitude] in
 * degrees, as GeoJSON writes them. No projection library: the distances that matter here are tens
 * of kilometres, where a sphere is exact enough.
 */

/** IUGG mean Earth radius, km. */
export const EARTH_RADIUS_KM = 6371.0088;

export type LonLat = readonly [number, number];
/** A GeoJSON polygon: an outer ring followed by any holes. */
export type PolygonRings = readonly (readonly LonLat[])[];

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle (haversine) distance in km between two points given as latitude and longitude. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Even-odd ray casting over every ring, so a point in a hole is outside. */
export function polygonContains(polygon: PolygonRings, lon: number, lat: number): boolean {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * Shortest distance in km from a point to any edge of the polygons, on a local flat projection
 * centred on the point (exact to well under 1% within 50 km, which is all it is used for).
 */
export function distanceToEdgesKm(polygons: readonly PolygonRings[], lon: number, lat: number): number {
  const kmPerDegree = (Math.PI / 180) * EARTH_RADIUS_KM;
  const xScale = Math.cos(radians(lat)) * kmPerDegree;
  let best = Number.POSITIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - lon) * xScale;
        const ay = (ring[i - 1][1] - lat) * kmPerDegree;
        const bx = (ring[i][0] - lon) * xScale;
        const by = (ring[i][1] - lat) * kmPerDegree;
        const dx = bx - ax;
        const dy = by - ay;
        const length2 = dx * dx + dy * dy;
        const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
        const distance = Math.hypot(ax + t * dx, ay + t * dy);
        if (distance < best) best = distance;
      }
    }
  }
  return best;
}

export interface BoundingBox { minLon: number; minLat: number; maxLon: number; maxLat: number }

export function boundingBox(polygons: readonly PolygonRings[]): BoundingBox {
  const box = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const polygon of polygons) for (const [lon, lat] of polygon[0] ?? []) {
    if (lon < box.minLon) box.minLon = lon;
    if (lon > box.maxLon) box.maxLon = lon;
    if (lat < box.minLat) box.minLat = lat;
    if (lat > box.maxLat) box.maxLat = lat;
  }
  return box;
}

/** True when the point lies within `marginKm` of the box (a cheap filter before the exact tests). */
export function nearBox(box: BoundingBox, lon: number, lat: number, marginKm: number): boolean {
  const latMargin = marginKm / ((Math.PI / 180) * EARTH_RADIUS_KM);
  const lonMargin = latMargin / Math.max(0.01, Math.cos(radians(lat)));
  return lon >= box.minLon - lonMargin && lon <= box.maxLon + lonMargin && lat >= box.minLat - latMargin && lat <= box.maxLat + latMargin;
}

/** Approximate area in km² (outer rings less holes, on a flat projection at each ring's mean latitude). */
export function approximateAreaKm2(polygons: readonly PolygonRings[]): number {
  const kmPerDegree = (Math.PI / 180) * EARTH_RADIUS_KM;
  let total = 0;
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      if (ring.length < 3) return;
      const xScale = Math.cos(radians(ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length)) * kmPerDegree;
      let twice = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) twice += ring[j][0] * xScale * ring[i][1] * kmPerDegree - ring[i][0] * xScale * ring[j][1] * kmPerDegree;
      total += (index === 0 ? 1 : -1) * Math.abs(twice / 2);
    });
  }
  return total;
}
