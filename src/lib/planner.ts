// Orchestrates one TRAILS plan: score places with the preference model -> optimise the stop
// selection -> fetch a real pedestrian route -> re-check the time budget against real durations.
import { PLACES } from './data'
import { haversine } from './geo'
import type { Scorer } from './model/mlp'
import { optimizeRoute, PASS_MINUTES, type Candidate, type OptimizeResult } from './optimizer'
import type { Profile } from './profile'
import { routeWalk, type ProviderChoice, type RouteAttempt } from './routing'
import { ESTIMATE_DETOUR_FACTOR } from './routing/providers'
import type { WalkingRoute } from './routing/types'
import { loadWalkGraph, type WalkGraph } from './routing/walkGraph'
import type { Endpoint, Place, RouteMode } from './types'

export interface PlanRequest {
  start: Endpoint
  end: Endpoint
  budgetMin: number
  mode: RouteMode
  routing?: ProviderChoice
  offline?: boolean
  /** places to leave out of this plan only (e.g. skipped from the results screen) */
  exclude?: string[]
}

export interface PlannedStop {
  place: Place
  /** visit = stop and explore; pass = the path goes past it (about 2 minutes to look) */
  kind: 'visit' | 'pass'
  personal: number
  value: number
  detourMin: number
  visitMin: number
}

export interface Plan {
  request: PlanRequest
  stops: PlannedStop[]
  route: WalkingRoute
  direct: WalkingRoute
  attempts: RouteAttempt[]
  scorer: { source: Scorer['source']; info: string }
  selectionCost: 'street-network' | 'pedestrian-matrix' | 'straight-line-estimate'
  walkMin: number
  visitMin: number
  totalMin: number
  directWalkMin: number
  withinBudget: boolean
  reachable: boolean
  droppedForBudget: string[]
  /** places within ~40 m of the final path that are not stops: you walk past them anyway */
  passing: string[]
  /** the same, for the fastest (direct) route: what you would see without TRAILS */
  directPassing: string[]
  scores: Record<string, number>
  createdAt: number
}

export function scorePlaces(scorer: Scorer, profile: Profile): Record<string, number> {
  return Object.fromEntries(PLACES.map((p) => [p.id, scorer.score(profile.interests, profile.affinity, p)]))
}

export interface WalkMatrixFile { ids: string[]; distance_m: (number | null)[][]; provider: string; fetched: string }

let matrixP: Promise<WalkMatrixFile | null> | null = null
export function loadWalkMatrix(): Promise<WalkMatrixFile | null> {
  if (!matrixP) {
    matrixP = fetch(`${import.meta.env?.BASE_URL ?? '/'}data/walk_matrix.json`)
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
  }
  return matrixP
}

type Node = { lat: number; lon: number; id?: string; placeId?: string }

/** Pairwise walking metres for [start, end, ...candidates]: street graph, else the bundled
 *  Valhalla pedestrian matrix (place-to-place pairs), else straight line x detour factor. */
function buildCost(nodes: Node[], graph: WalkGraph | null, matrix: WalkMatrixFile | null) {
  const est = (a: number, b: number) => haversine(nodes[a], nodes[b]) * ESTIMATE_DETOUR_FACTOR
  if (!graph && matrix) {
    const idx = new Map(matrix.ids.map((id, i) => [id, i]))
    const mi = nodes.map((n) => idx.get(n.placeId ?? n.id ?? ''))
    const cost = (a: number, b: number) => {
      if (a === b) return 0
      const i = mi[a], j = mi[b]
      const v = i !== undefined && j !== undefined ? matrix.distance_m[i][j] : null
      return v ?? est(a, b)
    }
    return { cost, kind: 'pedestrian-matrix' as const }
  }
  if (!graph) return { cost: est, kind: 'straight-line-estimate' as const }
  const snapped = nodes.map((n) => graph.nearest(n))
  if (snapped.some((s) => !s)) return { cost: est, kind: 'straight-line-estimate' as const }
  const memo = new Map<number, Float64Array>()
  const cost = (a: number, b: number) => {
    if (a === b) return 0
    let row = memo.get(a)
    if (!row) { row = graph.distancesFrom(snapped[a]!.node); memo.set(a, row) }
    const v = row[snapped[b]!.node]
    return isFinite(v) ? v + snapped[a]!.dist + snapped[b]!.dist : est(a, b)
  }
  return { cost, kind: 'street-network' as const }
}

/** Places within `maxM` metres of the path (point-to-segment distance in a local flat projection). */
export function placesAlong(geometry: [number, number][], skip: Set<string>, maxM = 40): string[] {
  if (geometry.length < 2) return []
  const kx = 111320 * Math.cos((geometry[0][0] * Math.PI) / 180), ky = 110540
  const out: { id: string; at: number }[] = []
  for (const p of PLACES) {
    if (skip.has(p.id)) continue
    let best = Infinity, at = 0
    for (let k = 1; k < geometry.length; k++) {
      const [ay, ax] = geometry[k - 1], [by, bx] = geometry[k]
      const x1 = (ax - p.lon) * kx, y1 = (ay - p.lat) * ky, x2 = (bx - p.lon) * kx, y2 = (by - p.lat) * ky
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / len2)) : 0
      const dd = Math.hypot(x1 + t * dx, y1 + t * dy)
      if (dd < best) { best = dd; at = k }
    }
    if (best <= maxM) out.push({ id: p.id, at })
  }
  return out.sort((a, b) => a.at - b.at).map((x) => x.id)
}

export async function planRoute(req: PlanRequest, profile: Profile, scorer: Scorer): Promise<Plan> {
  const speed = profile.walkingSpeedKmh
  const mPerMin = (speed * 1000) / 60
  const scores = scorePlaces(scorer, profile)
  const graph = req.routing === 'estimate' ? null : await loadWalkGraph()
  const matrix = req.routing === 'estimate' || graph ? null : await loadWalkMatrix()

  // corridor pre-filter (cheap, straight-line) before computing street-network costs
  const direct = haversine(req.start, req.end)
  const slackM = Math.max(0, req.budgetMin * mPerMin - direct * ESTIMATE_DETOUR_FACTOR)
  const cands: Candidate[] = PLACES
    .filter((p) => p.id !== req.start.placeId && p.id !== req.end.placeId && !profile.dismissed.includes(p.id) && !(req.exclude ?? []).includes(p.id))
    .filter((p) => haversine(req.start, p) + haversine(p, req.end) - direct <= slackM / 1.1)
    .map((p) => ({ place: p, personal: scores[p.id], saved: profile.saved.includes(p.id) }))
    .sort((a, b) => b.personal - a.personal || a.place.id.localeCompare(b.place.id))
    .slice(0, 36)

  const nodes = [req.start, req.end, ...cands.map((c) => c.place)]
  const { cost, kind } = buildCost(nodes, graph, matrix)
  let opt: OptimizeResult = optimizeRoute({ candidates: cands, walkMeters: cost, budgetMin: req.budgetMin, speedKmh: speed, mode: req.mode })

  const directRoute = await routeWalk([req.start, req.end], { speedKmh: speed, choice: req.routing, offline: req.offline })
  let stops = opt.stops.map((s) => s.place)
  let res = stops.length
    ? await routeWalk([req.start, ...stops, req.end], { speedKmh: speed, choice: req.routing, offline: req.offline })
    : directRoute
  const dropped: string[] = []
  const visitOf = (ps: Place[]) => ps.reduce((a, p) => a + (opt.stops.find((s) => s.place === p)?.visitMin ?? p.visit_minutes), 0)

  // Enforce the budget with the durations the router actually returned.
  for (let iter = 0; iter < 6 && stops.length && res.route.duration_s / 60 + visitOf(stops) > req.budgetMin; iter++) {
    const worst = [...opt.stops].filter((s) => stops.includes(s.place))
      .sort((a, b) => a.value / (a.visitMin + a.extraWalkMin + 1) - b.value / (b.visitMin + b.extraWalkMin + 1))[0]
    dropped.push(worst.place.id)
    stops = stops.filter((p) => p !== worst.place)
    res = stops.length
      ? await routeWalk([req.start, ...stops, req.end], { speedKmh: speed, choice: req.routing, offline: req.offline })
      : directRoute
  }
  if (dropped.length) opt = { ...opt, stops: opt.stops.filter((s) => !dropped.includes(s.place.id)) }

  // per-stop detour against the final route order
  const legsMin = res.route.legs.map((l) => l.duration_s / 60)
  const planned: PlannedStop[] = stops.map((p, k) => {
    const d = opt.stops.find((s) => s.place === p)!
    const via = legsMin[k] + legsMin[k + 1]
    const prev = k === 0 ? req.start : stops[k - 1]
    const next = k === stops.length - 1 ? req.end : stops[k + 1]
    const skip = (haversine(prev, next) * (res.route.quality === 'estimate' ? ESTIMATE_DETOUR_FACTOR : 1.2)) / mPerMin
    return { place: p, kind: d.kind, personal: d.personal, value: d.value, detourMin: Math.max(0, via - skip), visitMin: d.visitMin }
  })

  const walkMin = res.route.duration_s / 60
  const visitMin = visitOf(stops)
  return {
    request: req,
    stops: planned,
    route: res.route,
    direct: directRoute.route,
    attempts: [...directRoute.attempts, ...res.attempts],
    scorer: { source: scorer.source, info: scorer.info },
    selectionCost: kind,
    walkMin, visitMin, totalMin: walkMin + visitMin,
    directWalkMin: directRoute.route.duration_s / 60,
    withinBudget: walkMin + visitMin <= req.budgetMin + 0.5,
    reachable: directRoute.route.duration_s / 60 <= req.budgetMin,
    droppedForBudget: dropped,
    passing: placesAlong(res.route.geometry, new Set([...stops.map((p) => p.id), req.start.placeId ?? '', req.end.placeId ?? ''])),
    directPassing: placesAlong(directRoute.route.geometry, new Set([req.start.placeId ?? '', req.end.placeId ?? ''])),
    scores,
    createdAt: Date.now(),
  }
}

/**
 * Rebuild a plan from a saved or shared walk: the same start, end and stops in the same order,
 * routed again on the street network (no re-optimisation, so the walk is exactly the one saved).
 */
export async function planFromStops(
  req: PlanRequest, stops: { id: string; kind: 'visit' | 'pass' }[], profile: Profile, scorer: Scorer,
): Promise<Plan> {
  const speed = profile.walkingSpeedKmh
  const mPerMin = (speed * 1000) / 60
  const scores = scorePlaces(scorer, profile)
  const byId = new Map(PLACES.map((p) => [p.id, p]))
  const kept = stops.filter((s) => byId.has(s.id))
  const places = kept.map((s) => byId.get(s.id)!)
  const opts = { speedKmh: speed, choice: req.routing, offline: req.offline }
  const directRoute = await routeWalk([req.start, req.end], opts)
  const res = places.length ? await routeWalk([req.start, ...places, req.end], opts) : directRoute
  const legsMin = res.route.legs.map((l) => l.duration_s / 60)
  const planned: PlannedStop[] = places.map((p, k) => {
    const kind = kept[k].kind
    const prev = k === 0 ? req.start : places[k - 1]
    const next = k === places.length - 1 ? req.end : places[k + 1]
    const skip = (haversine(prev, next) * (res.route.quality === 'estimate' ? ESTIMATE_DETOUR_FACTOR : 1.2)) / mPerMin
    const visitMin = kind === 'visit' ? p.visit_minutes : Math.min(PASS_MINUTES, p.visit_minutes)
    return { place: p, kind, personal: scores[p.id], value: scores[p.id], detourMin: Math.max(0, legsMin[k] + legsMin[k + 1] - skip), visitMin }
  })
  const walkMin = res.route.duration_s / 60
  const visitMin = planned.reduce((a, s) => a + s.visitMin, 0)
  const ends = [req.start.placeId ?? '', req.end.placeId ?? '']
  return {
    request: req,
    stops: planned,
    route: res.route,
    direct: directRoute.route,
    attempts: [...directRoute.attempts, ...res.attempts],
    scorer: { source: scorer.source, info: scorer.info },
    selectionCost: res.route.quality === 'estimate' ? 'straight-line-estimate' : 'street-network',
    walkMin, visitMin, totalMin: walkMin + visitMin,
    directWalkMin: directRoute.route.duration_s / 60,
    withinBudget: walkMin + visitMin <= req.budgetMin + 0.5,
    reachable: directRoute.route.duration_s / 60 <= req.budgetMin,
    droppedForBudget: [],
    passing: placesAlong(res.route.geometry, new Set([...places.map((p) => p.id), ...ends])),
    directPassing: placesAlong(directRoute.route.geometry, new Set(ends)),
    scores,
    createdAt: Date.now(),
  }
}
