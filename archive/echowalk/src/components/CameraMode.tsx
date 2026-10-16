import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset, Place } from '../types';
import { angleDiff, bearing, formatDistance, haversine, HeadingSmoother, normalizeHeading } from '../lib/geo';
import PlaceSheet from './PlaceSheet';

interface Props {
  data: Dataset;
  onClose: () => void;
}

type Source = 'demo' | 'live';
type SensorState = 'idle' | 'waiting' | 'ok' | 'denied' | 'unavailable';

interface Visible { place: Place; rel: number; dist: number; x: number; lane: number }

const RANGE_M = { demo: 700, live: 600 };
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const cardinal = (h: number) => CARDINALS[Math.round(h / 45) % 8];

type IOSOrientationEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

export default function CameraMode({ data, onClose }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [heading, setHeading] = useState(0);
  const [fov, setFov] = useState(60);
  const [camera, setCamera] = useState<SensorState>('idle');
  const [gps, setGps] = useState<SensorState>('idle');
  const [compass, setCompass] = useState<SensorState>('idle');
  const [picked, setPicked] = useState<Place | null>(null);
  const [sheet, setSheet] = useState<Place | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cleanups = useRef<(() => void)[]>([]);
  const drag = useRef<{ x: number; h: number } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 600);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Labels are wider relative to the screen on phones, so they need more horizontal spacing.
  const minGap = narrow ? 64 : 22;
  const lanes = narrow ? 4 : 6; // keep labels below the top controls

  const stopAll = useCallback(() => {
    cleanups.current.forEach((f) => f());
    cleanups.current = [];
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => stopAll, [stopAll]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setCamera('unavailable'); return; }
    setCamera('waiting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
      setCamera('ok');
    } catch (e) {
      setCamera((e as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
    }
  }, []);

  const startCompass = useCallback(async () => {
    const DOE = (window as unknown as { DeviceOrientationEvent?: IOSOrientationEvent }).DeviceOrientationEvent;
    if (!DOE) { setCompass('unavailable'); return; }
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') { setCompass('denied'); return; }
      } catch { setCompass('denied'); return; }
    }
    setCompass('waiting');
    const smoother = new HeadingSmoother(0.18);
    const onEvt = (e: Event) => {
      const ev = e as CompassEvent;
      let h: number | null = null;
      if (typeof ev.webkitCompassHeading === 'number') h = ev.webkitCompassHeading;
      else if (ev.absolute && typeof ev.alpha === 'number') h = 360 - ev.alpha;
      if (h === null) return;
      const screenAngle = (screen.orientation?.angle ?? 0);
      setHeading(smoother.push(normalizeHeading(h + screenAngle)));
      setCompass('ok');
    };
    const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evName, onEvt);
    cleanups.current.push(() => window.removeEventListener(evName, onEvt));
    const t = setTimeout(() => setCompass((c) => (c === 'waiting' ? 'unavailable' : c)), 3000);
    cleanups.current.push(() => clearTimeout(t));
  }, []);

  const startGps = useCallback(() => {
    if (!navigator.geolocation) { setGps('unavailable'); return; }
    setGps('waiting');
    const id = navigator.geolocation.watchPosition(
      (p) => { setPos({ lat: p.coords.latitude, lon: p.coords.longitude }); setGps('ok'); },
      (err) => setGps(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    cleanups.current.push(() => navigator.geolocation.clearWatch(id));
  }, []);

  const begin = (s: Source) => {
    stopAll();
    setPicked(null);
    setSource(s);
    if (s === 'demo') {
      const vp = data.city.demoViewpoint;
      setPos({ lat: vp.lat, lon: vp.lon });
      setHeading(vp.heading);
      setGps('ok'); setCompass('ok');
      startCamera();
    } else {
      setPos(null);
      setCamera('idle'); setGps('idle'); setCompass('idle');
      // All three requests start from this tap, which iOS requires for permission prompts.
      startCompass();
      startCamera();
      startGps();
    }
  };

  const manualHeading = source === 'demo' || compass === 'unavailable' || compass === 'denied';
  const range = source ? RANGE_M[source] : 600;

  const { visible, left, right, nearby } = useMemo(() => {
    if (!pos) return { visible: [] as Visible[], left: 0, right: 0, nearby: [] as { place: Place; b: number; dist: number }[] };
    const nearby = data.places
      .map((place) => ({ place, b: bearing(pos, place), dist: haversine(pos, place) }))
      .filter((c) => c.dist <= range && c.dist > 5);
    const half = fov / 2;
    let left = 0, right = 0;
    const inView: Omit<Visible, 'lane'>[] = [];
    for (const c of nearby) {
      const rel = angleDiff(c.b, heading);
      if (rel < -half - 4) left++;
      else if (rel > half + 4) right++;
      else inView.push({ place: c.place, rel, dist: c.dist, x: 50 + (rel / fov) * 100 });
    }
    // Nearest first get the lowest lanes; spread labels so they don't overlap.
    inView.sort((a, b) => a.dist - b.dist);
    const placed: Visible[] = [];
    for (const v of inView) {
      let lane = 0;
      while (lane < lanes && placed.some((p) => p.lane === lane && Math.abs(p.x - v.x) < minGap)) lane++;
      if (lane < lanes) placed.push({ ...v, lane });
    }
    return { visible: placed, left, right, nearby };
  }, [data.places, pos, heading, fov, range, minGap, lanes]);

  // Drag on the view to turn (demo mode, or when no compass exists).
  const onPointerDown = (e: React.PointerEvent) => {
    if (!manualHeading || (e.target as HTMLElement).closest('button, .popup')) return;
    drag.current = { x: e.clientX, h: heading };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !viewRef.current) return;
    const w = viewRef.current.clientWidth || 1;
    setHeading(normalizeHeading(drag.current.h - ((e.clientX - drag.current.x) / w) * fov));
  };
  const onPointerUp = () => { drag.current = null; };

  useEffect(() => {
    if (!manualHeading) return;
    const onKey = (e: KeyboardEvent) => {
      if (sheet) return;
      if (e.key === 'ArrowLeft') setHeading((h) => normalizeHeading(h - 10));
      if (e.key === 'ArrowRight') setHeading((h) => normalizeHeading(h + 10));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manualHeading, sheet]);

  const status = () => {
    if (source !== 'live') return null;
    const msgs: string[] = [];
    if (gps === 'waiting') msgs.push('Finding your location…');
    if (gps === 'denied') msgs.push('Location access was blocked. Allow it in your browser settings, or use the indoor demo.');
    if (gps === 'unavailable') msgs.push("Your location isn't available on this device. Use the indoor demo instead.");
    if (compass === 'denied') msgs.push('Motion access was blocked, so drag the view to turn.');
    if (compass === 'unavailable') msgs.push('No compass found on this device, so drag the view to turn.');
    if (camera === 'denied') msgs.push('Camera access was blocked. Labels still work without it.');
    if (pos && nearby.length === 0) msgs.push(`No places in the dataset within ${formatDistance(range)} of you. Try the indoor demo.`);
    return msgs.length ? <div className="cam__status" role="status">{msgs.map((m) => <p key={m}>{m}</p>)}</div> : null;
  };

  if (!source) {
    return (
      <div className="cam cam--intro">
        <div className="cam__intro">
          <button className="cam__x" onClick={onClose} aria-label="Close camera view">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <h2>Point your phone at the street</h2>
          <p>EchoWalk uses your location and compass to label the historic places in front of you. Tap a label to read about it.</p>
          <p className="cam__fine">Labels show the direction of each place, not its exact outline. Compasses can drift by 10–20° near buildings.</p>
          <div className="cam__intro-actions">
            <button className="btn btn--primary" onClick={() => begin('live')}>Start camera view</button>
            <button className="btn btn--light" onClick={() => begin('demo')}>Try the indoor demo</button>
          </div>
          <p className="cam__fine">The indoor demo places you in {data.city.demoViewpoint.name} with a simulated location and heading.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cam">
      <div
        ref={viewRef}
        className={`cam__view ${manualHeading ? 'is-draggable' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <video ref={video} className={`cam__video ${camera === 'ok' ? 'is-on' : ''}`} playsInline muted autoPlay />
        {camera !== 'ok' && <div className="cam__backdrop" aria-hidden="true" />}

        <div className="cam__top">
          <button className="cam__x" onClick={() => { stopAll(); onClose(); }} aria-label="Close camera view">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <div className="compass" aria-label={`Heading ${Math.round(heading)} degrees`}>
            <strong>{cardinal(heading)}</strong> {Math.round(heading)}°
          </div>
          <div className="cam__mode">
            <button className={source === 'demo' ? 'is-on' : ''} onClick={() => begin('demo')}>Demo</button>
            <button className={source === 'live' ? 'is-on' : ''} onClick={() => begin('live')}>Live</button>
          </div>
        </div>

        {source === 'demo' && <div className="cam__sim">Simulated location and heading</div>}
        {source === 'live' && manualHeading && pos && <div className="cam__sim">Manual heading, drag to turn</div>}
        {status()}

        {visible.map((v) => (
          <button
            key={v.place.id}
            className={`label ${v.place.significance >= 4 ? 'label--major' : ''} ${picked?.id === v.place.id ? 'is-active' : ''}`}
            style={{ left: `${v.x}%`, top: `${62 - v.lane * 9.5}%`, transform: `translate(-${Math.min(100, Math.max(0, v.x))}%, -100%)`, ['--tip' as string]: `${Math.min(92, Math.max(8, v.x))}%` }}
            onClick={() => setPicked(v.place)}
          >
            <span className="label__name">{v.place.name}</span>
            <span className="label__dist">{formatDistance(v.dist)}</span>
          </button>
        ))}
        {left > 0 && <div className="edge edge--left" aria-hidden="true">‹ {left}</div>}
        {right > 0 && <div className="edge edge--right" aria-hidden="true">{right} ›</div>}

        {pos && !picked && (
          <svg className="radar" viewBox="-50 -50 100 100" aria-hidden="true">
            <circle r="46" className="radar__ring" />
            <path d={`M0 0 L${46 * Math.sin(((-fov / 2) * Math.PI) / 180)} ${-46 * Math.cos(((-fov / 2) * Math.PI) / 180)} A46 46 0 0 1 ${46 * Math.sin(((fov / 2) * Math.PI) / 180)} ${-46 * Math.cos(((fov / 2) * Math.PI) / 180)} Z`} className="radar__fov" />
            {nearby.map((n) => {
              const a = (angleDiff(n.b, heading) * Math.PI) / 180;
              const r = (n.dist / range) * 44;
              return <circle key={n.place.id} cx={r * Math.sin(a)} cy={-r * Math.cos(a)} r={2.4} className="radar__dot" />;
            })}
            <circle r="2.6" className="radar__me" />
          </svg>
        )}
        {picked && !sheet && (
          <div className="popup" role="dialog" aria-labelledby="popup-title">
            <button className="popup__close" onClick={() => setPicked(null)} aria-label="Close">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <p className="popup__meta">{pos ? formatDistance(haversine(pos, picked)) : ''} away, {picked.period}</p>
            <h3 id="popup-title">{picked.name}</h3>
            <p>{picked.summary}</p>
            <button className="btn btn--primary" onClick={() => setSheet(picked)}>More info</button>
          </div>
        )}
      </div>

      {manualHeading && (
        <div className="cam__controls">
          <button onClick={() => setHeading((h) => normalizeHeading(h - 15))} aria-label="Turn left">‹</button>
          <input type="range" min={0} max={359} value={Math.round(heading)} onChange={(e) => setHeading(Number(e.target.value))} aria-label="Heading in degrees" />
          <button onClick={() => setHeading((h) => normalizeHeading(h + 15))} aria-label="Turn right">›</button>
          <label className="fov">
            Field of view
            <select value={fov} onChange={(e) => setFov(Number(e.target.value))}>
              <option value={50}>50°</option><option value={60}>60°</option><option value={75}>75°</option>
            </select>
          </label>
        </div>
      )}


      <PlaceSheet place={sheet} startExpanded onClose={() => setSheet(null)} />
    </div>
  );
}
