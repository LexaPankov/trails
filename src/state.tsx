import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PLACE_BY_ID } from './lib/data'
import { loadScorer, type Scorer } from './lib/model/mlp'
import type { Plan, PlanRequest } from './lib/planner'
import { loadProfile, recordSignal, resetProfile, saveProfile, type Profile, type Signal } from './lib/profile'
import type { ProviderChoice } from './lib/routing'
import type { StoryResult } from './lib/story/client'
import type { LatLon } from './lib/types'

export interface DemoScenario { id: string; label: string; lat: number; lon: number; heading: number }

export const DEMO_SCENARIOS: DemoScenario[] = [
  { id: 'navona', label: 'Standing in Piazza Navona', lat: 41.8990, lon: 12.4731, heading: 270 },
  { id: 'forum', label: 'Overlooking the Roman Forum', lat: 41.8931, lon: 12.4843, heading: 120 },
  { id: 'tiber', label: "On Ponte Sant'Angelo", lat: 41.9015, lon: 12.4667, heading: 330 },
  { id: 'trevi', label: 'At the Trevi Fountain', lat: 41.9008, lon: 12.4832, heading: 0 },
  { id: 'aventine', label: 'Forum Boarium, by the river', lat: 41.8889, lon: 12.4810, heading: 200 },
]

export interface Settings { routing: ProviderChoice; offline: boolean }

interface Ctx {
  profile: Profile
  setProfile: (p: Profile) => void
  signal: (placeId: string, s: Signal) => void
  reset: () => void
  scorer: Scorer | null
  plan: Plan | null
  setPlan: (p: Plan | null) => void
  /** the story written for a plan (keyed by plan.createdAt), shared by the results and walk screens */
  story: { planAt: number; result: StoryResult } | null
  setStory: (s: { planAt: number; result: StoryResult } | null) => void
  draft: PlanRequest | null
  setDraft: (r: PlanRequest) => void
  demo: boolean
  setDemo: (b: boolean) => void
  scenario: DemoScenario
  setScenario: (s: DemoScenario) => void
  settings: Settings
  setSettings: (s: Settings) => void
  /** simulated location in demo mode, otherwise last real GPS fix (only if the user consented) */
  location: (LatLon & { source: 'simulated' | 'gps'; heading?: number }) | null
  setGpsLocation: (l: LatLon | null) => void
}

const AppCtx = createContext<Ctx | null>(null)

function readJSON<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
function writeJSON(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* storage unavailable */ }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<Profile>(() => loadProfile())
  const [scorer, setScorer] = useState<Scorer | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [draft, setDraft] = useState<PlanRequest | null>(null)
  const [story, setStory] = useState<{ planAt: number; result: StoryResult } | null>(null)
  const [demo, setDemoState] = useState<boolean>(() => readJSON('trails.demo', false))
  const [scenario, setScenarioState] = useState<DemoScenario>(() => {
    const id = readJSON('trails.scenario', 'navona')
    return DEMO_SCENARIOS.find((s) => s.id === id) ?? DEMO_SCENARIOS[0]
  })
  const [settings, setSettingsState] = useState<Settings>(() => readJSON('trails.settings', { routing: 'auto', offline: false }))
  const [gps, setGps] = useState<LatLon | null>(null)

  useEffect(() => { loadScorer().then(setScorer) }, [])

  const setProfile = useCallback((p: Profile) => { setProfileState(p); saveProfile(p) }, [])
  const signal = useCallback((placeId: string, s: Signal) => {
    const place = PLACE_BY_ID[placeId]
    if (!place) return
    setProfileState((prev) => { const n = recordSignal(prev, place, s); saveProfile(n); return n })
  }, [])
  const reset = useCallback(() => { setProfileState(resetProfile()); setPlan(null) }, [])
  const setDemo = useCallback((b: boolean) => { setDemoState(b); writeJSON('trails.demo', b) }, [])
  const setScenario = useCallback((s: DemoScenario) => { setScenarioState(s); writeJSON('trails.scenario', s.id) }, [])
  const setSettings = useCallback((s: Settings) => { setSettingsState(s); writeJSON('trails.settings', s) }, [])

  const location = useMemo(() => {
    if (demo) return { lat: scenario.lat, lon: scenario.lon, heading: scenario.heading, source: 'simulated' as const }
    if (gps && profile.locationConsent) return { ...gps, source: 'gps' as const }
    return null
  }, [demo, scenario, gps, profile.locationConsent])

  const value: Ctx = {
    profile, setProfile, signal, reset, scorer, plan, setPlan, story, setStory, draft, setDraft,
    demo, setDemo, scenario, setScenario, settings, setSettings, location, setGpsLocation: setGps,
  }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp(): Ctx {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

/** Minimal hash router: #/path/param */
export function useHashRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => { setHash(window.location.hash); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
}

export function go(path: string) { window.location.hash = path }
