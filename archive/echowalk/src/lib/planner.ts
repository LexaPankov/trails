import type { Place, PlanRequest, Theme } from '../types';
import { haversine } from './geo';

/** Tunable assumptions, shown in the UI. */
export const PLANNER_CONFIG = {
  walkSpeedMPerMin: 75, // 4.5 km/h, relaxed sightseeing pace
  streetFactor: 1.3, // straight line × 1.3 ≈ real street distance in a historic centre
  dwellMin: { highlights: 8, maximum: 4, climbs: 5 } as Record<string, number>,
  maxStops: { highlights: 6, maximum: 15, climbs: 10 } as Record<string, number>,
  minAddedMin: 2, // floor on detour cost so tiny detours don't dominate the score
};

export interface Plan {
  start: Place;
  end: Place;
  stops: Place[];
  estDistanceM: number;
  walkMin: number;
  dwellMin: number;
  totalMin: number;
  notes: string[];
}

const walkMinutes = (m: number) => (m * PLANNER_CONFIG.streetFactor) / PLANNER_CONFIG.walkSpeedMPerMin;

/** 0..1 relevance of a place to the selected themes. */
export function themeRelevance(p: Place, themes: Theme[]): number {
  if (themes.length === 0) return 1;
  const matches = themes.filter((t) => (t === 'hidden' ? p.hidden : p.themes.includes(t))).length;
  if (matches === 0) return 0;
  return 0.6 + 0.4 * (matches / themes.length);
}

/** Value of visiting a place (before dividing by detour cost). */
export function placeValue(p: Place, req: PlanRequest): number {
  const sig = p.significance / 5;
  const rel = themeRelevance(p, req.themes);
  if (rel === 0) return 0;
  if (req.mode === 'highlights') return p.significance >= 4 ? sig * sig * rel : 0;
  // maximum history: reward lesser-known places so the route isn't only postcards
  const hiddenBoost = p.hidden ? 1.35 : 1;
  return sig * rel * hiddenBoost;
}

function pathLength(nodes: Place[]): number {
  let d = 0;
  for (let i = 1; i < nodes.length; i++) d += haversine(nodes[i - 1], nodes[i]);
  return d;
}

/** 2-opt pass on the interior order, endpoints fixed. */
function improveOrder(nodes: Place[]): Place[] {
  let best = nodes.slice();
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 1; i < best.length - 2; i++) {
      for (let k = i + 1; k < best.length - 1; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (pathLength(cand) + 1 < pathLength(best)) { best = cand; improved = true; }
      }
    }
  }
  return best;
}

/**
 * Greedy waypoint insertion.
 * score = significance × theme relevance ÷ added minutes (detour + time at the stop),
 * only accepting insertions that keep the whole walk inside the time budget.
 */
export function planRoute(places: Place[], req: PlanRequest, budgetFactor = 1): Plan {
  const start = places.find((p) => p.id === req.startId);
  const end = places.find((p) => p.id === req.endId);
  if (!start || !end) throw new Error('Unknown start or destination');
  const budget = req.minutes * budgetFactor;
  const dwell = PLANNER_CONFIG.dwellMin[req.mode] ?? 5;
  const maxStops = PLANNER_CONFIG.maxStops[req.mode] ?? 10;
  const notes: string[] = [];

  let route: Place[] = start.id === end.id ? [start, end] : [start, end];
  const directMin = walkMinutes(pathLength(route));
  if (directMin > budget) {
    notes.push(`The direct walk already takes about ${Math.round(directMin)} min, more than the ${req.minutes} min you have. Showing the direct route.`);
  }

  const pool = places.filter((p) => p.id !== start.id && p.id !== end.id).map((p) => ({ p, v: placeValue(p, req) })).filter((c) => c.v > 0);
  const chosen = new Set<string>();
  let walk = directMin;
  let stops = 0;

  while (stops < maxStops) {
    let best: { idx: number; at: number; ratio: number; addWalk: number } | null = null;
    pool.forEach((c, idx) => {
      if (chosen.has(c.p.id)) return;
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i], b = route[i + 1];
        const addWalk = walkMinutes(haversine(a, c.p) + haversine(c.p, b) - haversine(a, b));
        const added = addWalk + dwell;
        if (walk + (stops + 1) * dwell + addWalk > budget) continue;
        const ratio = c.v / Math.max(added, PLANNER_CONFIG.minAddedMin);
        if (!best || ratio > best.ratio) best = { idx, at: i + 1, ratio, addWalk };
      }
    });
    if (!best) break;
    const b = best as { idx: number; at: number; ratio: number; addWalk: number };
    const c = pool[b.idx];
    route = [...route.slice(0, b.at), c.p, ...route.slice(b.at)];
    chosen.add(c.p.id);
    stops++;
    route = improveOrder(route);
    walk = walkMinutes(pathLength(route));
  }

  if (stops === 0 && directMin <= budget) {
    notes.push(pool.length === 0
      ? 'No places in the dataset match these themes. Try adding another theme.'
      : 'No matching places fit in this time. Try more time or different themes.');
  }

  const estDistanceM = pathLength(route) * PLANNER_CONFIG.streetFactor;
  const walkMin = estDistanceM / PLANNER_CONFIG.walkSpeedMPerMin;
  return {
    start, end,
    stops: route.slice(1, -1),
    estDistanceM,
    walkMin,
    dwellMin: stops * dwell,
    totalMin: walkMin + stops * dwell,
    notes,
  };
}
