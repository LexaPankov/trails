// Cultural route optimizer: deterministic greedy insertion (an orienteering-problem heuristic).
//
//   gain(stop) = W_mode * value_eff - lambda_walk * extra_walk_min - lambda_visit * visit_min
//   value      = a_mode * personal_score(MLP) + (1 - a_mode) * significance
//   value_eff  = value with diversity damping (near-duplicate stops, repeated categories)
//
// Each place can be added as a VISIT (its full visit time) or a PASS-BY (the path goes past it and you
// look for ~2 minutes, worth passFactor of its value). Pass-bys are how even the fastest mode bends an
// ordinary A-to-B walk through streets with culture you care about.
// Hard constraints: walk_min(route) + visit_min(stops) <= budget, destination always last.
// Travel cost is counted once, as the extra walking a stop adds to the route.
import type { Place, RouteMode } from './types'

export interface ModeParams {
  W: number
  lambdaWalk: number
  lambdaVisit: number
  maxStops: number
  minValue: number
  /** the model must find the stop at least this relevant for this user */
  minPersonal: number
  personalWeight: number
  /** fraction of the budget the mode may use beyond the direct walk (fastest stays close to direct) */
  budgetShare: number
  /** pass-by stops allowed in addition to visits, and the share of a place's value a pass-by earns */
  maxPass: number
  passFactor: number
}

export const PASS_MINUTES = 2

export const MODE_PARAMS: Record<RouteMode, ModeParams> = {
  fastest: { W: 6, lambdaWalk: 1.0, lambdaVisit: 0.6, maxStops: 2, minValue: 0.62, minPersonal: 0.6, personalWeight: 0.7, budgetShare: 0.35, maxPass: 4, passFactor: 0.6 },
  discovery: { W: 10, lambdaWalk: 0.6, lambdaVisit: 0.25, maxStops: 6, minValue: 0.45, minPersonal: 0.5, personalWeight: 0.7, budgetShare: 1, maxPass: 4, passFactor: 0.35 },
  history: { W: 14, lambdaWalk: 0.35, lambdaVisit: 0.1, maxStops: 10, minValue: 0.3, minPersonal: 0.3, personalWeight: 0.5, budgetShare: 1, maxPass: 4, passFactor: 0.25 },
}

export const MODE_LABEL: Record<RouteMode, string> = {
  fastest: 'Fastest practical',
  discovery: 'Cultural discovery',
  history: 'Maximum history',
}

export const MODE_BLURB: Record<RouteMode, string> = {
  fastest: 'Arrive efficiently; only very convenient discoveries.',
  discovery: 'Balance travel time with personalised discoveries.',
  history: 'Favour culturally rich stops within your time budget.',
}

export interface Candidate {
  place: Place
  personal: number // MLP relevance in [0, 1]
  saved?: boolean
}

export interface OptimizeInput {
  candidates: Candidate[]
  /** metres between nodes; node 0 = start, node 1 = end, node 2+i = candidates[i] */
  walkMeters: (a: number, b: number) => number
  budgetMin: number
  speedKmh: number
  mode: RouteMode
}

export type StopKind = 'visit' | 'pass'

export interface StopDecision {
  place: Place
  kind: StopKind
  value: number
  personal: number
  extraWalkMin: number
  visitMin: number
  gain: number
}

export interface OptimizeResult {
  stops: StopDecision[]
  directWalkMin: number
  walkMin: number
  visitMin: number
  totalMin: number
  reachable: boolean
  considered: number
}

export function baseValue(c: Candidate, mode: RouteMode): number {
  const a = MODE_PARAMS[mode].personalWeight
  const sig = (c.place.significance - 1) / 4
  return Math.min(1, a * c.personal + (1 - a) * sig + (c.saved ? 0.1 : 0))
}

function effValue(i: number, chosen: number[], cands: Candidate[], base: number[], dist: (a: number, b: number) => number) {
  let v = base[i]
  const cat = cands[i].place.category
  let sameCat = 0
  for (const j of chosen) {
    if (dist(i + 2, j + 2) < 110) v *= 0.45 // near-duplicate (e.g. three fountains in one square)
    if (cands[j].place.category === cat) sameCat++
  }
  return v * Math.pow(0.85, sameCat)
}

export function optimizeRoute(inp: OptimizeInput): OptimizeResult {
  const P = MODE_PARAMS[inp.mode]
  const mPerMin = (inp.speedKmh * 1000) / 60
  const d = inp.walkMeters
  const directWalkMin = d(0, 1) / mPerMin
  const reachable = directWalkMin <= inp.budgetMin
  const cap = Math.min(inp.budgetMin, directWalkMin + P.budgetShare * Math.max(0, inp.budgetMin - directWalkMin))

  const base = inp.candidates.map((c) => baseValue(c, inp.mode))
  // corridor pruning: a stop must be reachable within the cap on its own
  const pool = inp.candidates
    .map((_, i) => i)
    .filter((i) => base[i] >= P.minValue && inp.candidates[i].personal >= P.minPersonal)
    .filter((i) => (d(0, i + 2) + d(i + 2, 1)) / mPerMin + Math.min(PASS_MINUTES, inp.candidates[i].place.visit_minutes) <= cap)

  const order: number[] = [] // candidate indices in visiting order
  const nodeOf = (pos: number) => (pos === 0 ? 0 : pos === order.length + 1 ? 1 : order[pos - 1] + 2)
  let walkM = d(0, 1)
  let visit = 0
  const decisions = new Map<number, StopDecision>()

  const count = { visit: 0, pass: 0 }
  const limit = { visit: P.maxStops, pass: P.maxPass }
  if (reachable) {
    for (;;) {
      let best: { i: number; pos: number; gain: number; extraM: number; v: number; kind: StopKind; vm: number } | null = null
      for (const i of pool) {
        if (order.includes(i)) continue
        const v0 = effValue(i, order, inp.candidates, base, d)
        if (v0 < P.minValue * 0.8) continue
        for (const kind of ['visit', 'pass'] as const) {
          if (count[kind] >= limit[kind]) continue
          const v = kind === 'visit' ? v0 : v0 * P.passFactor
          const vm = kind === 'visit' ? inp.candidates[i].place.visit_minutes : Math.min(PASS_MINUTES, inp.candidates[i].place.visit_minutes)
          for (let pos = 0; pos <= order.length; pos++) {
            const a = nodeOf(pos), b = nodeOf(pos + 1)
            const extraM = d(a, i + 2) + d(i + 2, b) - d(a, b)
            const total = (walkM + extraM) / mPerMin + visit + vm
            if (total > cap + 1e-9) continue
            const gain = P.W * v - P.lambdaWalk * (extraM / mPerMin) - P.lambdaVisit * vm
            const better = !best || gain > best.gain + 1e-9 ||
              (Math.abs(gain - best.gain) <= 1e-9 && (inp.candidates[i].place.id < inp.candidates[best.i].place.id ||
                (inp.candidates[i].place.id === inp.candidates[best.i].place.id && kind === 'visit')))
            if (gain > 0 && better) best = { i, pos, gain, extraM, v, kind, vm }
          }
        }
      }
      if (!best) break
      order.splice(best.pos, 0, best.i)
      walkM += best.extraM
      visit += best.vm
      count[best.kind]++
      decisions.set(best.i, {
        place: inp.candidates[best.i].place, kind: best.kind, value: best.v, personal: inp.candidates[best.i].personal,
        extraWalkMin: best.extraM / mPerMin, visitMin: best.vm, gain: best.gain,
      })
    }
  }
  const walkMin = walkM / mPerMin
  return {
    stops: order.map((i) => decisions.get(i)!),
    directWalkMin, walkMin, visitMin: visit, totalMin: walkMin + visit, reachable, considered: pool.length,
  }
}
