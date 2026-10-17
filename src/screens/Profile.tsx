import { useMemo } from 'react'
import { Icon } from '../components/Icon'
import { InterestPicker, Meter, PlaceThumb } from '../components/common'
import { MyWalks } from '../components/MyWalks'
import { PLACE_BY_ID, PLACES } from '../lib/data'
import { INTEREST_LABEL, INTERESTS, zeroAffinity } from '../lib/model/features'
import { SIGNAL_LABEL, SIGNAL_WEIGHTS } from '../lib/profile'
import type { ProviderChoice } from '../lib/routing'
import { DEMO_SCENARIOS, useApp } from '../state'

export function Profile() {
  const { profile, setProfile, reset, scorer, settings, setSettings, demo, setDemo, scenario, setScenario } = useApp()

  const ranking = useMemo(() => {
    if (!scorer) return []
    return PLACES.map((p) => ({
      p,
      now: scorer.score(profile.interests, profile.affinity, p),
      base: scorer.score(profile.interests, zeroAffinity(), p),
    })).sort((a, b) => b.now - a.now || a.p.id.localeCompare(b.p.id))
  }, [scorer, profile.interests, profile.affinity])

  return (
    <div className="page fade-in">
      <p className="eyebrow">Your profile</p>
      <h1 style={{ fontSize: '2.4rem' }}>What you love</h1>
      <MyWalks />
      <div className="grid2">
        <section className="card card-pad">
          <h3>Interests</h3>
          <InterestPicker value={profile.interests} onChange={(interests) => setProfile({ ...profile, interests })} />
          <hr className="rule" />
          <h3>Learned from your reactions</h3>
          <p className="small muted">
            Each like, save, visit or "read more" nudges these values up; "not for me" pushes them down. Skips count only a
            little, because skipping often means you were short of time. They feed the neural network as extra inputs.
          </p>
          <div className="stack">
            {INTERESTS.map((k) => {
              const v = profile.affinity[k]
              return (
                <div className="aff" key={k}>
                  <span>{INTEREST_LABEL[k]}</span>
                  <span className="aff-bar" aria-label={`${INTEREST_LABEL[k]} affinity ${v.toFixed(2)}`}>
                    <i style={{ left: v >= 0 ? '50%' : `${50 + v * 50}%`, width: `${Math.abs(v) * 50}%`, background: v >= 0 ? 'var(--olive)' : 'var(--danger)' }} />
                  </span>
                  <span className="tiny muted">{v >= 0 ? '+' : ''}{v.toFixed(2)}</span>
                </div>
              )
            })}
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Rule: affinity += weight × (place's interest axes) / √(number of axes), clipped to [−1, 1]. Weights:{' '}
            {Object.entries(SIGNAL_WEIGHTS).map(([k, w]) => `${SIGNAL_LABEL[k as keyof typeof SIGNAL_LABEL]} ${w > 0 ? '+' : ''}${w}`).join(', ')}.
          </p>
        </section>

        <section className="card card-pad">
          <h3>How your preferences shape recommendations</h3>
          <p className="small muted">
            Top places for you right now, scored by {scorer?.info ?? 'the model (loading)'}. The arrow shows how your reactions
            moved each score compared with interests alone.
          </p>
          <div className="stack">
            {ranking.slice(0, 8).map(({ p, now, base }) => (
              <a key={p.id} href={`#/place/${p.id}`} className="row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <PlaceThumb p={p} size={40} />
                <span style={{ flex: 1, minWidth: 0 }}><strong>{p.name}</strong></span>
                <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>
                  <Meter v={now} /> {Math.round(now * 100)}%
                  {Math.abs(now - base) >= 0.01 && <> ({now > base ? '▲' : '▼'}{Math.abs(Math.round((now - base) * 100))})</>}
                </span>
              </a>
            ))}
          </div>
        </section>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="card card-pad">
          <h3>Saved discoveries</h3>
          {profile.saved.length === 0 && <p className="small muted">Nothing saved yet. Use "Save" on a stop or place.</p>}
          <div className="stack">
            {profile.saved.map((id) => PLACE_BY_ID[id]).filter(Boolean).map((p) => (
              <div key={p.id} className="row">
                <PlaceThumb p={p} size={40} />
                <a href={`#/place/${p.id}`} style={{ flex: 1 }}>{p.name}</a>
                <button className="btn btn-ghost btn-sm" onClick={() => setProfile({ ...profile, saved: profile.saved.filter((x) => x !== p.id) })}>Remove</button>
              </div>
            ))}
          </div>
          {profile.dismissed.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>Hidden from routes</h4>
              <div className="row wrap">
                {profile.dismissed.map((id) => (
                  <button key={id} className="chip" onClick={() => setProfile({ ...profile, dismissed: profile.dismissed.filter((x) => x !== id) })}>
                    {PLACE_BY_ID[id]?.name ?? id} <Icon name="x" size={13} />
                  </button>
                ))}
              </div>
            </>
          )}
          <h4 style={{ marginTop: 16 }}>Recent activity</h4>
          {profile.events.length === 0 ? <p className="small muted">No interactions yet.</p> : (
            <ul className="small" style={{ paddingLeft: 18 }}>
              {[...profile.events].reverse().slice(0, 8).map((e, i) => (
                <li key={i}>{SIGNAL_LABEL[e.signal]}: {PLACE_BY_ID[e.placeId]?.name ?? e.placeId}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad">
          <h3>Walking & routing</h3>
          <label className="field" htmlFor="speed">Walking speed: {profile.walkingSpeedKmh.toFixed(1)} km/h</label>
          <input id="speed" type="range" min={3} max={6} step={0.1} value={profile.walkingSpeedKmh}
            onChange={(e) => setProfile({ ...profile, walkingSpeedKmh: +e.target.value })} />
          <label className="field" htmlFor="router" style={{ marginTop: 12 }}>Routing provider</label>
          <select id="router" value={settings.routing} onChange={(e) => setSettings({ ...settings, routing: e.target.value as ProviderChoice })}>
            <option value="auto">Automatic (bundled street network, then Valhalla, then OSRM, then estimate)</option>
            <option value="trails-local">TRAILS router on bundled OpenStreetMap data</option>
            <option value="valhalla">Valhalla pedestrian (live, FOSSGIS server)</option>
            <option value="osrm-foot">OSRM foot (live, FOSSGIS server)</option>
            <option value="estimate">Straight-line estimate only</option>
          </select>
          <label className="row small" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={settings.offline} onChange={(e) => setSettings({ ...settings, offline: e.target.checked })} />
            Offline mode: never call external routing services
          </label>

          <hr className="rule" />
          <h3>Demo mode</h3>
          <label className="row small">
            <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
            Simulate my location (for indoor demos)
          </label>
          <label className="field" htmlFor="scenario" style={{ marginTop: 10 }}>Simulated scenario</label>
          <select id="scenario" value={scenario.id} onChange={(e) => setScenario(DEMO_SCENARIOS.find((s) => s.id === e.target.value)!)}>
            {DEMO_SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>

          <hr className="rule" />
          <h3>Privacy</h3>
          <p className="small muted">
            Your interests, reactions and saved places are stored only in this browser. TRAILS has no account and no
            server. Your real location is used only if you allow it, only while navigating, and is never stored or sent
            anywhere; routing requests send the start, stop and destination coordinates to the routing provider you choose.
          </p>
          <label className="row small">
            <input type="checkbox" checked={profile.locationConsent} onChange={(e) => setProfile({ ...profile, locationConsent: e.target.checked })} />
            Allow TRAILS to use my real location while navigating
          </label>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }}
            onClick={() => { if (confirm('Reset your interests, reactions and saved places on this device?')) reset() }}>
            <Icon name="refresh" size={14} /> Reset my profile
          </button>
        </section>
      </div>
    </div>
  )
}
