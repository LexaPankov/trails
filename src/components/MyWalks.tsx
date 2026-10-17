import { useState } from 'react'
import { MODE_LABEL } from '../lib/optimizer'
import { formatMinutes } from '../lib/geo'
import type { WalkSpec } from '../lib/walks'
import { useApp } from '../state'
import { Icon } from './Icon'
import { shareWalk, useOpenWalk } from './WalkActions'

/** Profile → My walks: walks saved on this device, to open again or share. */
export function MyWalks() {
  const { walks, removeWalk } = useApp()
  const open = useOpenWalk()
  const [busy, setBusy] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function onOpen(w: WalkSpec, i: number) {
    setBusy(i); setNote(null)
    try { await open(w) } catch (e) { setNote((e as Error).message); setBusy(null) }
  }
  async function onShare(w: WalkSpec) {
    const r = await shareWalk({ ...w, start: { ...w.start, label: w.start.label.replace(/^My location · /, '') } })
    setNote(r === 'copied' ? 'Link copied. It opens this exact walk.' : typeof r === 'object' ? `Copy this link: ${r.manual}` : null)
  }

  return (
    <section className="card card-pad" style={{ marginBottom: 16 }} aria-labelledby="mywalks">
      <h3 id="mywalks">My walks</h3>
      {walks.length === 0 ? (
        <p className="small muted">No saved walks yet. Plan a walk and tap "Save walk" to keep it here.</p>
      ) : (
        <div className="stack">
          {walks.map((w, i) => (
            <div key={`${w.savedAt}-${i}`} className="walk-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <b className="walk-title">{w.start.label} → {w.end.label}</b>
                <div className="tiny muted">
                  {w.stops.filter((s) => s.kind === 'visit').length} stops · up to {formatMinutes(w.budgetMin)} · {MODE_LABEL[w.mode]}
                  {w.savedAt ? ` · saved ${new Date(w.savedAt).toLocaleDateString()}` : ''}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => void onOpen(w, i)}>
                  {busy === i ? <span className="spinner" /> : <Icon name="route" size={14} />} Open
                </button>
                <button className="btn btn-ghost btn-sm btn-icon" aria-label="Share this walk" title="Share" onClick={() => void onShare(w)}><Icon name="share" size={15} /></button>
                <button className="btn btn-ghost btn-sm btn-icon" aria-label="Delete this walk" title="Delete" onClick={() => removeWalk(w)}><Icon name="x" size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {note && <p className="tiny muted" role="status" style={{ margin: '8px 0 0', wordBreak: 'break-all' }}>{note}</p>}
      <p className="tiny muted" style={{ margin: '8px 0 0' }}>Kept only in this browser, like the rest of your profile. No account needed.</p>
    </section>
  )
}
