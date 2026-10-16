import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { ImageCredit, InterestPicker, ModeSelector } from '../components/common'
import { LocationField } from '../components/LocationField'
import { PLACE_BY_ID, placeImage } from '../lib/data'
import { formatMinutes, haversine } from '../lib/geo'
import { planRoute, type PlanRequest } from '../lib/planner'
import type { Endpoint, Interest, RouteMode } from '../lib/types'
import { go, useApp } from '../state'

const BASE = import.meta.env.BASE_URL

interface Preset { title: string; from: string | Endpoint; to: string | Endpoint; minutes: number; mode: RouteMode; interests: Interest[]; note: string }
const PRESETS: Preset[] = [
  { title: 'Ancient stones', from: 'pantheon', to: 'colosseum', minutes: 45, mode: 'discovery', interests: ['ancient', 'archaeology', 'hidden_gems'], note: 'Pantheon to Colosseum, 45 min' },
  { title: 'Renaissance & Baroque', from: 'pantheon', to: 'colosseum', minutes: 45, mode: 'discovery', interests: ['renaissance', 'baroque', 'art_architecture'], note: 'Same walk, different eyes' },
  { title: 'Station to Trastevere', from: { lat: 41.9009, lon: 12.5016, label: 'Roma Termini station' }, to: { lat: 41.8917, lon: 12.4703, label: 'Piazza Trilussa, Trastevere' }, minutes: 75, mode: 'discovery', interests: ['ancient', 'baroque', 'hidden_gems'], note: 'Ordinary A to B: from the train to dinner' },
  { title: 'Hidden Rome', from: 'campo-de-fiori', to: 'spanish-steps', minutes: 75, mode: 'history', interests: ['hidden_gems', 'baroque', 'art_architecture'], note: "Campo de' Fiori to the Spanish Steps" },
]

function endpointFor(id: string | Endpoint): Endpoint {
  if (typeof id !== 'string') return id
  const p = PLACE_BY_ID[id]
  return { lat: p.lat, lon: p.lon, label: p.name, placeId: p.id }
}

export function Home() {
  const { profile, setProfile, scorer, setPlan, settings, location, demo, setDraft, draft } = useApp()
  const [start, setStart] = useState<Endpoint | null>(draft?.start ?? endpointFor('pantheon'))
  const [end, setEnd] = useState<Endpoint | null>(draft?.end ?? endpointFor('colosseum'))
  const [minutes, setMinutes] = useState(draft?.budgetMin ?? 45)
  const [mode, setMode] = useState<RouteMode>(draft?.mode ?? profile.defaultMode)
  const [interests, setInterests] = useState<Interest[]>(profile.interests)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const hero = placeImage('trevi-fountain')

  const here = location ? { lat: location.lat, lon: location.lon, label: location.source === 'simulated' ? 'Simulated location (demo)' : 'My current location' } : null
  const directMin = useMemo(() => (start && end ? (haversine(start, end) * 1.35) / ((profile.walkingSpeedKmh * 1000) / 60) : 0), [start, end, profile.walkingSpeedKmh])

  async function submit(override?: Partial<{ start: Endpoint; end: Endpoint; minutes: number; mode: RouteMode; interests: Interest[] }>) {
    const s = override?.start ?? start, t = override?.end ?? end
    if (!s) { setErr('Choose where you start: type an address, use your location, or pick on the map.'); return }
    if (!t) { setErr('Choose where you are going.'); return }
    if (haversine(s, t) < 30) { setErr('Choose a destination different from the start.'); return }
    if (!scorer) { setErr('Preference model is still loading. Try again in a moment.'); return }
    const ints = override?.interests ?? interests
    const prof = { ...profile, interests: ints, onboarded: true, defaultMode: override?.mode ?? mode }
    setProfile(prof)
    const req: PlanRequest = { start: s, end: t, budgetMin: override?.minutes ?? minutes, mode: override?.mode ?? mode, routing: settings.routing, offline: settings.offline }
    setBusy(true); setErr(null); setDraft(req)
    try {
      const plan = await planRoute(req, prof, scorer)
      setPlan(plan)
      go('/route')
    } catch (e) {
      setErr(`Could not plan this route: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  function applyPreset(p: Preset) {
    const s = endpointFor(p.from), t = endpointFor(p.to)
    setStart(s); setEnd(t); setMinutes(p.minutes); setMode(p.mode); setInterests(p.interests)
    void submit({ start: s, end: t, minutes: p.minutes, mode: p.mode, interests: p.interests })
  }

  return (
    <div className="page fade-in">
      <form className="card card-pad" style={{ marginTop: 0 }} onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <h1 className="plan-title">Where are you walking? <em>Every route has a story.</em></h1>
        <div className="grid2">
          <LocationField id="from" label="From" value={start} onChange={setStart} here={here} placeholder="Any address, hotel, station or place in Rome" />
          <LocationField id="to" label="To" value={end} onChange={setEnd} here={here} placeholder="Where are you going?" />
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>Any two points in central Rome. TRAILS finds the walk that passes the most of what you love within your time.</p>

        <div style={{ marginTop: 18 }}>
          <div className="row spread">
            <label className="field" htmlFor="minutes">Time available</label>
            <strong style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>{formatMinutes(minutes)}</strong>
          </div>
          <input id="minutes" type="range" min={15} max={180} step={5} value={minutes} onChange={(e) => setMinutes(+e.target.value)} />
          {start && (
            <p className={`small ${directMin > minutes ? '' : 'muted'}`} style={{ marginTop: 4 }}>
              The direct walk is roughly {formatMinutes(directMin)} (straight-line estimate; the router refines it).
              {directMin > minutes && ' That is more than your time budget, so TRAILS will show the direct route only.'}
            </p>
          )}
        </div>

        <div style={{ marginTop: 18 }}>
          <label className="field">What do you love?</label>
          <InterestPicker value={interests} onChange={setInterests} />
        </div>
        <div style={{ marginTop: 18 }}>
          <label className="field">Route mode</label>
          <ModeSelector value={mode} onChange={setMode} />
        </div>

        {err && <p className="notice notice-danger" role="alert" style={{ marginTop: 16 }}>{err}</p>}
        <div className="row wrap" style={{ marginTop: 20 }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="route" />} Plan my trail
          </button>
          {!scorer && <span className="small muted">Loading preference model…</span>}
          {demo && <span className="small muted">Demo mode is on: location is simulated.</span>}
        </div>
      </form>
      <section className="hero" style={{ marginTop: 28 }}>
        <div className="hero-copy">
          <p className="eyebrow">Rome · walking edition</p>
          <h2>Navigation that knows <em>what you love.</em></h2>
          <p className="lede">
            TRAILS is navigation that learns what you love and reveals the history around you. Tell it where you are going
            and how long you have; a small neural network picks the stops that suit you, and a pedestrian router walks you there.
          </p>
          <div className="row wrap small muted" style={{ gap: 16 }}>
            <span className="row" style={{ gap: 6 }}><Icon name="sparkle" size={16} /> Personalised by a trained model</span>
            <span className="row" style={{ gap: 6 }}><Icon name="map" size={16} /> OpenStreetMap, no Google Maps</span>
            <span className="row" style={{ gap: 6 }}><Icon name="camera" size={16} /> Camera landmark recognition</span>
          </div>
        </div>
        {hero && (
          <figure className="hero-visual" style={{ margin: 0 }}>
            <img src={BASE + hero.file} alt="The Trevi Fountain in Rome" />
            <figcaption><ImageCredit file={hero.file} /></figcaption>
          </figure>
        )}
      </section>


      <section style={{ marginTop: 28 }}>
        <p className="eyebrow">Try an example</p>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.title} className="preset" onClick={() => applyPreset(p)} disabled={busy}>
              <strong>{p.title}</strong>
              <span className="small muted">{p.note} · {p.mode === 'history' ? 'Maximum history' : 'Cultural discovery'}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
