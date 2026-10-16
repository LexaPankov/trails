import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLACES, PLACE_BY_ID } from '../src/lib/data'
import { decodePolyline, haversine } from '../src/lib/geo'
import { placeAxes, zeroAffinity } from '../src/lib/model/features'
import { fallbackScorer, neuralScorer, PreferenceModel, type MLPWeights } from '../src/lib/model/mlp'
import { optimizeRoute, type Candidate } from '../src/lib/optimizer'
import { planRoute, scorePlaces } from '../src/lib/planner'
import { applySignal, defaultProfile, recordSignal, type Profile } from '../src/lib/profile'
import { estimateProvider } from '../src/lib/routing/providers'
import type { Interest, RouteMode } from '../src/lib/types'

const weights = JSON.parse(readFileSync('public/models/preference_mlp.json', 'utf8')) as MLPWeights
const model = new PreferenceModel(weights)
const scorer = neuralScorer(model)

function profileWith(interests: Interest[]): Profile {
  return { ...defaultProfile(), interests, affinity: zeroAffinity() }
}

describe('preference model', () => {
  it('matches PyTorch outputs on held-out fixtures (parity)', () => {
    const fx = JSON.parse(readFileSync('tests/fixtures/model_parity.json', 'utf8')) as { inputs: number[][]; outputs: number[] }
    fx.inputs.forEach((x, i) => expect(Math.abs(model.predictVector(x) - fx.outputs[i])).toBeLessThan(1e-4))
  })
  it('produces valid probabilities for every place', () => {
    const s = scorePlaces(scorer, profileWith(['baroque']))
    for (const v of Object.values(s)) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1)
  })
  it('ranks places differently for different interests', () => {
    const anc = scorePlaces(scorer, profileWith(['ancient', 'archaeology']))
    const bar = scorePlaces(scorer, profileWith(['baroque', 'art_architecture']))
    expect(anc['roman-forum']).toBeGreaterThan(bar['roman-forum'])
    expect(bar['santivo-alla-sapienza']).toBeGreaterThan(anc['santivo-alla-sapienza'])
  })
  it('rejects weights with a different schema', () => {
    expect(() => new PreferenceModel({ ...weights, schema_version: 'other' })).toThrow()
  })
  it('fallback rule is deterministic and bounded', () => {
    const p = PLACE_BY_ID['pantheon']
    const a = fallbackScorer.score(['ancient'], zeroAffinity(), p)
    expect(a).toBe(fallbackScorer.score(['ancient'], zeroAffinity(), p))
    expect(a).toBeGreaterThan(0); expect(a).toBeLessThan(1)
  })
})

describe('preference learning', () => {
  it('liking a place raises affinity on its axes only', () => {
    const p = PLACE_BY_ID['santivo-alla-sapienza'] // baroque, architecture/religion, hidden gem
    const a = applySignal(zeroAffinity(), placeAxes(p), 'like')
    expect(a.baroque).toBeGreaterThan(0)
    expect(a.hidden_gems).toBeGreaterThan(0)
    expect(a.ancient).toBe(0)
  })
  it('skips are much weaker than dislikes', () => {
    const p = PLACE_BY_ID['colosseum']
    const s = applySignal(zeroAffinity(), placeAxes(p), 'skip')
    const d = applySignal(zeroAffinity(), placeAxes(p), 'dislike')
    expect(Math.abs(s.ancient)).toBeLessThan(Math.abs(d.ancient) / 5)
  })
  it('interactions change subsequent model scores', () => {
    let prof = profileWith(['ancient'])
    const before = scorePlaces(scorer, prof)['santivo-alla-sapienza']
    for (const id of ['santivo-alla-sapienza', 'san-carlo-alle-quattro-fontane', 'sant-andrea-al-quirinale', 'santagnese-in-agone'])
      prof = recordSignal(prof, PLACE_BY_ID[id], 'like')
    expect(scorePlaces(scorer, prof)['santivo-alla-sapienza']).toBeGreaterThan(before)
  })
})

describe('dataset', () => {
  it('has unique ids, valid coordinates and sources', () => {
    const ids = new Set(PLACES.map((p) => p.id))
    expect(ids.size).toBe(PLACES.length)
    for (const p of PLACES) {
      expect(p.lat).toBeGreaterThan(41.86); expect(p.lat).toBeLessThan(41.92)
      expect(p.lon).toBeGreaterThan(12.44); expect(p.lon).toBeLessThan(12.51)
      expect(p.sources.length).toBeGreaterThan(0)
      p.sources.forEach((s) => expect(s.url).toMatch(/^https:\/\//))
      p.related.forEach((r) => expect(ids.has(r)).toBe(true))
    }
  })
})

function plan(mode: RouteMode, interests: Interest[], budget: number) {
  const prof = profileWith(interests)
  const scores = scorePlaces(scorer, prof)
  const s = PLACE_BY_ID['pantheon'], e = PLACE_BY_ID['colosseum']
  const cands: Candidate[] = PLACES.filter((p) => p !== s && p !== e).map((p) => ({ place: p, personal: scores[p.id] }))
  const nodes = [s, e, ...cands.map((c) => c.place)]
  return optimizeRoute({
    candidates: cands, budgetMin: budget, speedKmh: 4.5, mode,
    walkMeters: (a, b) => haversine(nodes[a], nodes[b]) * 1.35,
  })
}

describe('route optimizer', () => {
  it('respects the time budget in every mode', () => {
    for (const mode of ['fastest', 'discovery', 'history'] as RouteMode[])
      for (const b of [25, 45, 90]) {
        const r = plan(mode, ['ancient', 'archaeology'], b)
        if (r.reachable) expect(r.totalMin).toBeLessThanOrEqual(b + 1e-6)
        else expect(r.stops.length).toBe(0)
      }
  })
  it('is deterministic', () => {
    const a = plan('discovery', ['baroque'], 60).stops.map((s) => s.place.id)
    const b = plan('discovery', ['baroque'], 60).stops.map((s) => s.place.id)
    expect(a).toEqual(b)
  })
  it('more time and history mode give at least as many stops as fastest', () => {
    const f = plan('fastest', ['ancient'], 45).stops.length
    const h = plan('history', ['ancient'], 45).stops.length
    expect(f).toBeLessThanOrEqual(2)
    expect(h).toBeGreaterThanOrEqual(f)
  })
  it('different interests change the selected stops', () => {
    const a = plan('discovery', ['ancient', 'archaeology'], 60).stops.map((s) => s.place.id)
    const b = plan('discovery', ['renaissance', 'baroque', 'art_architecture'], 60).stops.map((s) => s.place.id)
    expect(a).not.toEqual(b)
  })
  it('reports unreachable destinations instead of inventing stops', () => {
    const r = plan('history', ['ancient'], 5)
    expect(r.reachable).toBe(false)
    expect(r.stops.length).toBe(0)
  })
})

describe('routing + planner (offline)', () => {
  it('estimate provider is labelled as an estimate', async () => {
    const r = await estimateProvider.route([PLACE_BY_ID['pantheon'], PLACE_BY_ID['colosseum']], { speedKmh: 4.5 })
    expect(r.quality).toBe('estimate')
    expect(r.note).toMatch(/Not a verified walking route/)
  })
  it('plans end-to-end with no network and stays within budget', async () => {
    const prof = profileWith(['ancient', 'archaeology', 'hidden_gems'])
    const p = await planRoute({
      start: { ...PLACE_BY_ID['pantheon'], label: 'Pantheon', placeId: 'pantheon' },
      end: { ...PLACE_BY_ID['colosseum'], label: 'Colosseum', placeId: 'colosseum' },
      budgetMin: 45, mode: 'discovery', offline: true,
    }, prof, scorer)
    expect(p.route.quality).toBe('estimate')
    expect(p.totalMin).toBeLessThanOrEqual(45.5)
    expect(p.stops.length).toBeGreaterThan(0)
    expect(p.scorer.source).toBe('neural-network')
  })
  it('decodes polyline6', () => {
    // two points: (38.5, -120.2), (40.7, -120.95) encoded at precision 5 -> "_p~iF~ps|U_ulLnnqC"
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC', 5)
    expect(pts[0][0]).toBeCloseTo(38.5); expect(pts[1][1]).toBeCloseTo(-120.95)
  })
})

describe('valhalla adapter', () => {
  it('parses a real recorded Valhalla pedestrian response', async () => {
    const { valhallaProvider } = await import('../src/lib/routing/providers')
    const samples = JSON.parse(readFileSync('tests/fixtures/valhalla_samples.json', 'utf8'))
    const real = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify(samples['pantheon__colosseum']))) as typeof fetch
    try {
      const r = await valhallaProvider.route([PLACE_BY_ID['pantheon'], PLACE_BY_ID['colosseum']], { speedKmh: 4.5 })
      expect(r.quality).toBe('live')
      expect(r.geometry.length).toBeGreaterThan(10)
      expect(r.distance_m).toBeGreaterThan(1000); expect(r.distance_m).toBeLessThan(3500)
      expect(r.legs[0].maneuvers.length).toBeGreaterThan(2)
      const [lat, lon] = r.geometry[0]
      expect(haversine({ lat, lon }, PLACE_BY_ID['pantheon'])).toBeLessThan(150)
    } finally {
      globalThis.fetch = real
    }
  })
})

describe('TRAILS local walk-graph router', () => {
  it('finds the shortest path on a small street grid and produces turn instructions', async () => {
    const { WalkGraph, walkGraphProvider } = await import('../src/lib/routing/walkGraph')
    // 3x3 grid, ~111 m spacing; street names per row/column
    const pts: [number, number][] = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) pts.push([41.9 + r * 0.001, 12.47 + c * 0.00134])
    const adj: [number, number, number][][] = pts.map(() => [])
    const names = ['Via A', 'Via B', 'Via C', 'Via X', 'Via Y', 'Via Z']
    const link = (a: number, b: number, n: number) => {
      const d = Math.round(haversine({ lat: pts[a][0], lon: pts[a][1] }, { lat: pts[b][0], lon: pts[b][1] }) * 10)
      adj[a].push([b, d, n]); adj[b].push([a, d, n])
    }
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) link(r * 3 + c, r * 3 + c + 1, r)
    for (let c = 0; c < 3; c++) for (let r = 0; r < 2; r++) link(r * 3 + c, (r + 1) * 3 + c, 3 + c)
    const file = { format: 'trails-walk-graph/v1' as const, source: 'test', bbox: [0, 0, 0, 0] as [number, number, number, number],
      coords: pts.flatMap(([a, b]) => [Math.round(a * 1e6), Math.round(b * 1e6)]), offsets: [0], targets: [] as number[], lengths: [] as number[], nameIdx: [] as number[], names }
    adj.forEach((edges) => { edges.forEach(([t, l, n]) => { file.targets.push(t); file.lengths.push(l); file.nameIdx.push(n) }); file.offsets.push(file.targets.length) })
    const g = new WalkGraph(file)
    const path = g.shortestPath(0, 8)!
    expect(path.nodes.length).toBe(5) // Manhattan distance 4 edges
    expect(path.length_m).toBeGreaterThan(420); expect(path.length_m).toBeLessThan(460)
    const r = await walkGraphProvider(g).route([{ lat: 41.9, lon: 12.47 }, { lat: 41.902, lon: 12.47268 }], { speedKmh: 4.5 })
    expect(r.quality).toBe('local')
    expect(r.legs[0].maneuvers.some((m) => /Turn (left|right)/.test(m.instruction))).toBe(true)
    expect(g.distancesFrom(0)[8]).toBeCloseTo(path.length_m, 0)
  })
})
