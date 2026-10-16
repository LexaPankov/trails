import { useCallback, useEffect, useState } from 'react';
import type { Dataset, PlanRequest, PlannedRoute, Place } from './types';
import { loadDataset } from './lib/data';
import { buildRoute } from './lib/routing';
import { PLANNER_CONFIG } from './lib/planner';
import { formatDistance, formatMinutes } from './lib/geo';
import Planner, { EXAMPLES } from './components/Planner';
import MapView from './components/MapView';
import PlaceSheet, { Photo, themeLabel } from './components/PlaceSheet';
import CameraMode from './components/CameraMode';

const DEFAULT_REQ: PlanRequest = { startId: 'duomo', endId: 'castello', minutes: 90, themes: ['renaissance', 'hidden'], mode: 'maximum' };

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [req, setReq] = useState<PlanRequest>(DEFAULT_REQ);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Place | null>(null);
  const [camera, setCamera] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    loadDataset().then(setData).catch((e: Error) => setLoadError(e.message));
  }, []);
  useEffect(load, [load]);

  const plan = useCallback(async (r: PlanRequest) => {
    if (!data) return;
    setBusy(true);
    setPlanError(null);
    try {
      const result = await buildRoute(data.places, r);
      setRoute(result);
      setSelected(null);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [data]);

  const openPlace = useCallback((id: string) => {
    if (!route) return;
    const p = [route.start, ...route.stops, route.end].find((x) => x.id === id) ?? null;
    setSelected(id);
    setSheet(p);
  }, [route]);

  const stopNumber = (id: string) => (route ? route.stops.findIndex((s) => s.id === id) + 1 || undefined : undefined);

  if (loadError) {
    return (
      <main className="state">
        <h1>The places couldn't be loaded</h1>
        <p>{loadError}</p>
        <button className="btn btn--primary" onClick={load}>Try again</button>
      </main>
    );
  }
  if (!data) return <main className="state"><p>Loading places…</p></main>;

  return (
    <>
      <header className="bar">
        <button className="brand" onClick={() => setRoute(null)} aria-label="EchoWalk home">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M4 26c5-1 6-8 11-9s7 4 13-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /><circle cx="4" cy="26" r="2.6" fill="currentColor" /><circle cx="15" cy="17" r="2.6" fill="#2F6B5E" /><circle cx="28" cy="14" r="2.6" fill="currentColor" /></svg>
          <span>EchoWalk</span>
        </button>
        <span className="bar__city">{data.city.name}</span>
        <button className="btn btn--quiet bar__cam" onClick={() => setCamera(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
          Camera view
        </button>
      </header>

      {!route ? (
        <main className="home">
          <section className="hero">
            <h1>See what you're walking past.</h1>
            <p className="hero__lede">
              Maps show you the fastest way. EchoWalk plans the walk with the most history in the time you have, through Roman walls, Renaissance courtyards and side streets you'd normally hurry past.
            </p>
            <div className="examples">
              <h2>Try a walk</h2>
              <ul>
                {EXAMPLES.map((ex) => (
                  <li key={ex.title}>
                    <button onClick={() => { const r = { ...req, ...ex.req, mode: ex.req.mode ?? 'maximum' }; setReq(r); plan(r); }} disabled={busy}>
                      {ex.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <section className="panel" aria-label="Plan a walk">
            <Planner data={data} value={req} onChange={setReq} onSubmit={() => plan(req)} busy={busy} />
            {planError && <p className="error" role="alert">{planError}</p>}
          </section>
        </main>
      ) : (
        <main className="result">
          <div className="result__map">
            <MapView route={route} selectedId={selected} onSelect={openPlace} />
          </div>
          <section className="result__side" aria-label="Your walk">
            <button className="back" onClick={() => setRoute(null)}>Change walk</button>
            <h1 className="result__title">{route.start.name} <span>to</span> {route.end.name}</h1>
            <dl className="summary">
              <div><dt>Walk</dt><dd>{formatMinutes(route.totalMin)}</dd></div>
              <div><dt>Distance</dt><dd>{formatDistance(route.distanceM)}</dd></div>
              <div><dt>Discoveries</dt><dd>{route.stops.length}</dd></div>
            </dl>
            <p className={`routing routing--${route.routing}`}>
              {route.routing === 'pedestrian'
                ? 'Walking route along real streets.'
                : 'Estimated route. The line shows the order of stops, not the exact streets.'}
              {' '}Times assume {PLANNER_CONFIG.walkSpeedMPerMin * 60 / 1000} km/h and {PLANNER_CONFIG.dwellMin[req.mode]} min at each stop, within your {formatMinutes(route.budgetMin)}.
            </p>
            {route.notes.map((n) => <p key={n} className="note">{n}</p>)}

            <ol className="thread">
              <li className="thread__end">
                <button onClick={() => openPlace(route.start.id)}><span className="thread__mark">A</span><span className="thread__name">{route.start.name}</span></button>
              </li>
              {route.stops.map((p, i) => (
                <li key={p.id} className={`thread__stop ${selected === p.id ? 'is-active' : ''} ${p.significance >= 4 ? 'is-major' : 'is-gem'}`}>
                  <button onClick={() => openPlace(p.id)}>
                    <span className="thread__mark">{i + 1}</span>
                    <span className="thread__text">
                      <span className="thread__name">{p.name}</span>
                      <span className="thread__meta">{p.period.replace(' · ', ', ')}{p.significance < 4 ? ', lesser-known' : ''}</span>
                      <span className="thread__sum">{p.summary}</span>
                      <span className="thread__tags">{p.themes.map(themeLabel).join(', ')}</span>
                    </span>
                    <Photo place={p} className="thread__photo" />
                  </button>
                </li>
              ))}
              <li className="thread__end">
                <button onClick={() => openPlace(route.end.id)}><span className="thread__mark">B</span><span className="thread__name">{route.end.name}</span></button>
              </li>
            </ol>
            <p className="legend"><span className="dot dot--major" /> Major landmark <span className="dot dot--gem" /> Lesser-known place</p>
            <button className="btn btn--light" onClick={() => setCamera(true)}>Look around with the camera</button>
          </section>
        </main>
      )}

      <PlaceSheet place={sheet} stopNumber={sheet ? stopNumber(sheet.id) : undefined} onClose={() => setSheet(null)} />
      {camera && <CameraMode data={data} onClose={() => setCamera(false)} />}
      <footer className="foot">
        Place texts come from a prepared dataset{data.source.verified === false ? ' (hand-curated seed data, coordinates approximate)' : ''}. Map data by OpenStreetMap contributors. Photos by Wikipedia contributors.
      </footer>
    </>
  );
}
