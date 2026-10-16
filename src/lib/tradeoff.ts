// What TRAILS adds over the fastest walk: extra minutes against the culture you get for them.
// Counts only places actually on each route (stops, or within ~40 m of the path).
import type { Plan } from './planner'

/** personal score at or above this counts as a strong match for the walker */
export const STRONG_MATCH = 0.6

export interface Tradeoff {
  fastestMin: number
  trailsMin: number
  /** walking + exploring minutes beyond the fastest walk */
  extraMin: number
  fastestPlaces: string[]
  trailsPlaces: string[]
  fastestStrong: number
  trailsStrong: number
  /** strong matches among the stops TRAILS chose */
  stopsStrong: number
}

export function tradeoff(plan: Plan): Tradeoff {
  const trailsPlaces = [...plan.stops.map((s) => s.place.id), ...(plan.passing ?? [])]
  const fastestPlaces = plan.directPassing ?? []
  const strong = (ids: string[]) => ids.filter((id) => (plan.scores[id] ?? 0) >= STRONG_MATCH).length
  return {
    fastestMin: plan.directWalkMin,
    trailsMin: plan.totalMin,
    extraMin: Math.max(0, plan.totalMin - plan.directWalkMin),
    fastestPlaces, trailsPlaces,
    fastestStrong: strong(fastestPlaces), trailsStrong: strong(trailsPlaces),
    stopsStrong: strong(plan.stops.map((s) => s.place.id)),
  }
}
