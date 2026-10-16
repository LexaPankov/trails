import type { LatLon } from '../types'

/** live = a real pedestrian routing engine answered; local = TRAILS' own router on bundled OSM data;
 *  estimate = no routing data, straight-line distance x detour factor (NOT a walking route). */
export type RouteQuality = 'live' | 'local' | 'estimate'

export interface Maneuver {
  instruction: string
  distance_m: number
  /** index into geometry where the maneuver starts */
  begin: number
}

export interface RouteLeg {
  distance_m: number
  duration_s: number
  geometry: [number, number][] // [lat, lon]
  maneuvers: Maneuver[]
}

export interface WalkingRoute {
  provider: string
  quality: RouteQuality
  distance_m: number
  duration_s: number
  geometry: [number, number][]
  legs: RouteLeg[]
  note?: string
}

export interface RoutingProvider {
  id: string
  label: string
  quality: RouteQuality
  route(waypoints: LatLon[], opts: { speedKmh: number; signal?: AbortSignal }): Promise<WalkingRoute>
}
