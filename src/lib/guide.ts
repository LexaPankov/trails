// Walk-mode audio guide: turns a plan (and its story, if one was written) into cues placed along the
// route, and decides which cue is due for the walker's current position. Pure, so it is unit tested.
import { projectOnPath } from './geo'
import type { Plan } from './planner'
import type { Story } from './story/core'
import type { Place } from './types'

export interface Cue {
  id: string
  placeId: string
  kind: 'stop' | 'passing'
  /** metres from the start of the route where the place is */
  at: number
  title: string
  text: string
}

/** start telling this many metres before reaching the place */
export const LEAD_M = 60
/** a cue more than this far behind the walker is stale (they jumped ahead) and is not told */
export const STALE_M = 120

function placeText(p: Place) {
  return [p.summary, p.then_now].filter(Boolean).join(' ')
}

export function buildCues(plan: Plan, places: Record<string, Place>, story?: Story | null): Cue[] {
  const geom = plan.route.geometry
  const seg = new Map((story?.segments ?? []).map((s) => [s.placeId, s.text]))
  const cues: Cue[] = []
  plan.stops.forEach((s, i) => {
    cues.push({
      id: `stop:${s.place.id}`, placeId: s.place.id, kind: 'stop', at: projectOnPath(s.place, geom).along,
      title: `${s.kind === 'pass' ? 'Look out for' : `Stop ${i + 1}:`} ${s.place.name}`,
      text: seg.get(s.place.id) ?? placeText(s.place),
    })
  })
  for (const id of plan.passing ?? []) {
    const p = places[id]
    if (!p) continue
    cues.push({ id: `pass:${id}`, placeId: id, kind: 'passing', at: projectOnPath(p, geom).along, title: `On your way: ${p.name}`, text: p.summary })
  }
  return cues.sort((a, b) => a.at - b.at)
}

/** The next cue that is due at `along` metres and has not been told yet (earliest first). */
export function dueCue(cues: Cue[], along: number, told: ReadonlySet<string>, lead = LEAD_M): Cue | null {
  return cues.find((c) => !told.has(c.id) && along >= c.at - lead && along <= c.at + STALE_M) ?? null
}
