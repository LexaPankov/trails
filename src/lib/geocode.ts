// Address search without Google: TRAILS places first (instant, offline), then OpenStreetMap geocoding.
// Photon (komoot, OSM data) supports type-ahead; Nominatim is used only on explicit search (its usage
// policy forbids autocomplete). Both are biased to central Rome. Override with VITE_PHOTON_URL / VITE_NOMINATIM_URL.
import { PLACES } from './data'
import type { Endpoint } from './types'

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
const PHOTON = env.VITE_PHOTON_URL || 'https://photon.komoot.io'
const NOMINATIM = env.VITE_NOMINATIM_URL || 'https://nominatim.openstreetmap.org'
export const ROME_BBOX = { west: 12.35, south: 41.8, east: 12.62, north: 41.99 }
const CENTER = { lat: 41.8986, lon: 12.4769 }

export interface GeoResult extends Endpoint { detail: string; source: 'trails' | 'photon' | 'nominatim' | 'map' }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

export function searchPlaces(q: string, limit = 5): GeoResult[] {
  const nq = norm(q)
  if (nq.length < 2) return []
  return PLACES
    .map((p) => {
      const n = norm(p.name)
      const score = n.startsWith(nq) ? 0 : n.split(' ').some((w) => w.startsWith(nq)) ? 1 : n.includes(nq) ? 2 : -1
      return { p, score }
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map(({ p }) => ({ lat: p.lat, lon: p.lon, label: p.name, placeId: p.id, detail: 'TRAILS place', source: 'trails' as const }))
}

export const inRome = (p: { lat: number; lon: number }) =>
  p.lat >= ROME_BBOX.south && p.lat <= ROME_BBOX.north && p.lon >= ROME_BBOX.west && p.lon <= ROME_BBOX.east

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: { name?: string; street?: string; housenumber?: string; district?: string; locality?: string; city?: string; osm_value?: string }
}

export function parsePhoton(json: { features?: PhotonFeature[] }): GeoResult[] {
  const out: GeoResult[] = []
  for (const f of json.features ?? []) {
    const [lon, lat] = f.geometry?.coordinates ?? []
    if (typeof lat !== 'number' || typeof lon !== 'number' || !inRome({ lat, lon })) continue
    const pr = f.properties ?? {}
    const street = [pr.street, pr.housenumber].filter(Boolean).join(' ')
    const label = pr.name || street
    if (!label) continue
    const detail = [pr.name ? street : '', pr.district || pr.locality, pr.city].filter(Boolean).join(', ')
    if (out.some((o) => o.label === label && Math.abs(o.lat - lat) < 3e-4 && Math.abs(o.lon - lon) < 3e-4)) continue
    out.push({ lat, lon, label, detail, source: 'photon' })
  }
  return out
}

export async function searchAddress(q: string, signal?: AbortSignal): Promise<GeoResult[]> {
  if (q.trim().length < 3) return []
  const b = ROME_BBOX
  const url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&lat=${CENTER.lat}&lon=${CENTER.lon}&limit=8&lang=en&bbox=${b.west},${b.south},${b.east},${b.north}`
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`address search answered ${r.status}`)
  return parsePhoton(await r.json())
}

/** Explicit search fallback (Enter key) via Nominatim. */
export async function searchAddressNominatim(q: string, signal?: AbortSignal): Promise<GeoResult[]> {
  const b = ROME_BBOX
  const url = `${NOMINATIM}/search?format=jsonv2&limit=6&bounded=1&viewbox=${b.west},${b.north},${b.east},${b.south}&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { signal, headers: { 'accept-language': 'en' } })
  if (!r.ok) throw new Error(`address search answered ${r.status}`)
  const rows = (await r.json()) as { lat: string; lon: string; name?: string; display_name: string }[]
  return rows.map((x) => {
    const parts = x.display_name.split(', ')
    return { lat: +x.lat, lon: +x.lon, label: x.name || parts[0], detail: parts.slice(1, 4).join(', '), source: 'nominatim' as const }
  }).filter(inRome)
}

/** Label for a dropped pin: nearest street from Photon reverse geocoding, else the coordinates. */
export async function reverseLabel(p: { lat: number; lon: number }, signal?: AbortSignal): Promise<string> {
  const fallback = `Pin at ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`
  try {
    const r = await fetch(`${PHOTON}/reverse?lat=${p.lat}&lon=${p.lon}&limit=1&lang=en`, { signal: signal ?? AbortSignal.timeout(5000) })
    if (!r.ok) return fallback
    const f = ((await r.json()) as { features?: PhotonFeature[] }).features?.[0]?.properties
    const street = [f?.street, f?.housenumber].filter(Boolean).join(' ')
    return f?.name || street || fallback
  } catch {
    return fallback
  }
}
