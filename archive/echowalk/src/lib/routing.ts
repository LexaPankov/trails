import type { Place, PlanRequest, PlannedRoute } from '../types';
import { planRoute, PLANNER_CONFIG, type Plan } from './planner';

// Public OSRM instance run by FOSSGIS with a real walking profile.
// (router.project-osrm.org only routes cars.) Override with VITE_OSRM_FOOT_URL.
const OSRM_BASE = (import.meta.env.VITE_OSRM_FOOT_URL as string | undefined) ?? 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
const TIMEOUT_MS = 6000;
const CACHE_KEY = 'echowalk.routes.v1';

interface OsrmResult { distance: number; geometry: [number, number][] }

function readCache(): Record<string, OsrmResult> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'); } catch { return {}; }
}
function writeCache(key: string, value: OsrmResult) {
  try {
    const c = readCache();
    c[key] = value;
    const keys = Object.keys(c);
    if (keys.length > 60) delete c[keys[0]];
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* storage unavailable: ignore */ }
}

async function fetchPedestrian(nodes: Place[]): Promise<OsrmResult | null> {
  const coords = nodes.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const cached = readCache()[coords];
  if (cached) return cached;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OSRM_BASE}/${coords}?overview=full&geometries=geojson`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const r = json?.routes?.[0];
    if (json?.code !== 'Ok' || !r?.geometry?.coordinates) return null;
    const out: OsrmResult = {
      distance: r.distance,
      geometry: (r.geometry.coordinates as [number, number][]).map(([lon, lat]) => [lat, lon]),
    };
    writeCache(coords, out);
    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toRoute(plan: Plan, req: PlanRequest, osrm: OsrmResult | null, extraNotes: string[]): PlannedRoute {
  const nodes = [plan.start, ...plan.stops, plan.end];
  const distanceM = osrm ? osrm.distance : plan.estDistanceM;
  const walkMin = distanceM / PLANNER_CONFIG.walkSpeedMPerMin;
  return {
    start: plan.start,
    end: plan.end,
    stops: plan.stops,
    distanceM,
    walkMin,
    dwellMin: plan.dwellMin,
    totalMin: walkMin + plan.dwellMin,
    budgetMin: req.minutes,
    geometry: osrm ? osrm.geometry : nodes.map((p) => [p.lat, p.lon]),
    routing: osrm ? 'pedestrian' : 'estimated',
    notes: [...plan.notes, ...extraNotes],
  };
}

/**
 * Plans stops from the static dataset, then tries to snap the route to real streets.
 * If the street route is longer than estimated and breaks the budget, it re-plans with a
 * tighter budget (max 2 retries). Without network, it falls back to the estimate.
 */
export async function buildRoute(places: Place[], req: PlanRequest, offline = false): Promise<PlannedRoute> {
  let factor = 1;
  let plan = planRoute(places, req, factor);
  if (offline) return toRoute(plan, req, null, []);

  for (let attempt = 0; attempt < 3; attempt++) {
    const osrm = await fetchPedestrian([plan.start, ...plan.stops, plan.end]);
    if (!osrm) return toRoute(plan, req, null, []);
    const total = osrm.distance / PLANNER_CONFIG.walkSpeedMPerMin + plan.dwellMin;
    if (total <= req.minutes * 1.03 || plan.stops.length === 0) return toRoute(plan, req, osrm, []);
    factor *= (req.minutes / total) * 0.97;
    plan = planRoute(places, req, factor);
  }
  const osrm = await fetchPedestrian([plan.start, ...plan.stops, plan.end]);
  return toRoute(plan, req, osrm, []);
}
