// "My walks" and "Share this walk": a walk is stored as its request plus the ordered stops, small enough
// for localStorage and for a link. Saved walks stay in this browser; a shared link carries only what is
// in it (start, destination, time, mode and the stop ids), nothing from the profile.
import type { Plan, PlanRequest } from './planner'
import type { Endpoint, RouteMode } from './types'

export interface WalkSpec {
  v: 1
  start: Endpoint
  end: Endpoint
  budgetMin: number
  mode: RouteMode
  stops: { id: string; kind: 'visit' | 'pass' }[]
  savedAt?: number
}

const KEY = 'trails.walks.v1'
const MAX_SAVED = 30
const MY_LOCATION = /^My location · /

function slimEndpoint(e: Endpoint, forShare: boolean): Endpoint {
  // a shared link should not say "My location": for the friend it is just a street
  const label = forShare ? e.label.replace(MY_LOCATION, '') : e.label
  return { lat: +e.lat.toFixed(5), lon: +e.lon.toFixed(5), label, ...(e.placeId ? { placeId: e.placeId } : {}) }
}

export function specFromPlan(plan: Plan, forShare = false): WalkSpec {
  const r = plan.request
  return {
    v: 1,
    start: slimEndpoint(r.start, forShare),
    end: slimEndpoint(r.end, forShare),
    budgetMin: r.budgetMin,
    mode: r.mode,
    stops: plan.stops.map((s) => ({ id: s.place.id, kind: s.kind })),
  }
}

export function requestFromSpec(s: WalkSpec, base?: Partial<PlanRequest>): PlanRequest {
  return { ...base, start: s.start, end: s.end, budgetMin: s.budgetMin, mode: s.mode }
}

/** same start, end, mode and stops = the same walk (used to show "Saved" and avoid duplicates) */
export function sameWalk(a: WalkSpec, b: WalkSpec): boolean {
  const k = (s: WalkSpec) => [s.start.lat, s.start.lon, s.end.lat, s.end.lon, s.mode, s.stops.map((x) => x.id).join(',')].join('|')
  return k(a) === k(b)
}

// ---------- links ----------

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function encodeWalk(s: WalkSpec): string {
  return toBase64Url(JSON.stringify({ ...s, savedAt: undefined }))
}

const MODES: RouteMode[] = ['fastest', 'discovery', 'history']
const isEndpoint = (e: unknown): e is Endpoint => {
  const x = e as Endpoint
  return !!x && Number.isFinite(x.lat) && Number.isFinite(x.lon) && typeof x.label === 'string'
}

/** parses a shared link; returns null for anything malformed instead of throwing */
export function decodeWalk(code: string): WalkSpec | null {
  try {
    const s = JSON.parse(fromBase64Url(code)) as WalkSpec
    if (s.v !== 1 || !isEndpoint(s.start) || !isEndpoint(s.end) || !MODES.includes(s.mode)) return null
    if (!Number.isFinite(s.budgetMin) || s.budgetMin <= 0 || s.budgetMin > 600) return null
    if (!Array.isArray(s.stops) || s.stops.length > 30) return null
    const stops = s.stops.filter((x) => typeof x?.id === 'string' && (x.kind === 'visit' || x.kind === 'pass'))
    return { v: 1, start: s.start, end: s.end, budgetMin: s.budgetMin, mode: s.mode, stops }
  } catch {
    return null
  }
}

export function shareUrl(s: WalkSpec): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#/walk/${encodeWalk(s)}`
}

// ---------- saved walks (this browser only) ----------

export function loadWalks(): WalkSpec[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as WalkSpec[]) : []
    return Array.isArray(list) ? list.filter((w) => w?.v === 1) : []
  } catch {
    return []
  }
}

export function storeWalks(list: WalkSpec[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED))) } catch { /* storage unavailable */ }
}
