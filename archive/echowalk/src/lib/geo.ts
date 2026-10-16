const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface LatLon { lat: number; lon: number }

/** Great-circle distance in metres. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, 0..360 (0 = north, 90 = east). */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed smallest difference target - from, in -180..180. */
export function angleDiff(target: number, from: number): number {
  return ((target - from + 540) % 360) - 180;
}

export function normalizeHeading(h: number): number {
  return ((h % 360) + 360) % 360;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Circular exponential smoothing for compass headings (handles 359 -> 0 wrap). */
export class HeadingSmoother {
  private x = 0; private y = 0; private init = false;
  private alpha: number;
  constructor(alpha = 0.2) { this.alpha = alpha; }
  push(h: number): number {
    const sx = Math.cos(rad(h)), sy = Math.sin(rad(h));
    if (!this.init) { this.x = sx; this.y = sy; this.init = true; }
    else { this.x += this.alpha * (sx - this.x); this.y += this.alpha * (sy - this.y); }
    return normalizeHeading(deg(Math.atan2(this.y, this.x)));
  }
}
