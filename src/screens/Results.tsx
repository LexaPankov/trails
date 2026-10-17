import { useState } from 'react'
import { Icon } from '../components/Icon'
import { MapView } from '../components/MapView'
import { Meter, PlaceTags, PlaceThumb, QualityBadge } from '../components/common'
import { StoryCard } from '../components/StoryCard'
import { WalkButtons } from '../components/WalkActions'
import { PLACE_BY_ID, PLACES } from '../lib/data'
import { formatDistance, formatMinutes } from '../lib/geo'
import { MODE_LABEL } from '../lib/optimizer'
import { planRoute } from '../lib/planner'
import type { Signal } from '../lib/profile'
import { describeShift, tasteShift } from '../lib/taste'
import { STRONG_MATCH, tradeoff } from '../lib/tradeoff'
import { go, useApp } from '../state'

export function Results() {
  const { plan, setPlan, profile, scorer, signal, setDraft } = useApp()
  const [busy, setBusy] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const [showFastest, setShowFastest] = useState(true)
  const [taste, setTaste] = useState<{ name: string; text: string; signal: Signal } | null>(null)

  if (!plan) {
    return (
      <div className="page">
        <div className="card card-pad">
          <h2>No route yet</h2>
          <p className="muted">Plan a walk first; your trail will appear here.</p>
          <a className="btn btn-primary" href="#/">Plan a walk</a>
        </div>
      </div>
    )
  }
  const p = plan
  const budget = p.request.budgetMin
  const stopIds = new Set(p.stops.map((s) => s.place.id))
  const passing = (p.passing ?? []).map((id) => PLACE_BY_ID[id]).filter(Boolean)
  const passIds = new Set(passing.map((x) => x.id))
  const others = PLACES.filter((x) => !stopIds.has(x.id) && !passIds.has(x.id) && x.id !== p.request.start.placeId && x.id !== p.request.end.placeId)
  const nVisit = p.stops.filter((s) => s.kind !== 'pass').length, nPass = p.stops.length - nVisit
  const walkPct = Math.min(100, (p.walkMin / Math.max(budget, p.totalMin)) * 100)
  const visitPct = Math.min(100 - walkPct, (p.visitMin / Math.max(budget, p.totalMin)) * 100)

  const t = tradeoff(p)
  function rate(placeId: string, sig: 'like' | 'dislike') {
    const place = PLACE_BY_ID[placeId]
    if (!place) return
    setTaste({ name: place.name, signal: sig, text: describeShift(tasteShift(profile.affinity, place, sig)) })
    signal(placeId, sig)
    if (sig === 'dislike') void replan(placeId)
  }

  async function replan(exclude?: string) {
    if (!scorer) return
    setBusy(true)
    try {
      const req = { ...p.request, exclude: [...(p.request.exclude ?? []), ...(exclude ? [exclude] : [])] }
      setDraft(req)
      setPlan(await planRoute(req, profile, scorer))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="split">
      <div className="map-wrap">
        <MapView
          route={{ geometry: p.route.geometry, quality: p.route.quality }}
          alt={p.stops.length && showFastest ? p.direct.geometry : null}
          stops={p.stops.map((s, i) => ({ place: s.place, n: i + 1 }))}
          start={p.request.start} end={p.request.end} others={others} passing={passing}
          onPlace={(id) => go(`/place/${id}`)} fitKey={String(p.createdAt)}
        />
      </div>
      <aside className="panel" aria-label="Route details">
        <div className="row spread wrap">
          <p className="eyebrow" style={{ margin: 0 }}>{MODE_LABEL[p.request.mode]}</p>
          <a href="#/" className="btn btn-ghost btn-sm"><Icon name="back" size={15} /> Edit</a>
        </div>
        <h2 style={{ marginTop: 8 }}>{p.request.start.label} <span className="muted" style={{ fontWeight: 400 }}>to</span> {p.request.end.label}</h2>
        <WalkButtons plan={p} />

        {p.reachable && (
          <div className="tradeoff card" aria-label="TRAILS route compared with the fastest walk">
            <div className="tradeoff-col">
              <span className="tiny muted">Fastest walk</span>
              <b>{formatMinutes(t.fastestMin)}</b>
              <span className="small">{t.fastestPlaces.length ? `walks past ${t.fastestPlaces.length} place${t.fastestPlaces.length === 1 ? '' : 's'}, no time to stop` : 'no cultural places on the way'}</span>
            </div>
            <div className="tradeoff-col tradeoff-trails">
              <span className="tiny">Your TRAILS walk</span>
              <b>+{formatMinutes(t.extraMin)}</b>
              <span className="small">{p.stops.length} stop{p.stops.length === 1 ? '' : 's'} chosen for you{t.stopsStrong ? ` (${t.stopsStrong} strong match${t.stopsStrong === 1 ? '' : 'es'})` : ''}, {formatMinutes(p.visitMin)} to explore{p.passing.length ? `, ${p.passing.length} more on the way` : ''}</span>
            </div>
            {p.stops.length > 0 && (
              <label className="tiny muted tradeoff-toggle">
                <input type="checkbox" checked={showFastest} onChange={(e) => setShowFastest(e.target.checked)} /> Show the fastest walk on the map (dotted grey)
              </label>
            )}
            <span className="tiny muted tradeoff-note" title={`Strong match: the preference network scores the place at ${Math.round(STRONG_MATCH * 100)}% or more for you`}>
              Places counted within about 40 m of each route. Extra time includes time at stops.
            </span>
          </div>
        )}

        <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
          <QualityBadge q={p.route.quality} provider={p.route.provider} />
          <span className="badge badge-model" title={p.scorer.info}>
            <Icon name="sparkle" size={14} /> {p.scorer.source === 'neural-network' ? 'Stops ranked by the preference network' : 'Fallback ranking (model unavailable)'}
          </span>
        </div>
        {p.route.note && <p className="notice small">{p.route.note}</p>}
        {!p.reachable && (
          <p className="notice notice-danger small" role="alert">
            The direct walk ({formatMinutes(p.directWalkMin)}) is longer than your {formatMinutes(budget)} budget, so no stops were added.
          </p>
        )}

        <div className="stat-row" style={{ marginTop: 6 }}>
          <div className="stat"><b>{formatMinutes(p.walkMin)}</b><span>walking · {formatDistance(p.route.distance_m)}</span></div>
          <div className="stat"><b>{formatMinutes(p.visitMin)}</b><span>exploring {nVisit} stop{nVisit === 1 ? '' : 's'}{nPass ? ` + passing ${nPass}` : ''}</span></div>
          <div className="stat"><b>{formatMinutes(p.totalMin)}</b><span>of {formatMinutes(budget)} budget</span></div>
        </div>
        <div style={{ marginTop: 10 }} aria-label={`Time budget: ${Math.round(p.totalMin)} of ${budget} minutes used`}>
          <div className="budget-bar">
            <i style={{ width: `${walkPct}%`, background: 'var(--ink)' }} />
            <i style={{ width: `${visitPct}%`, background: 'var(--terracotta)' }} />
          </div>
          <div className="row spread tiny muted" style={{ marginTop: 4 }}>
            <span>Walking · Exploring</span>
            <span>Direct route alone: {formatMinutes(p.directWalkMin)}</span>
          </div>
        </div>
        {p.droppedForBudget.length > 0 && (
          <p className="small muted" style={{ marginTop: 8 }}>
            {p.droppedForBudget.length} stop(s) were removed after the router returned real walking times, to keep you within budget.
          </p>
        )}

        <div className="row wrap" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={() => go('/navigate')}><Icon name="walk" /> Start walking</button>
          <button className="btn btn-ghost" onClick={() => replan()} disabled={busy}>
            {busy ? <span className="spinner" /> : <Icon name="refresh" size={16} />} Re-plan with my latest preferences
          </button>
        </div>

        {taste && (
          <div className="notice small taste-note fade-in" role="status">
            <b>{taste.signal === 'like' ? `You liked ${taste.name}.` : `${taste.name} removed.`}</b> Your taste: {taste.text}.{' '}
            {taste.signal === 'like'
              ? <button className="linkish" onClick={() => { setTaste(null); void replan() }} disabled={busy}>Re-plan with it</button>
              : <span className="muted">Re-planned without it.</span>}
          </div>
        )}

        <StoryCard key={p.createdAt} plan={p} />

        <h3 style={{ marginTop: 24 }}>Your stops</h3>
        {p.stops.length === 0 && (
          <p className="muted small">
            No stops fit this budget and mode. Try more time, the "Maximum history" mode, or different interests.
          </p>
        )}
        <div className="card" style={{ overflow: 'hidden' }}>
          {p.stops.map((s, i) => (
            <div className="stop fade-in" key={s.place.id}>
              <div className="stop-num">{i + 1}</div>
              <div>
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4><button onClick={() => { signal(s.place.id, 'open_details'); go(`/place/${s.place.id}`) }}>{s.place.name}</button></h4>
                    <PlaceTags p={s.place} />
                  </div>
                  <PlaceThumb p={s.place} size={56} />
                </div>
                <p className="small" style={{ margin: '8px 0' }}>{s.place.summary}</p>
                <div className="row wrap tiny muted" style={{ gap: 12 }}>
                  <span title="Relevance predicted by the preference network">Match <Meter v={s.personal} /> {Math.round(s.personal * 100)}%</span>
                  <span>+{Math.round(s.detourMin)} min detour</span>
                  <span>{s.kind === 'pass' ? `walk past · ${s.visitMin} min look` : `${s.visitMin} min visit`}</span>
                </div>
                <div className="row wrap" style={{ marginTop: 10, gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => rate(s.place.id, 'like')}
                    aria-label={`More like ${s.place.name}`}><Icon name="up" size={14} /> More like this</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => rate(s.place.id, 'dislike')}
                    aria-label={`${s.place.name} is not for me`}><Icon name="down" size={14} /> Not for me</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => signal(s.place.id, 'save')}
                    aria-pressed={profile.saved.includes(s.place.id)}><Icon name="bookmark" size={14} /> {profile.saved.includes(s.place.id) ? 'Saved' : 'Save'}</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy}
                    onClick={() => { signal(s.place.id, 'skip'); void replan(s.place.id) }}><Icon name="skip" size={14} /> Skip</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {passing.length > 0 && (
          <p className="small" style={{ marginTop: 14 }}>
            <b>Also on your path:</b>{' '}
            {passing.map((x, i) => (
              <span key={x.id}><button className="linkish" onClick={() => go(`/place/${x.id}`)}>{x.name}</button>{i < passing.length - 1 ? ', ' : ''}</span>
            ))}
            <span className="muted"> (within about 40 m of your route)</span>
          </p>
        )}

        <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => setShowWhy(!showWhy)} aria-expanded={showWhy}>
          <Icon name="info" size={15} /> How this route was chosen
        </button>
        {showWhy && (
          <div className="card card-pad small fade-in" style={{ marginTop: 10 }}>
            <p><b>1. Personal relevance.</b> {p.scorer.info} scored all {PLACES.length} places for your interests and interaction history.</p>
            <p><b>2. Selection.</b> A deterministic greedy-insertion optimiser added stops (to visit, or just to walk past
              for a couple of minutes) whose cultural value
              (personal score blended with historical significance) outweighed the extra walking and visit time,
              while keeping walking + exploring within your budget. Candidate costs came from
              {p.selectionCost === 'street-network' ? ' the bundled OpenStreetMap street network.' : p.selectionCost === 'pedestrian-matrix' ? ' a bundled Valhalla pedestrian distance matrix between places (straight-line estimates for any other point).' : ' straight-line distances × 1.35 (no street data available).'}</p>
            <p><b>3. Routing.</b> The final waypoints were sent to {p.route.provider}. Attempts:{' '}
              {p.attempts.map((a, i) => <span key={i}>{a.provider} {a.ok ? 'ok' : `failed (${a.error})`}{i < p.attempts.length - 1 ? ', ' : ''}</span>)}.</p>
            <p><b>4. Budget check.</b> Walking time uses {profile.walkingSpeedKmh} km/h (change it on Profile). Visit times are curated estimates.
              Arrival times are estimates, not guarantees.</p>
          </div>
        )}
      </aside>
    </div>
  )
}
