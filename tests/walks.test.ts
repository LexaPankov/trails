import { describe, expect, it } from 'vitest'
import { PLACE_BY_ID } from '../src/lib/data'
import type { Scorer } from '../src/lib/model/mlp'
import { planFromStops } from '../src/lib/planner'
import { defaultProfile } from '../src/lib/profile'
import { decodeWalk, encodeWalk, requestFromSpec, sameWalk, type WalkSpec } from '../src/lib/walks'

const walk: WalkSpec = {
  v: 1,
  start: { lat: 41.8986, lon: 12.4769, label: 'Pantheon', placeId: 'pantheon' },
  end: { lat: 41.8902, lon: 12.4922, label: 'Colosseum · Piazza del Colosseo, è', placeId: 'colosseum' },
  budgetMin: 75,
  mode: 'discovery',
  stops: [{ id: 'temple-of-hadrian', kind: 'visit' }, { id: 'trajans-column', kind: 'pass' }],
}

describe('saved and shared walks', () => {
  it('a shared link round-trips, including non-ASCII labels', () => {
    const code = encodeWalk(walk)
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/) // safe inside a URL hash
    const back = decodeWalk(code)!
    expect(back).toEqual(walk)
    expect(sameWalk(back, walk)).toBe(true)
  })

  it('rejects damaged or hostile links instead of throwing', () => {
    expect(decodeWalk('not-base64!!')).toBeNull()
    expect(decodeWalk(encodeWalk({ ...walk, budgetMin: -5 }))).toBeNull()
    expect(decodeWalk(encodeWalk({ ...walk, mode: 'teleport' as never }))).toBeNull()
    expect(decodeWalk(encodeWalk({ ...walk, start: { lat: NaN, lon: 1, label: 'x' } }))).toBeNull()
    const odd = decodeWalk(encodeWalk({ ...walk, stops: [...walk.stops, { id: 7, kind: 'visit' } as never] }))!
    expect(odd.stops).toEqual(walk.stops) // malformed stops are dropped, the rest kept
  })

  it('reopens the exact walk: same stops, same order, same kinds', async () => {
    expect(PLACE_BY_ID['temple-of-hadrian'] && PLACE_BY_ID['trajans-column']).toBeTruthy()
    const scorer = { source: 'rule', info: 'test', score: () => 0.5 } as unknown as Scorer
    const plan = await planFromStops(requestFromSpec(walk, { routing: 'estimate' }), walk.stops, defaultProfile(), scorer)
    expect(plan.stops.map((s) => [s.place.id, s.kind])).toEqual([['temple-of-hadrian', 'visit'], ['trajans-column', 'pass']])
    expect(plan.route.legs.length).toBe(3)
    expect(plan.visitMin).toBe(PLACE_BY_ID['temple-of-hadrian'].visit_minutes + Math.min(2, PLACE_BY_ID['trajans-column'].visit_minutes))
  })

  it('skips stops that no longer exist in the dataset', async () => {
    const scorer = { source: 'rule', info: 'test', score: () => 0.5 } as unknown as Scorer
    const plan = await planFromStops(requestFromSpec(walk, { routing: 'estimate' }), [{ id: 'gone-place', kind: 'visit' }, ...walk.stops], defaultProfile(), scorer)
    expect(plan.stops.length).toBe(2)
  })
})
