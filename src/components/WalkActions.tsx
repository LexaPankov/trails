import { useState } from 'react'
import type { Plan } from '../lib/planner'
import { planFromStops } from '../lib/planner'
import { requestFromSpec, sameWalk, shareUrl, specFromPlan, type WalkSpec } from '../lib/walks'
import { go, useApp } from '../state'
import { Icon } from './Icon'

/** Opens a saved or shared walk: routes the same stops again and shows the route screen. */
export function useOpenWalk() {
  const { profile, scorer, settings, setPlan, setStory } = useApp()
  return async (w: WalkSpec, replace = false) => {
    if (!scorer) throw new Error('The app is still loading. Try again in a second.')
    const req = requestFromSpec(w, { routing: settings.routing, offline: settings.offline })
    const plan = await planFromStops(req, w.stops, profile, scorer)
    setStory(null)
    setPlan(plan)
    if (replace) window.location.replace('#/route')
    else go('/route')
  }
}

/** Native share sheet on phones; otherwise copy the link. Returns what happened, for a short message. */
export async function shareWalk(w: WalkSpec): Promise<'shared' | 'copied' | 'cancelled' | { manual: string }> {
  const url = shareUrl(w)
  const title = `A walk in Rome: ${w.start.label} to ${w.end.label}`
  if (navigator.share) {
    try {
      await navigator.share({ title, text: `${title} (${w.stops.length} stops, TRAILS)`, url })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return { manual: url }
  }
}

/** "Save walk" and "Share" for the route screen. */
export function WalkButtons({ plan }: { plan: Plan }) {
  const { walks, saveWalk, removeWalk } = useApp()
  const spec = specFromPlan(plan)
  const saved = walks.some((w) => sameWalk(w, spec))
  const [msg, setMsg] = useState<string | null>(null)
  const [manual, setManual] = useState<string | null>(null)

  async function share() {
    const r = await shareWalk(specFromPlan(plan, true))
    if (r === 'copied') setMsg('Link copied. Send it to a friend: it opens this exact walk.')
    else if (r === 'shared' || r === 'cancelled') setMsg(null)
    else { setManual(r.manual); setMsg('Copy this link:') }
  }

  return (
    <div style={{ margin: '10px 0 4px' }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn btn-ghost btn-sm" aria-pressed={saved} onClick={() => (saved ? removeWalk(spec) : saveWalk(spec))}>
          <Icon name={saved ? 'check' : 'bookmark'} size={15} /> {saved ? 'Saved to My walks' : 'Save walk'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void share()}>
          <Icon name="share" size={15} /> Share
        </button>
      </div>
      {msg && <p className="tiny muted" role="status" style={{ margin: '6px 0 0' }}>{msg}</p>}
      {manual && <input readOnly value={manual} onFocus={(e) => e.target.select()} aria-label="Link to this walk" style={{ marginTop: 6 }} />}
      {saved && !msg && <p className="tiny muted" style={{ margin: '6px 0 0' }}>Find it later under Profile → My walks (kept on this device).</p>}
    </div>
  )
}
