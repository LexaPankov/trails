import { useEffect, useRef, useState } from 'react'
import { useOpenWalk } from '../components/WalkActions'
import { decodeWalk } from '../lib/walks'
import { useApp } from '../state'

/** #/walk/<code>: a walk someone shared. Rebuilds it and opens the route screen. */
export function SharedWalk({ code }: { code?: string }) {
  const { scorer } = useApp()
  const open = useOpenWalk()
  const [err, setErr] = useState<string | null>(null)
  const started = useRef(false)
  const spec = code ? decodeWalk(code) : null

  useEffect(() => {
    if (!spec || !scorer || started.current) return
    started.current = true
    open(spec, true).catch((e) => setErr((e as Error).message || 'Could not open this walk.'))
  }, [spec, scorer, open])

  if (!spec || err) {
    return (
      <div className="page"><div className="card card-pad">
        <h2>This walk link does not work</h2>
        <p className="small muted">{err ?? 'The link is incomplete or damaged. Ask for it again, or plan your own walk.'}</p>
        <a className="btn btn-primary" href="#/">Plan a walk</a>
      </div></div>
    )
  }
  return (
    <div className="page"><div className="card card-pad" role="status">
      <p className="eyebrow">A walk shared with you</p>
      <h2>{spec.start.label} <span className="muted" style={{ fontWeight: 400 }}>to</span> {spec.end.label}</h2>
      <p className="small muted"><span className="spinner" /> Finding the streets for {spec.stops.length} stop{spec.stops.length === 1 ? '' : 's'}…</p>
    </div></div>
  )
}
