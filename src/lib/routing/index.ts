// Routing adapter: tries providers in order with a timeout, caches results, and always
// falls back to a clearly-labelled estimate so a failed request never leaves a broken screen.
import type { LatLon } from '../types'
import { estimateProvider, osrmProvider, valhallaProvider } from './providers'
import type { RoutingProvider, WalkingRoute } from './types'
import { loadWalkGraph, walkGraphProvider } from './walkGraph'

export type ProviderChoice = 'auto' | 'valhalla' | 'osrm-foot' | 'trails-local' | 'estimate'

export interface RouteAttempt { provider: string; ok: boolean; error?: string; ms: number }

const cache = new Map<string, WalkingRoute>()
const TIMEOUT_MS = 9000

function cacheKey(p: string, wps: LatLon[], speed: number) {
  return `${p}|${speed}|${wps.map((w) => `${w.lat.toFixed(5)},${w.lon.toFixed(5)}`).join(';')}`
}

async function withTimeout<T>(fn: (s: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    return await fn(ctl.signal)
  } finally {
    clearTimeout(t)
  }
}

export async function providerChain(choice: ProviderChoice, offline: boolean): Promise<RoutingProvider[]> {
  const graph = await loadWalkGraph()
  const local = graph ? [walkGraphProvider(graph)] : []
  const live = offline ? [] : [valhallaProvider, osrmProvider]
  switch (choice) {
    case 'valhalla': return [...(offline ? [] : [valhallaProvider]), ...local, estimateProvider]
    case 'osrm-foot': return [...(offline ? [] : [osrmProvider]), ...local, estimateProvider]
    case 'trails-local': return [...local, ...live, estimateProvider]
    case 'estimate': return [estimateProvider]
    default: return [...local, ...live, estimateProvider]
  }
}

export async function routeWalk(
  waypoints: LatLon[],
  opts: { speedKmh: number; choice?: ProviderChoice; offline?: boolean },
): Promise<{ route: WalkingRoute; attempts: RouteAttempt[] }> {
  const chain = await providerChain(opts.choice ?? 'auto', !!opts.offline)
  const attempts: RouteAttempt[] = []
  for (const p of chain) {
    const key = cacheKey(p.id, waypoints, opts.speedKmh)
    const hit = cache.get(key)
    if (hit) return { route: hit, attempts: [...attempts, { provider: p.id, ok: true, ms: 0 }] }
    const t0 = performance.now()
    try {
      const route = await withTimeout((signal) => p.route(waypoints, { speedKmh: opts.speedKmh, signal }), TIMEOUT_MS)
      cache.set(key, route)
      attempts.push({ provider: p.id, ok: true, ms: Math.round(performance.now() - t0) })
      return { route, attempts }
    } catch (e) {
      attempts.push({ provider: p.id, ok: false, error: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - t0) })
    }
  }
  throw new Error('All routing providers failed') // unreachable: estimate never throws
}

export const QUALITY_LABEL: Record<WalkingRoute['quality'], string> = {
  live: 'Live pedestrian route',
  local: 'Pedestrian route (bundled OSM street network)',
  estimate: 'Approximate estimate, not a verified walking route',
}
