import { describe, expect, it } from 'vitest'
import { PLACE_BY_ID, PLACES } from '../src/lib/data'
import { inRome, parsePhoton, searchPlaces } from '../src/lib/geocode'
import { optimizeRoute, type Candidate } from '../src/lib/optimizer'
import { placesAlong } from '../src/lib/planner'
import { haversine } from '../src/lib/geo'

const TERMINI = { lat: 41.9009, lon: 12.5016 }
const TRILUSSA = { lat: 41.8917, lon: 12.4703 }

function plan(mode: 'fastest' | 'discovery' | 'history', budgetMin: number, personal = 0.9) {
  const cands: Candidate[] = PLACES.map((p) => ({ place: p, personal }))
  const nodes = [TERMINI, TRILUSSA, ...cands.map((c) => c.place)]
  return optimizeRoute({ candidates: cands, budgetMin, speedKmh: 4.5, mode,
    walkMeters: (a, b) => haversine(nodes[a], nodes[b]) * 1.35 })
}

describe('any address to any address', () => {
  it('finds TRAILS places by partial, accent-free names', () => {
    expect(searchPlaces('trevi')[0].placeId).toBe('trevi-fountain')
    expect(searchPlaces('sant ivo').some((r) => r.placeId === 'santivo-alla-sapienza')).toBe(true)
    expect(searchPlaces('x')).toEqual([])
  })
  it('parses Photon GeoJSON and drops results outside Rome', () => {
    const r = parsePhoton({ features: [
      { geometry: { coordinates: [12.4823, 41.9009] }, properties: { name: 'Hotel Example', street: 'Via del Corso', housenumber: '1', city: 'Rome' } },
      { geometry: { coordinates: [9.19, 45.46] }, properties: { name: 'Milan thing', city: 'Milan' } },
      { geometry: { coordinates: [12.47, 41.89] }, properties: { street: 'Via della Lungaretta', housenumber: '10', district: 'Trastevere' } },
    ] })
    expect(r.map((x) => x.label)).toEqual(['Hotel Example', 'Via della Lungaretta 10'])
    expect(r[0].detail).toContain('Via del Corso 1')
    expect(inRome(TERMINI)).toBe(true)
  })
  it('plans between two arbitrary points, within budget, in every mode', () => {
    for (const mode of ['fastest', 'discovery', 'history'] as const) {
      const r = plan(mode, 75)
      expect(r.reachable).toBe(true)
      expect(r.totalMin).toBeLessThanOrEqual(75 + 1e-6)
      expect(r.stops.length).toBeGreaterThan(0)
    }
  })
  it('with little spare time it bends the path past culture instead of stopping', () => {
    const r = plan('fastest', 65)
    expect(r.stops.length).toBeGreaterThan(0)
    expect(r.stops.every((s) => s.kind === 'pass' && s.visitMin <= 2)).toBe(true)
  })
  it('lists places along a path, in walking order', () => {
    const a = PLACE_BY_ID['pantheon'], b = PLACE_BY_ID['trevi-fountain']
    const geom: [number, number][] = [[a.lat, a.lon], [b.lat, b.lon]]
    const ids = placesAlong(geom, new Set(['pantheon', 'trevi-fountain']), 60)
    for (const id of ids) {
      const p = PLACE_BY_ID[id]
      expect(Math.min(haversine(p, a), haversine(p, b))).toBeLessThan(haversine(a, b))
    }
    expect(placesAlong([[a.lat, a.lon]], new Set())).toEqual([])
  })
})
