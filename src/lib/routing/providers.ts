import { decodePolyline, haversine } from '../geo'
import type { LatLon } from '../types'
import type { RouteLeg, RoutingProvider, WalkingRoute } from './types'

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}

/** FOSSGIS-hosted Valhalla (used by openstreetmap.org). Fair-use public service; set VITE_VALHALLA_URL for your own. */
export const VALHALLA_URL = env.VITE_VALHALLA_URL || 'https://valhalla1.openstreetmap.de'
/** FOSSGIS-hosted OSRM foot profile. Set VITE_OSRM_FOOT_URL for your own. */
export const OSRM_FOOT_URL = env.VITE_OSRM_FOOT_URL || 'https://routing.openstreetmap.de/routed-foot'

/** Detour factor applied to straight-line distance when no routing data exists. */
export const ESTIMATE_DETOUR_FACTOR = 1.35

interface ValhallaManeuver { instruction: string; length: number; begin_shape_index: number }
interface ValhallaLeg { shape: string; summary: { length: number; time: number }; maneuvers: ValhallaManeuver[] }

export const valhallaProvider: RoutingProvider = {
  id: 'valhalla',
  label: 'Valhalla pedestrian routing (OpenStreetMap)',
  quality: 'live',
  async route(waypoints, { speedKmh, signal }) {
    const body = {
      locations: waypoints.map((w) => ({ lat: w.lat, lon: w.lon, type: 'break' })),
      costing: 'pedestrian',
      costing_options: { pedestrian: { walking_speed: speedKmh } },
      units: 'kilometers',
      directions_options: { language: 'en-US' },
    }
    const r = await fetch(`${VALHALLA_URL}/route`, {
      method: 'POST', body: JSON.stringify(body), signal, headers: { 'Content-Type': 'application/json' },
    })
    if (!r.ok) throw new Error(`Valhalla HTTP ${r.status}`)
    const j = await r.json()
    const legs: RouteLeg[] = (j.trip.legs as ValhallaLeg[]).map((l) => ({
      distance_m: l.summary.length * 1000,
      duration_s: l.summary.time,
      geometry: decodePolyline(l.shape, 6),
      maneuvers: l.maneuvers.map((m) => ({ instruction: m.instruction, distance_m: m.length * 1000, begin: m.begin_shape_index })),
    }))
    return assemble('valhalla', 'live', legs)
  },
}

interface OsrmStep { maneuver: { type: string; modifier?: string }; name: string; distance: number; geometry: string }
interface OsrmLeg { distance: number; steps: OsrmStep[] }

function osrmInstruction(s: OsrmStep): string {
  const street = s.name ? ` onto ${s.name}` : ''
  const t = s.maneuver.type
  if (t === 'depart') return `Head out${s.name ? ` on ${s.name}` : ''}`
  if (t === 'arrive') return 'You have arrived at your stop'
  const mod = s.maneuver.modifier ? s.maneuver.modifier.replace('slight ', 'slightly ') : ''
  if (t === 'turn' || t === 'end of road' || t === 'fork') return `Turn ${mod}${street}`.trim()
  if (t === 'continue' || t === 'new name') return `Continue${street}`
  return `${t[0].toUpperCase()}${t.slice(1)} ${mod}${street}`.trim()
}

export const osrmProvider: RoutingProvider = {
  id: 'osrm-foot',
  label: 'OSRM foot profile (OpenStreetMap)',
  quality: 'live',
  async route(waypoints, { speedKmh, signal }) {
    const coords = waypoints.map((w) => `${w.lon.toFixed(6)},${w.lat.toFixed(6)}`).join(';')
    const r = await fetch(`${OSRM_FOOT_URL}/route/v1/foot/${coords}?overview=false&steps=true&geometries=polyline6`, { signal })
    if (!r.ok) throw new Error(`OSRM HTTP ${r.status}`)
    const j = await r.json()
    if (j.code !== 'Ok') throw new Error(`OSRM ${j.code}`)
    const legs: RouteLeg[] = (j.routes[0].legs as OsrmLeg[]).map((l) => {
      const geometry: [number, number][] = []
      const maneuvers = l.steps.map((s) => {
        const pts = decodePolyline(s.geometry, 6)
        const begin = Math.max(0, geometry.length - 1)
        geometry.push(...(geometry.length ? pts.slice(1) : pts))
        return { instruction: osrmInstruction(s), distance_m: s.distance, begin }
      })
      // duration from configured walking speed so all providers share one assumption
      return { distance_m: l.distance, duration_s: l.distance / (speedKmh / 3.6), geometry, maneuvers }
    })
    return assemble('osrm-foot', 'live', legs)
  },
}

/** Straight-line estimate. Explicitly NOT a walking route; geometry is drawn dashed in the UI. */
export const estimateProvider: RoutingProvider = {
  id: 'estimate',
  label: `Estimate: straight line × ${ESTIMATE_DETOUR_FACTOR}`,
  quality: 'estimate',
  async route(waypoints: LatLon[], { speedKmh }) {
    const legs: RouteLeg[] = []
    for (let i = 1; i < waypoints.length; i++) {
      const d = haversine(waypoints[i - 1], waypoints[i]) * ESTIMATE_DETOUR_FACTOR
      legs.push({
        distance_m: d,
        duration_s: d / (speedKmh / 3.6),
        geometry: [[waypoints[i - 1].lat, waypoints[i - 1].lon], [waypoints[i].lat, waypoints[i].lon]],
        maneuvers: [{ instruction: 'No street directions available: head towards the next stop', distance_m: d, begin: 0 }],
      })
    }
    const r = assemble('estimate', 'estimate', legs)
    r.note = `Approximate: straight-line distance × ${ESTIMATE_DETOUR_FACTOR}. Not a verified walking route.`
    return r
  },
}

export function assemble(provider: string, quality: WalkingRoute['quality'], legs: RouteLeg[]): WalkingRoute {
  const geometry: [number, number][] = []
  for (const l of legs) geometry.push(...(geometry.length ? l.geometry.slice(1) : l.geometry))
  return {
    provider, quality, legs, geometry,
    distance_m: legs.reduce((a, l) => a + l.distance_m, 0),
    duration_s: legs.reduce((a, l) => a + l.duration_s, 0),
  }
}
