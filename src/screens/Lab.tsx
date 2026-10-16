import { useEffect, useState } from 'react'
import { PLACE_BY_ID } from '../lib/data'
import { EMBED_MODEL } from '../lib/vision/embedder'
import { runLab, type LabReport } from '../lib/vision/lab'
import type { ReferenceIndexFile } from '../lib/vision/recognizer'

declare global { interface Window { __TRAILS_LAB__?: { done: boolean; error?: string; index?: ReferenceIndexFile; report?: LabReport } } }

function download(name: string, obj: unknown) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }))
  a.download = name
  a.click()
}

/** Developer page (#/lab): rebuilds the reference index and measures recognition accuracy in this browser. */
export function Lab() {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const model = params.get('model') ?? EMBED_MODEL
  const [lines, setLines] = useState<string[]>([])
  const [out, setOut] = useState<{ index: ReferenceIndexFile; report: LabReport } | null>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true); setLines([])
    window.__TRAILS_LAB__ = { done: false }
    try {
      const r = await runLab(model, (s) => setLines((l) => [...l.slice(-12), s]))
      setOut(r)
      window.__TRAILS_LAB__ = { done: true, ...r }
    } catch (e) {
      window.__TRAILS_LAB__ = { done: true, error: String(e) }
      setLines((l) => [...l, `Error: ${e}`])
    } finally {
      setRunning(false)
    }
  }
  useEffect(() => { if (params.get('auto')) void run() }, []) // eslint-disable-line

  const t = out?.report.test
  return (
    <div className="page">
      <p className="eyebrow">Developer</p>
      <h1 style={{ fontSize: '2.2rem' }}>Vision lab</h1>
      <p className="muted">
        Rebuilds the landmark reference index from the bundled reference photos with <b>{model}</b>, calibrates the decision
        threshold on reference photos only, then evaluates on held-out photos and unrelated landmarks. All numbers are measured here.
      </p>
      <button className="btn btn-primary" onClick={run} disabled={running}>{running ? 'Running…' : 'Run evaluation'}</button>
      <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{lines.join('\n')}</pre>
      {out && t && (
        <div className="card card-pad">
          <h3>Results ({out.report.landmarks} landmarks, {t.known_images} held-out photos, {t.negatives} unrelated photos)</h3>
          <ul>
            <li>Top-1 accuracy (best guess, no abstaining): {(t.top1_accuracy * 100).toFixed(1)}%</li>
            <li>Recognised correctly: {(t.recognized_correct * 100).toFixed(1)}% · wrong: {(t.recognized_wrong * 100).toFixed(1)}% · abstained: {(t.abstained * 100).toFixed(1)}%</li>
            <li>Unrelated landmarks falsely accepted: {(t.negative_false_accept * 100).toFixed(1)}%</li>
            <li>With 2 km location filter: top-1 {(t.with_geo_filter_2km.top1_accuracy * 100).toFixed(1)}%, recognised correctly {(t.with_geo_filter_2km.recognized_correct * 100).toFixed(1)}%</li>
            <li>Mean time per photo (6 crops): {t.mean_ms_per_image} ms</li>
          </ul>
          <details><summary>Per landmark</summary>
            <ul className="small">{Object.entries(out.report.per_landmark).map(([k, v]) => <li key={k}>{PLACE_BY_ID[k]?.name}: {v.top1}/{v.test} top-1, {v.recognized} recognised</li>)}</ul>
          </details>
          <div className="row wrap">
            <button className="btn btn-ghost btn-sm" onClick={() => download('reference_index.json', out.index)}>Download index</button>
            <button className="btn btn-ghost btn-sm" onClick={() => download(`vision_eval_${model}.json`, out.report)}>Download report</button>
          </div>
        </div>
      )}
    </div>
  )
}
