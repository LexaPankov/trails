import { useEffect, useState } from 'react'
import { IMAGES, PLACES } from '../lib/data'
import type { LabReport } from '../lib/vision/lab'
import { useApp } from '../state'

interface Metrics {
  WARNING: string
  device: { backend: string; device_name: string; torch: string }
  architecture: string
  parameters: number
  training_seconds: number
  test: Record<string, { set: string; auc: number; logloss: number | null; ['ndcg@5_vs_simulator_truth']: number }>
}

const BASE = import.meta.env.BASE_URL

export function About() {
  const { scorer } = useApp()
  const [m, setM] = useState<Metrics | null>(null)
  const [v, setV] = useState<LabReport | null>(null)
  useEffect(() => {
    fetch(`${BASE}models/metrics.json`).then((r) => (r.ok ? r.json() : null)).then(setM).catch(() => null)
    fetch(`${BASE}vision/eval_report.json`).then((r) => (r.ok ? r.json() : null)).then(setV).catch(() => null)
  }, [])
  const nImgs = Object.values(IMAGES.landmarks).reduce((a, x) => a + x.length, 0)

  return (
    <div className="page fade-in prose">
      <p className="eyebrow">About TRAILS</p>
      <h1 style={{ fontSize: '2.4rem' }}>Sources, models & limitations</h1>

      <h3>Personalisation model</h3>
      <p>
        A small multilayer perceptron predicts how relevant each place is to you from your selected interests, the affinity
        learned from your reactions, and the place's period, themes, hidden-gem status, significance and visit time. Its
        scores decide which stops the route optimiser considers and how valuable each one is. Currently active: <b>{scorer?.info ?? 'loading'}</b>.
      </p>
      {m && (
        <div className="card card-pad small">
          <p><b>{m.architecture}</b>, {m.parameters} parameters, trained in {m.training_seconds}s on {m.device.backend} ({m.device.device_name}), PyTorch {m.device.torch}.</p>
          <ul>
            {Object.entries(m.test).map(([k, r]) => (
              <li key={k}>{r.set}: AUC {r.auc.toFixed(3)}{r.logloss !== null ? `, log-loss ${r.logloss.toFixed(3)}` : ''}, NDCG@5 {r['ndcg@5_vs_simulator_truth'].toFixed(3)}</li>
            ))}
          </ul>
          <p className="notice" style={{ margin: 0 }}>{m.WARNING}</p>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Camera recognition</h3>
      <p>
        MediaPipe's MobileNetV3 image embedder runs in your browser. The frame and five crops are compared with embeddings of
        {' '}{nImgs} openly licensed photos of {Object.keys(IMAGES.landmarks).length} Rome landmarks; a match needs a calibrated
        similarity threshold and margin, otherwise TRAILS says it does not recognise the scene. Labels are placed on the
        best-matching image region: an approximate 2D overlay, not 3D AR tracking.
      </p>
      {v && (
        <div className="card card-pad small">
          <p>Measured on {v.test.known_images} held-out photos and {v.test.negatives} photos of other landmarks ({v.model}):</p>
          <ul>
            <li>Top-1 accuracy: {(v.test.top1_accuracy * 100).toFixed(1)}%</li>
            <li>Recognised correctly {(v.test.recognized_correct * 100).toFixed(1)}%, wrong {(v.test.recognized_wrong * 100).toFixed(1)}%, abstained {(v.test.abstained * 100).toFixed(1)}%</li>
            <li>Other landmarks falsely accepted: {(v.test.negative_false_accept * 100).toFixed(1)}%</li>
          </ul>
          <p className="muted" style={{ margin: 0 }}>Photos are from the web, not phone-camera footage in the street; real-world accuracy will differ.</p>
        </div>
      )}

      <h3 style={{ marginTop: 24 }}>Routing</h3>
      <p>
        TRAILS never uses Google Maps. Stops are chosen by its own optimiser; walking routes come from TRAILS' own A* router on
        a bundled OpenStreetMap street network when present, otherwise from the public FOSSGIS Valhalla or OSRM pedestrian
        services (fair-use servers, configurable). If none respond, TRAILS shows a straight-line estimate and labels it as
        such. Map tiles: © OpenStreetMap contributors, rendered by CARTO.
      </p>

      <h3>Data</h3>
      <ul>
        <li>{PLACES.filter((p) => p.origin !== 'wikidata').length} curated Rome places. Each links to its Wikipedia article; summaries are short, conservative TRAILS texts. Significance and "hidden gem" labels are curatorial judgements.</li>
        {PLACES.some((p) => p.origin === 'wikidata') && (
          <li>{PLACES.filter((p) => p.origin === 'wikidata').length} more places imported automatically from Wikidata (type, date, style, location) with the lead of their English Wikipedia article as text (CC BY-SA 4.0). Their importance comes from how many Wikipedia language editions cover them. They were not reviewed by hand.</li>
        )}
        <li>Landmark photos: <a href={IMAGES.source_url} target="_blank" rel="noreferrer">{IMAGES.source}</a>; each photo keeps its Wikimedia Commons licence (CC BY / CC BY-SA), credited where shown.</li>
        <li>Recommendation training data is synthetic (simulated users); no real user data was used.</li>
        <li>Fonts: Fraunces and Inter (SIL Open Font License).</li>
      </ul>

      <h3>Limitations</h3>
      <ul>
        <li>Only central Rome is covered, and only {Object.keys(IMAGES.landmarks).length} landmarks can be recognised by the camera.</li>
        <li>Walking times and arrival estimates are approximate; turn-by-turn guidance is a prototype and has not been field-tested.</li>
        <li>The preference model is trained on simulated users; its quality with real travellers is unmeasured.</li>
        <li>Opening hours, tickets and accessibility are not modelled.</li>
      </ul>
      <p className="small"><a href="#/lab">Vision lab (re-run the recognition evaluation in this browser)</a></p>
    </div>
  )
}
