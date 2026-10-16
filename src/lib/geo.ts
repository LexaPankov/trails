import type { LatLon } from './types'

const R = 6371000

export function haversine(a: LatLon, b: LatLon): number {
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = p2 - p1
  const dl = ((b.lon - a.lon) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function bearing(a: LatLon, b: LatLon): number {
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dl = ((b.lon - a.lon) * Math.PI) / 180
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Decode a Google-style encoded polyline (Valhalla uses precision 6, OSRM precision 5). */
export function decodePolyline(str: string, precision = 6): [number, number][] {
  const factor = 10 ** precision
  const out: [number, number][] = []
  let index = 0, lat = 0, lon = 0
  while (index < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, byte: number
      do {
        byte = str.charCodeAt(index++) - 63
        result |= (byte & 0x1f) << shift
        shift += 5
      } while (byte >= 0x20)
      const delta = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += delta
      else lon += delta
    }
    out.push([lat / factor, lon / factor])
  }
  return out
}

export function pathLength(coords: [number, number][]): number {
  let d = 0
  for (let i = 1; i < coords.length; i++) {
    d += haversine({ lat: coords[i - 1][0], lon: coords[i - 1][1] }, { lat: coords[i][0], lon: coords[i][1] })
  }
  return d
}

/** Project a point onto a polyline: returns distance from the line and distance along it (metres). */
export function projectOnPath(p: LatLon, coords: [number, number][]): { offset: number; along: number; index: number } {
  let best = { offset: Infinity, along: 0, index: 0 }
  let acc = 0
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111320
  const ky = 110540
  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1][1] * kx, ay = coords[i - 1][0] * ky
    const bx = coords[i][1] * kx, by = coords[i][0] * ky
    const px = p.lon * kx, py = p.lat * ky
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
    const qx = ax + t * dx, qy = ay + t * dy
    const off = Math.hypot(px - qx, py - qy)
    const seg = Math.sqrt(len2)
    if (off < best.offset) best = { offset: off, along: acc + t * seg, index: i - 1 }
    acc += seg
  }
  return best
}

/** Point at a given distance along a path. */
export function pointAlong(coords: [number, number][], dist: number): LatLon {
  let acc = 0
  for (let i = 1; i < coords.length; i++) {
    const a = { lat: coords[i - 1][0], lon: coords[i - 1][1] }
    const b = { lat: coords[i][0], lon: coords[i][1] }
    const seg = haversine(a, b)
    if (acc + seg >= dist) {
      const t = seg === 0 ? 0 : (dist - acc) / seg
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }
    }
    acc += seg
  }
  const last = coords[coords.length - 1]
  return { lat: last[0], lon: last[1] }
}

export function formatDistance(m: number): string {
  if (m < 950) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(1)} km`
}

export function formatMinutes(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim()
}
