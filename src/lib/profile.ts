// Local preference profile. Stored only in this browser (localStorage); never sent anywhere.
// Affinity update rule mirrors ml/affinity.py so the model sees the same signal it was trained on.
import type { Interest, Place, RouteMode } from './types'
import { INTERESTS, placeAxes, zeroAffinity, type Affinity } from './model/features'

export type Signal = 'like' | 'save' | 'visited' | 'open_details' | 'skip' | 'dislike'

export const SIGNAL_WEIGHTS: Record<Signal, number> = {
  like: 0.35,
  save: 0.25,
  visited: 0.2,
  open_details: 0.08,
  skip: -0.04, // deliberately weak: skipping often means "no time", not "dislike"
  dislike: -0.35,
}

export const SIGNAL_LABEL: Record<Signal, string> = {
  like: 'Liked', save: 'Saved', visited: 'Visited', open_details: 'Read more', skip: 'Skipped', dislike: 'Not for me',
}

export interface ProfileEvent { placeId: string; signal: Signal; at: number }

export interface Profile {
  version: 1
  onboarded: boolean
  interests: Interest[]
  affinity: Affinity
  saved: string[]
  dismissed: string[]
  events: ProfileEvent[] // place ids + signal only; no coordinates or location history
  walkingSpeedKmh: number
  defaultMode: RouteMode
  locationConsent: boolean
}

const KEY = 'trails.profile.v1'

export function defaultProfile(): Profile {
  return {
    version: 1,
    onboarded: false,
    interests: ['ancient', 'archaeology', 'hidden_gems'],
    affinity: zeroAffinity(),
    saved: [],
    dismissed: [],
    events: [],
    walkingSpeedKmh: 4.5,
    defaultMode: 'discovery',
    locationConsent: false,
  }
}

export function applySignal(aff: Affinity, axes: number[], signal: Signal): Affinity {
  const w = SIGNAL_WEIGHTS[signal]
  const norm = Math.sqrt(Math.max(1, axes.reduce((a, b) => a + b, 0)))
  const out = { ...aff }
  INTERESTS.forEach((k, i) => {
    out[k] = Math.max(-1, Math.min(1, (out[k] ?? 0) + (w * axes[i]) / norm))
  })
  return out
}

export function recordSignal(p: Profile, place: Place, signal: Signal): Profile {
  const next: Profile = {
    ...p,
    affinity: applySignal(p.affinity, placeAxes(place), signal),
    events: [...p.events, { placeId: place.id, signal, at: Date.now() }].slice(-200),
  }
  if (signal === 'save' && !next.saved.includes(place.id)) next.saved = [...next.saved, place.id]
  if (signal === 'dislike' && !next.dismissed.includes(place.id)) next.dismissed = [...next.dismissed, place.id]
  if (signal === 'like') next.dismissed = next.dismissed.filter((x) => x !== place.id)
  return next
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultProfile()
    const p = JSON.parse(raw) as Profile
    if (p.version !== 1) return defaultProfile()
    return { ...defaultProfile(), ...p, affinity: { ...zeroAffinity(), ...p.affinity } }
  } catch {
    return defaultProfile()
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable (private mode): profile lives for this session only */
  }
}

export function resetProfile(): Profile {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  return defaultProfile()
}
