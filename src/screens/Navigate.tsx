import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { MapView } from '../components/MapView'
import { QualityBadge } from '../components/common'
import { PLACE_BY_ID } from '../lib/data'
import { formatDistance, formatMinutes, haversine, pathLength, pointAlong, projectOnPath } from '../lib/geo'
import { buildCues, dueCue, type Cue } from '../lib/guide'
import type { LatLon } from '../lib/types'
import { go, useApp } from '../state'

const NEAR_ROUTE_M = 300

export function Navigate() {
  const { plan, profile, setProfile, signal, demo, setGpsLocation, location, story } = useApp()
  const [simDist, setSimDist] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speedup, setSpeedup] = useState(20)
  const [gpsErr, setGpsErr] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>([])
  // null = automatic: follow GPS only when the last fix is close to the route, otherwise simulate.
  // This keeps the demo walk usable after "Use my current location" from outside Rome.
  const [simOverride, setSimOverride] = useState<boolean | null>(null)
  const gpsAllowed = !demo && profile.locationConsent
  const timer = useRef<number | null>(null)
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [audioOn, setAudioOn] = useState(canSpeak)
  const [told, setTold] = useState<ReadonlySet<string>>(new Set())
  const [cue, setCue] = useState<Cue | null>(null)
  const [rated, setRated] = useState<Record<string, 'like' | 'dislike'>>({})

  const geom = useMemo(() => plan?.route.geometry ?? [], [plan])
  const total = useMemo(() => pathLength(geom), [geom])
  const legEnds = useMemo(() => {
    const lens = (plan?.route.legs ?? []).map((l) => pathLength(l.geometry))
    return lens.map((_, i) => lens.slice(0, i + 1).reduce((a, b) => a + b, 0))
  }, [plan])
  const mps = (profile.walkingSpeedKmh * 1000) / 3600

  const gpsFix = gpsAllowed && location?.source === 'gps' ? location : null
  const gpsNearRoute = !!gpsFix && geom.length > 0 && projectOnPath(gpsFix, geom).offset <= NEAR_ROUTE_M
  const useSim = !gpsAllowed || (simOverride ?? !gpsNearRoute)
  const pos: LatLon | null = !geom.length ? null : useSim ? pointAlong(geom, simDist) : gpsFix
  const proj = pos && geom.length ? projectOnPath(pos, geom) : null
  const along = proj?.along ?? 0

  // audio guide: each stop's part of the story (or its notes) and every place you pass, told as you get close
  const storyForPlan = plan && story?.planAt === plan.createdAt ? story.result.story : null
  const cues = useMemo(() => (plan ? buildCues(plan, PLACE_BY_ID, storyForPlan) : []), [plan, storyForPlan])
  const onRoute = !proj || useSim || proj.offset <= 60
  const due = onRoute ? dueCue(cues, along, told) : null
  useEffect(() => {
    if (!due) return
    setTold((t) => new Set([...t, due.id]))
    setCue(due)
    if (audioOn && canSpeak) {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(`${due.title}. ${due.text}`)
      u.lang = 'en-GB'; u.rate = 0.98
      window.speechSynthesis.speak(u)
    }
  }, [due, audioOn, canSpeak])
  useEffect(() => () => { if (canSpeak) window.speechSynthesis.cancel() }, [canSpeak])

  // simulated walk
  useEffect(() => {
    if (!playing) return
    timer.current = window.setInterval(() => setSimDist((d) => {
      const next = Math.min(total, d + mps * speedup * 0.5)
      if (next >= total) setPlaying(false)
      return next
    }), 500)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [playing, speedup, mps, total])

  // real GPS (only after explicit consent, never sent anywhere)
  useEffect(() => {
    if (!gpsAllowed || !navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(
      (pos) => { setGpsLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setGpsErr(null) },
      (e) => setGpsErr(e.code === 1 ? 'Location permission was denied.' : 'Location is unavailable right now.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [gpsAllowed, setGpsLocation])

  if (!plan) {
    return <div className="page"><div className="card card-pad"><h2>No route to follow</h2><a className="btn btn-primary" href="#/">Plan a walk</a></div></div>
  }

  const remaining = Math.max(0, total - along)
  const offRoute = !useSim && proj && proj.offset > 40
  const legIdx = Math.min(legEnds.findIndex((e) => along < e - 5), legEnds.length - 1)
  const leg = plan.route.legs[legIdx < 0 ? legEnds.length - 1 : legIdx]
  const nextStop = plan.stops[legIdx] ?? null // leg k ends at stop k (or the destination)
  const legStartAlong = legIdx > 0 ? legEnds[legIdx - 1] : 0
  const legLocal = along - legStartAlong
  // current maneuver: last maneuver whose start lies behind us
  let manIdx = 0
  if (leg) {
    leg.maneuvers.forEach((m, i) => {
      const startAlong = pathLength(leg.geometry.slice(0, m.begin + 1))
      if (startAlong <= legLocal + 8) manIdx = i
    })
  }
  const maneuver = leg?.maneuvers[manIdx]
  const nextManeuver = leg?.maneuvers[manIdx + 1]
  const target = nextStop?.place ?? plan.request.end
  const distToTarget = pos ? haversine(pos, target) : null
  const atStop = nextStop && distToTarget !== null && distToTarget < 30 && !visited.includes(nextStop.place.id)
  const remainingVisits = plan.stops.slice(Math.max(0, legIdx)).reduce((a, s) => a + s.visitMin, 0)

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - var(--header-h))' }}>
      <MapView route={{ geometry: geom, quality: plan.route.quality }}
        stops={plan.stops.map((s, i) => ({ place: s.place, n: i + 1 }))}
        start={plan.request.start} end={plan.request.end} me={pos} follow={pos}
        onPlace={(id) => go(`/place/${id}`)} fitKey={`nav-${plan.createdAt}`} />

      <div className="nav-card card card-pad fade-in" role="status" aria-live="polite">
        <div className="row spread wrap" style={{ marginBottom: 6 }}>
          <QualityBadge q={plan.route.quality} />
          {gpsAllowed ? (
            <button className="badge" style={{ background: useSim ? '#efe1e1' : '#e3ecd9', border: 0, cursor: 'pointer' }}
              onClick={() => { setPlaying(false); setSimOverride(!useSim) }} title="Switch between the simulated walk and your GPS">
              <Icon name="locate" size={14} /> {useSim ? 'Simulated · use GPS' : 'GPS · simulate instead'}
            </button>
          ) : (
            <span className="badge" style={{ background: '#efe1e1' }}><Icon name="locate" size={14} /> Simulated location</span>
          )}
          {canSpeak && (
            <button className="btn btn-ghost btn-sm" aria-pressed={audioOn} onClick={() => { if (audioOn) window.speechSynthesis.cancel(); setAudioOn(!audioOn) }}>
              <Icon name="sound" size={14} /> {audioOn ? 'Audio guide on' : 'Audio guide off'}
            </button>
          )}
        </div>
        {remaining < 15 ? (
          <div className="nav-instr">You have arrived at {plan.request.end.label}.</div>
        ) : (
          <>
            <div className="nav-instr">{maneuver?.instruction ?? 'Follow the highlighted route'}</div>
            {nextManeuver && <p className="small muted" style={{ margin: '4px 0 0' }}>Then: {nextManeuver.instruction}</p>}
          </>
        )}
        {plan.route.quality === 'estimate' && <p className="tiny muted" style={{ margin: '6px 0 0' }}>No street-level directions: the line is approximate.</p>}
        {offRoute && <p className="notice small" style={{ marginTop: 8 }}>You seem to be off the route ({Math.round(proj!.offset)} m away). Head back to the highlighted line or re-plan from the Plan page.</p>}
        {gpsErr && !useSim && <p className="notice notice-danger small" style={{ marginTop: 8 }}>{gpsErr} Switch on demo mode to simulate the walk.</p>}
      </div>

      <div className="nav-bottom card card-pad">
        {cue && (
          <div className="guide-card fade-in" aria-live="polite">
            <p className="eyebrow" style={{ margin: 0 }}>{storyForPlan && cue.kind === 'stop' ? 'Your story' : 'Audio guide'}</p>
            <h4>{cue.title}</h4>
            <p className="small">{cue.text}</p>
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn btn-ghost btn-sm" aria-pressed={rated[cue.placeId] === 'like'} disabled={!!rated[cue.placeId]}
                onClick={() => { signal(cue.placeId, 'like'); setRated({ ...rated, [cue.placeId]: 'like' }) }}><Icon name="up" size={14} /> More like this</button>
              <button className="btn btn-ghost btn-sm" aria-pressed={rated[cue.placeId] === 'dislike'} disabled={!!rated[cue.placeId]}
                onClick={() => { signal(cue.placeId, 'dislike'); setRated({ ...rated, [cue.placeId]: 'dislike' }) }}><Icon name="down" size={14} /> Not for me</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { if (canSpeak) window.speechSynthesis.cancel(); setCue(null) }}><Icon name="x" size={14} /> Close</button>
            </div>
            {rated[cue.placeId] && <p className="tiny muted" style={{ margin: '6px 0 0' }}>Saved to your taste profile. Your next plan will use it.</p>}
          </div>
        )}
        {atStop && nextStop ? (
          <div className="fade-in">
            <p className="eyebrow">You have reached stop {legIdx + 1}</p>
            <h3>{nextStop.place.name}</h3>
            <p className="small">{nextStop.place.summary}</p>
            <div className="row wrap">
              <button className="btn btn-primary btn-sm" onClick={() => { signal(nextStop.place.id, 'visited'); setVisited([...visited, nextStop.place.id]) }}>
                <Icon name="check" size={15} /> Mark visited
              </button>
              <a className="btn btn-ghost btn-sm" href={`#/place/${nextStop.place.id}`} onClick={() => signal(nextStop.place.id, 'open_details')}>Learn more</a>
            </div>
          </div>
        ) : (
          <>
            <div className="row spread">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>{nextStop ? `Next stop ${legIdx + 1} of ${plan.stops.length}` : 'Destination'}</p>
                <strong style={{ fontFamily: 'var(--serif)', fontSize: '1.15rem' }}>{nextStop ? nextStop.place.name : plan.request.end.label}</strong>
                {distToTarget !== null && <span className="small muted"> · {formatDistance(distToTarget)} away</span>}
              </div>
              {nextStop && (
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  signal(nextStop.place.id, 'skip')
                  const end = legEnds[legIdx] ?? total
                  if (useSim) setSimDist(end + 1)
                }}><Icon name="skip" size={14} /> Skip</button>
              )}
            </div>
            <div className="row wrap small muted" style={{ gap: 14, marginTop: 6 }}>
              <span>{formatDistance(remaining)} left</span>
              <span>~{formatMinutes(remaining / mps / 60)} walking</span>
              {remainingVisits > 0 && <span>+ {formatMinutes(remainingVisits)} at stops</span>}
            </div>
          </>
        )}
        {useSim && (
          <div style={{ marginTop: 12 }}>
            <div className="row">
              <button className="btn btn-dark btn-icon" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause simulated walk' : 'Play simulated walk'}>
                <Icon name={playing ? 'pause' : 'play'} size={16} />
              </button>
              <input type="range" min={0} max={Math.round(total)} value={Math.round(simDist)} aria-label="Simulated position along the route"
                onChange={(e) => setSimDist(+e.target.value)} />
              <select value={speedup} onChange={(e) => setSpeedup(+e.target.value)} aria-label="Simulation speed" style={{ width: 84 }}>
                {[5, 20, 60].map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
            </div>
            <p className="tiny muted" style={{ margin: '6px 0 0' }}>
              Simulated walk along the planned route (demo).
              {gpsAllowed && simOverride === null && gpsFix && !gpsNearRoute && ' Your GPS position is far from this route, so the walk is simulated.'}
              {!demo && !profile.locationConsent && (
                <> <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }} onClick={() => setProfile({ ...profile, locationConsent: true })}>Use my real location</button> (stays on this device)</>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
