import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { ImageCredit } from '../components/common'
import { IMAGES, PLACE_BY_ID } from '../lib/data'
import { embed, loadEmbedder } from '../lib/vision/embedder'
import { loadReferenceIndex, Recognizer, type Recognition } from '../lib/vision/recognizer'
import { go, useApp } from '../state'

const BASE = import.meta.env.BASE_URL
type Source = 'live' | 'gallery' | 'upload'

interface DemoImg { file: string; truth: string | null }
const DEMO_IMAGES: DemoImg[] = [
  ...Object.entries(IMAGES.landmarks).flatMap(([id, imgs]) => imgs.filter((i) => i.split === 'test').slice(0, 2).map((i) => ({ file: i.file, truth: id }))),
  ...IMAGES.unknown_negatives.filter((_, i) => i % 2 === 1).slice(0, 6).map((i) => ({ file: i.file, truth: null })),
]

function cameraError(e: unknown): string {
  if (!window.isSecureContext) return 'The camera needs a secure (https://) connection. Open TRAILS over HTTPS or on localhost.'
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in your browser settings, or use the demo photos.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Use the demo photos instead.'
  if (name === 'NotReadableError') return 'The camera is in use by another app.'
  return `The camera could not be started${e instanceof Error ? `: ${e.message}` : ''}.`
}

/** Map a frame-relative region to element pixels for object-fit cover/contain. */
function toDisplay(r: Recognition['region'], srcW: number, srcH: number, elW: number, elH: number, fit: 'cover' | 'contain') {
  const s = fit === 'cover' ? Math.max(elW / srcW, elH / srcH) : Math.min(elW / srcW, elH / srcH)
  const ox = (elW - srcW * s) / 2, oy = (elH - srcH * s) / 2
  const x = ox + r.x * srcW * s, y = oy + r.y * srcH * s, w = r.w * srcW * s, h = r.h * srcH * s
  const cx = Math.min(elW - 20, Math.max(20, x + w / 2))
  return { box: { left: Math.max(0, x), top: Math.max(0, y), width: Math.min(w, elW), height: Math.min(h, elH) }, label: { left: cx, top: Math.max(70, y + 24) } }
}

export function Camera() {
  const { location, signal } = useApp()
  const [source, setSource] = useState<Source>('gallery')
  const [rec, setRec] = useState<Recognizer | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [camErr, setCamErr] = useState<string | null>(null)
  const [result, setResultRaw] = useState<(Recognition & { srcW: number; srcH: number }) | null>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [stable, setStable] = useState<string | null>(null)
  const [demoImg, setDemoImg] = useState<DemoImg>(DEMO_IMAGES[0])
  const [upload, setUpload] = useState<string | null>(null)
  const [geo, setGeo] = useState(false)
  const [details, setDetails] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const history = useRef<(string | null)[]>([])

  useEffect(() => {
    let alive = true
    Promise.all([loadReferenceIndex(), loadReferenceIndex().then((ix) => loadEmbedder(ix.model))])
      .then(([ix, emb]) => { if (alive) setRec(new Recognizer(ix, (c) => embed(emb, c))) })
      .catch((e) => alive && setLoadErr(`Recognition model could not be loaded: ${e instanceof Error ? e.message : e}`))
    const onResize = () => { const el = stageRef.current; if (el) setStage({ w: el.clientWidth, h: el.clientHeight }) }
    onResize()
    window.addEventListener('resize', onResize)
    return () => { alive = false; window.removeEventListener('resize', onResize) }
  }, [])

  // live camera stream
  useEffect(() => {
    if (source !== 'live') return
    let stream: MediaStream | null = null
    setCamErr(null)
    if (!navigator.mediaDevices?.getUserMedia) { setCamErr(cameraError(new Error('camera API unavailable in this browser'))); return }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      .then((s) => { stream = s; if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play() } })
      .catch((e) => setCamErr(cameraError(e)))
    return () => stream?.getTracks().forEach((t) => t.stop())
  }, [source])

  const near = geo ? location : null

  // continuous recognition on the live stream, with temporal smoothing (2 of last 3 frames)
  useEffect(() => {
    if (source !== 'live' || !rec) return
    history.current = []
    const id = window.setInterval(() => {
      const v = videoRef.current
      if (!v || v.readyState < 2 || !v.videoWidth) return
      const r = rec.recognize(v, v.videoWidth, v.videoHeight, { near })
      setResultRaw({ ...r, srcW: v.videoWidth, srcH: v.videoHeight })
      if (stageRef.current) setStage({ w: stageRef.current.clientWidth, h: stageRef.current.clientHeight })
      history.current = [...history.current, r.status === 'recognized' ? r.best!.placeId : null].slice(-3)
      const counts = new Map<string, number>()
      history.current.forEach((x) => x && counts.set(x, (counts.get(x) ?? 0) + 1))
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      setStable(top && top[1] >= 2 ? top[0] : null)
    }, 700)
    return () => clearInterval(id)
  }, [source, rec, near])

  // single-shot recognition for still images (demo photos / uploads)
  const runStill = useCallback(() => {
    const im = imgRef.current
    if (!rec || !im || !im.complete || !im.naturalWidth) return
    const r = rec.recognize(im, im.naturalWidth, im.naturalHeight, { near })
    setResultRaw({ ...r, srcW: im.naturalWidth, srcH: im.naturalHeight })
    if (stageRef.current) setStage({ w: stageRef.current.clientWidth, h: stageRef.current.clientHeight })
    setStable(r.status === 'recognized' ? r.best!.placeId : null)
  }, [rec, near])
  useEffect(() => { if (source !== 'live') runStill() }, [source, demoImg, upload, runStill])

  const placed = result && stage.w && result.srcW ? toDisplay(result.region, result.srcW, result.srcH, stage.w, stage.h, source === 'live' ? 'cover' : 'contain') : null
  const shown = stable ? PLACE_BY_ID[stable] : null
  const openPlace = open ? PLACE_BY_ID[open] : null

  return (
    <div className="cam-shell fade-in">
      <div className="row spread wrap" style={{ marginBottom: 12 }}>
        <div>
          <p className="eyebrow" style={{ margin: 0 }}>Camera discovery</p>
          <h2 style={{ margin: 0 }}>Point at a monument</h2>
        </div>
        <div className="seg" style={{ gridTemplateColumns: 'repeat(3, auto)' }} role="group" aria-label="Image source">
          {([['live', 'Live camera'], ['gallery', 'Demo photos'], ['upload', 'Upload']] as [Source, string][]).map(([k, l]) => (
            <button key={k} aria-pressed={source === k} onClick={() => { setSource(k); setResultRaw(null); setStable(null); setOpen(null) }}><strong>{l}</strong></button>
          ))}
        </div>
      </div>

      <div className="cam-stage" ref={stageRef}>
        {source === 'live' ? (
          <video ref={videoRef} playsInline muted autoPlay aria-label="Live camera view" />
        ) : (source === 'gallery' || upload) ? (
          <img ref={imgRef} className="cam-src" style={{ objectFit: 'contain' }} alt="Image being analysed"
            src={source === 'gallery' ? BASE + demoImg.file : upload ?? ''} onLoad={runStill} />
        ) : (
          <label style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#ddd', cursor: 'pointer', textAlign: 'center', padding: 20 }}>
            <span><Icon name="upload" size={28} /><br />Choose a photo of a Rome landmark<br /><span className="tiny">(analysed on this device, never uploaded)</span></span>
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) setUpload(URL.createObjectURL(f)) }} />
          </label>
        )}

        <div className="cam-status">
          <span className="badge">
            {source === 'live' ? 'Live camera' : source === 'gallery' ? 'Reference-image demo (held-out photo)' : 'Uploaded photo'}
          </span>
          <span className="badge">
            {!rec && !loadErr ? 'Loading model…' : loadErr ? 'Model unavailable'
              : !result ? 'Analysing…' : result.status === 'recognized' ? 'Recognised' : result.status === 'uncertain' ? 'Not sure yet' : 'No supported landmark'}
          </span>
        </div>

        {shown && placed && (
          <>
            <div className="ar-box" style={placed.box} aria-hidden />
            <button className="ar-label fade-in" style={placed.label} onClick={() => setOpen(shown.id)}>
              <strong>{shown.name}</strong>
              <small>{Math.round((result?.best?.score ?? 0) * 100)}% similarity · tap for history</small>
            </button>
          </>
        )}
        {result && !shown && (
          <div className="ar-unknown">
            {result.status === 'uncertain' ? 'Possibly a supported landmark: hold steady or move closer' : 'No supported landmark recognised'}
          </div>
        )}

        {openPlace && (
          <div className="sheet card card-pad fade-in" role="dialog" aria-label={openPlace.name}>
            <div className="row spread">
              <h3 style={{ margin: 0 }}>{openPlace.name}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setOpen(null)} aria-label="Close"><Icon name="x" size={16} /></button>
            </div>
            <p className="tiny muted" style={{ margin: '2px 0 8px' }}>{openPlace.built}</p>
            <p className="small">{openPlace.summary}</p>
            <div className="row wrap">
              <button className="btn btn-primary btn-sm" onClick={() => { signal(openPlace.id, 'open_details'); go(`/place/${openPlace.id}`) }}>Learn more <Icon name="arrow" size={14} /></button>
              <button className="btn btn-ghost btn-sm" onClick={() => signal(openPlace.id, 'like')}><Icon name="heart" size={14} /> Like</button>
            </div>
          </div>
        )}
      </div>

      {(camErr || loadErr) && <p className="notice notice-danger" role="alert" style={{ marginTop: 12 }}>{camErr ?? loadErr}</p>}

      <div className="row wrap small" style={{ marginTop: 12, gap: 16 }}>
        <label className="row"><input type="checkbox" checked={geo} onChange={(e) => setGeo(e.target.checked)} disabled={!location} />
          Narrow to landmarks within 2 km of {location ? (location.source === 'simulated' ? 'my simulated location' : 'my location') : 'my location (unavailable)'}</label>
        <label className="row"><input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} /> Show recognition details</label>
      </div>

      {details && result && rec && (
        <div className="card card-pad small" style={{ marginTop: 10 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Model {rec.model} · decision threshold {rec.threshold} (margin {rec.margin}) · {Math.round(result.ms)} ms on this device ·
            best-matching image region shown by the frame (approximate 2D placement, not 3D tracking).
          </p>
          {result.candidates.map((c) => (
            <div className="cand" key={c.placeId}>
              <span>{PLACE_BY_ID[c.placeId]?.name}</span>
              <span className="meter" style={{ width: '100%' }}><i style={{ width: `${Math.max(0, c.score) * 100}%`, background: c.score >= rec.threshold ? 'var(--ok)' : 'var(--muted)' }} /></span>
              <span>{c.score.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {source === 'gallery' && (
        <section style={{ marginTop: 16 }}>
          <p className="small muted">
            Indoor demo: these photos were held out and never used to build the recognition index, so recognising them
            is a genuine visual match. The last few show other landmarks and should come back as "not recognised".
            You can also point the live camera at one of these photos on another screen.
          </p>
          <div className="gallery">
            {DEMO_IMAGES.map((d) => (
              <button key={d.file} aria-pressed={d.file === demoImg.file} onClick={() => setDemoImg(d)}
                aria-label={d.truth ? `Photo of ${PLACE_BY_ID[d.truth]?.name}` : 'Photo of an unsupported landmark'}>
                <img src={BASE + d.file} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 6 }}>
            {demoImg.truth ? `Ground truth: ${PLACE_BY_ID[demoImg.truth]?.name}. ` : 'Ground truth: not a supported landmark. '}<ImageCredit file={demoImg.file} />
          </p>
        </section>
      )}

      {rec && (
        <details style={{ marginTop: 16 }} className="small">
          <summary>Supported landmarks ({rec.supported.length})</summary>
          <p className="muted">TRAILS recognises only these Rome landmarks; anything else is reported as not recognised.</p>
          <div className="row wrap" style={{ gap: 6 }}>
            {rec.supported.map((id) => <a key={id} className="tag" href={`#/place/${id}`}>{PLACE_BY_ID[id]?.name ?? id}</a>)}
          </div>
        </details>
      )}
    </div>
  )
}
