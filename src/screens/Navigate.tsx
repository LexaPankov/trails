import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Icon } from '../components/Icon'
import { MapView } from '../components/MapView'
import { PLACE_BY_ID } from '../lib/data'
import { QUALITY_LABEL } from '../lib/routing'
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
  // bottom sheet, like a maps app: drag it down to see the map, drag it up (or tap) for details
  const [sheetOpen, setSheetOpen] = useState(true)
  const [showInfo, setShowInfo] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const [collapseBy, setCollapseBy] = useState(0)
  const dragStart = useRef<{ y: number; t: number } | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const peekRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const sheet = sheetRef.current, peek = peekRef.current
    if (!sheet || !peek) return
    const measure = () => setCollapseBy(Math.max(0, sheet.offsetHeight - (peek.offsetTop + peek.offsetHeight + 12)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(sheet)
    return () => ro.disconnect()
  }, [plan])

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

  const open = sheetOpen || !!atStop
  // collapsed: slide the sheet down until only the handle and the one-line summary stay visible
  const base = open ? 0 : collapseBy
  const shift = drag === null ? base : Math.min(collapseBy, Math.max(0, base + drag))
  const onDragStart = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button:not(.nav-handle), select, input, a')) return
    dragStart.current = { y: e.clientY, t: performance.now() }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(0)
  }
  const onDragMove = (e: PointerEvent) => { if (dragStart.current) setDrag(e.clientY - dragStart.current.y) }
  const onDragEnd = (e: PointerEvent) => {
    const s = dragStart.current
    dragStart.current = null
    setDrag(null)
    if (!s) return
    const dy = e.clientY - s.y
    const v = dy / Math.max(1, performance.now() - s.t) // px per ms; a flick counts even if short
    if (Math.abs(dy) < 6) setSheetOpen(!open) // a tap toggles
    else if (dy > collapseBy / 3 || v > 0.4) setSheetOpen(false)
    else if (dy < -collapseBy / 3 || v < -0.4) setSheetOpen(true)
  }
  const playButton = useSim && (
    <button className="btn btn-dark btn-icon" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause simulated walk' : 'Play simulated walk'}>
      <Icon name={playing ? 'pause' : 'play'} size={16} />
    </button>
  )

  return (
    <div className="nav-screen">
      <MapView route={{ geometry: geom, quality: plan.route.quality }}
        stops={plan.stops.map((s, i) => ({ place: s.place, n: i + 1 }))}
        start={plan.request.start} end={plan.request.end} me={pos} follow={pos}
        onPlace={(id) => go(`/place/${id}`)} fitKey={`nav-${plan.createdAt}`} />

      <div className="nav-card card" role="status" aria-live="polite">
        <div className="nav-top">
          <button className="nav-tool" aria-label="Back to the route" title="Back to the route" onClick={() => go('/route')}>
            <Icon name="back" size={18} />
          </button>
          <div className="nav-instr">
            {remaining < 15 ? `You have arrived at ${plan.request.end.label}.` : maneuver?.instruction ?? 'Follow the highlighted route'}
            {remaining >= 15 && nextManeuver && <div className="small muted nav-then">Then: {nextManeuver.instruction}</div>}
          </div>
          <div className="nav-tools">
            {canSpeak && (
              <button className="nav-tool" aria-pressed={audioOn} aria-label={audioOn ? 'Audio guide on: turn off' : 'Audio guide off: turn on'}
                title={audioOn ? 'Audio guide on' : 'Audio guide off'}
                onClick={() => { if (audioOn) window.speechSynthesis.cancel(); setAudioOn(!audioOn) }}>
                <Icon name="sound" size={18} />
              </button>
            )}
            <button className="nav-tool" aria-pressed={!useSim} disabled={demo}
              aria-label={useSim ? 'Simulated location: switch to GPS' : 'GPS location: switch to simulated walk'}
              title={demo ? 'Demo mode is on: location is simulated' : useSim ? 'Simulated location (tap for GPS)' : 'GPS location (tap to simulate)'}
              onClick={() => {
                setPlaying(false)
                if (!gpsAllowed) { setProfile({ ...profile, locationConsent: true }); setSimOverride(false) }
                else setSimOverride(!useSim)
              }}>
              <Icon name="locate" size={18} />
            </button>
            <button className="nav-tool" aria-pressed={showInfo} aria-label="About this route" title="About this route" onClick={() => setShowInfo(!showInfo)}>
              <Icon name="info" size={18} />
            </button>
          </div>
        </div>
        {showInfo && (
          <div className="nav-info small fade-in">
            <p><b>Route:</b> {QUALITY_LABEL[plan.route.quality]}.{plan.route.quality === 'estimate' && ' No street-level directions: the line is approximate.'}</p>
            <p><b>Location:</b> {useSim
              ? <>simulated walk along the route (press play below).{gpsAllowed && simOverride === null && gpsFix && !gpsNearRoute && ' Your GPS position is far from this route.'}{demo && ' Demo mode is on.'}</>
              : 'your phone’s GPS, used only on this device.'}{' '}
              {!demo && 'Tap the target button to switch.'}</p>
            <p><b>Sound:</b> the audio guide reads each stop and the places you pass, {audioOn ? 'now on' : 'now off'}.</p>
          </div>
        )}
        {offRoute && <p className="notice small nav-note">You seem to be off the route ({Math.round(proj!.offset)} m away). Head back to the highlighted line or re-plan from the Plan page.</p>}
        {gpsErr && !useSim && <p className="notice notice-danger small nav-note">{gpsErr} Tap the target button to simulate the walk.</p>}
      </div>

      <div ref={sheetRef} className={`nav-bottom card${drag === null ? '' : ' dragging'}`} style={{ transform: `translateY(${shift}px)` }}>
        <div className="nav-grab" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
          <button className="nav-handle" aria-label={open ? 'Hide details' : 'Show details'} aria-expanded={open}
            onClick={(e) => { if (e.detail === 0) setSheetOpen(!open) /* keyboard; pointer taps are handled by the drag */ }}>
            <span />
          </button>
          <div ref={peekRef} className="nav-peek">
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="eyebrow nav-oneline" style={{ margin: 0 }}>{atStop ? `You have reached stop ${legIdx + 1}` : nextStop ? `Next stop ${legIdx + 1} of ${plan.stops.length}` : 'Destination'}</p>
              <div className="nav-oneline"><strong className="nav-stopname">{nextStop ? nextStop.place.name : plan.request.end.label}</strong>
                {distToTarget !== null && <span className="small muted"> · {formatDistance(distToTarget)}</span>}</div>
              <div className="tiny muted nav-oneline">
                {!open && cue ? `${storyForPlan && cue.kind === 'stop' ? 'Your story' : 'Audio guide'}: ${cue.title}`
                  : `${formatDistance(remaining)} left · ~${formatMinutes(remaining / mps / 60)} walking${remainingVisits > 0 ? ` + ${formatMinutes(remainingVisits)} at stops` : ''}`}
              </div>
            </div>
            {nextStop && !atStop && (
              <button className="btn btn-ghost btn-icon" aria-label="Skip this stop" title="Skip this stop" onClick={() => {
                signal(nextStop.place.id, 'skip')
                const end = legEnds[legIdx] ?? total
                if (useSim) setSimDist(end + 1)
              }}><Icon name="skip" size={16} /></button>
            )}
            {playButton}
          </div>
        </div>
        <div className={`nav-sheet-body${!open && drag === null ? ' nav-hidden' : ''}`} aria-hidden={!open && drag === null}>
          {atStop && nextStop && (
            <div className="fade-in nav-section">
              <p className="small">{nextStop.place.summary}</p>
              <div className="row wrap">
                <button className="btn btn-primary btn-sm" onClick={() => { signal(nextStop.place.id, 'visited'); setVisited([...visited, nextStop.place.id]) }}>
                  <Icon name="check" size={15} /> Mark visited
                </button>
                <a className="btn btn-ghost btn-sm" href={`#/place/${nextStop.place.id}`} onClick={() => signal(nextStop.place.id, 'open_details')}>Learn more</a>
              </div>
            </div>
          )}
          {cue && (
            <div className="guide-card fade-in nav-section" aria-live="polite">
              <p className="eyebrow" style={{ margin: 0 }}>{storyForPlan && cue.kind === 'stop' ? 'Your story' : 'Audio guide'}</p>
              <h4>{cue.title}</h4>
              <p className="small">{cue.text}</p>
              <div className="row wrap" style={{ gap: 6 }}>
                <button className="btn btn-ghost btn-sm" aria-pressed={rated[cue.placeId] === 'like'} disabled={!!rated[cue.placeId]}
                  onClick={() => { signal(cue.placeId, 'like'); setRated({ ...rated, [cue.placeId]: 'like' }) }}><Icon name="up" size={14} /> More like this</button>
                <button className="btn btn-ghost btn-sm" aria-pressed={rated[cue.placeId] === 'dislike'} disabled={!!rated[cue.placeId]}
                  onClick={() => { signal(cue.placeId, 'dislike'); setRated({ ...rated, [cue.placeId]: 'dislike' }) }}><Icon name="down" size={14} /> Not for me</button>
                <button className="btn btn-ghost btn-sm btn-icon" aria-label="Close" onClick={() => { if (canSpeak) window.speechSynthesis.cancel(); setCue(null) }}><Icon name="x" size={14} /></button>
              </div>
              {rated[cue.placeId] && <p className="tiny muted" style={{ margin: '6px 0 0' }}>Saved to your taste profile. Your next plan will use it.</p>}
            </div>
          )}
          {useSim && (
            <div className="row nav-section">
              <input type="range" min={0} max={Math.round(total)} value={Math.round(simDist)} aria-label="Simulated position along the route"
                onChange={(e) => setSimDist(+e.target.value)} />
              <select value={speedup} onChange={(e) => setSpeedup(+e.target.value)} aria-label="Simulation speed" style={{ width: 84 }}>
                {[5, 10, 20].map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
