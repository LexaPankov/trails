import { describe, expect, it } from 'vitest'
import { PLACE_BY_ID } from '../src/lib/data'
import { buildCues, dueCue, LEAD_M } from '../src/lib/guide'
import { zeroAffinity } from '../src/lib/model/features'
import type { Scorer } from '../src/lib/model/mlp'
import { planRoute } from '../src/lib/planner'
import { defaultProfile } from '../src/lib/profile'
import { describeShift, tasteShift } from '../src/lib/taste'
import { tradeoff } from '../src/lib/tradeoff'

const scorer = { source: 'neural-network', info: 'test stub', score: () => 0.8 } as unknown as Scorer
const req = {
  start: { lat: 41.9009, lon: 12.5016, label: 'Termini' }, end: { lat: 41.8917, lon: 12.4703, label: 'Piazza Trilussa' },
  budgetMin: 90, mode: 'discovery' as const, routing: 'estimate' as const, offline: true,
}

describe('trade-off against the fastest walk', () => {
  it('reports extra minutes and the culture gained, from the plan itself', async () => {
    const plan = await planRoute(req, defaultProfile(), scorer)
    const t = tradeoff(plan)
    expect(t.fastestMin).toBeCloseTo(plan.directWalkMin)
    expect(t.extraMin).toBeCloseTo(Math.max(0, plan.totalMin - plan.directWalkMin))
    expect(t.trailsPlaces.length).toBe(plan.stops.length + plan.passing.length)
    expect(plan.stops.length).toBeGreaterThan(0)
    expect(t.stopsStrong).toBe(plan.stops.length)
    expect(t.trailsStrong).toBe(t.trailsPlaces.length) // stub scores everything 0.8
  })
})

describe('walk-mode audio guide', () => {
  it('places one cue per stop and passing place, in walking order, and tells each once', async () => {
    const plan = await planRoute(req, defaultProfile(), scorer)
    const cues = buildCues(plan, PLACE_BY_ID)
    expect(cues.length).toBe(plan.stops.length + plan.passing.length)
    expect(cues.map((c) => c.at)).toEqual([...cues.map((c) => c.at)].sort((a, b) => a - b))
    const first = cues[0]
    expect(dueCue(cues, first.at - LEAD_M - 5, new Set())).toBeNull()
    expect(dueCue(cues, first.at - LEAD_M + 5, new Set())?.id).toBe(first.id)
    expect(dueCue(cues, first.at, new Set([first.id]))?.id).not.toBe(first.id)
    // jumping far past a cue does not replay stale ones
    expect(dueCue(cues, first.at + 10_000, new Set())?.id ?? null).not.toBe(first.id)
  })
  it('uses the written story for a stop when there is one', async () => {
    const plan = await planRoute(req, defaultProfile(), scorer)
    const stop = plan.stops[0].place.id
    const story = { title: '', intro: '', outro: '', sources: [], generator: { kind: 'offline' as const },
      segments: [{ placeId: stop, text: 'Story text for the first stop.', cite: [] }] }
    const cue = buildCues(plan, PLACE_BY_ID, story).find((c) => c.placeId === stop)!
    expect(cue.text).toBe('Story text for the first stop.')
  })
})

describe('learning from thumbs up and down', () => {
  it('moves the taste profile toward a liked place and away from a disliked one', () => {
    const p = PLACE_BY_ID['pantheon']
    const up = tasteShift(zeroAffinity(), p, 'like')
    const down = tasteShift(zeroAffinity(), p, 'dislike')
    expect(up.length).toBeGreaterThan(0)
    expect(up.every((x) => x.delta > 0)).toBe(true)
    expect(down.every((x) => x.delta < 0)).toBe(true)
    expect(describeShift(up)).toContain('Ancient history ↑')
  })
})
