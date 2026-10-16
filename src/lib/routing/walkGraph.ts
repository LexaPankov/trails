// TRAILS' own pedestrian router: A* over a walkable OpenStreetMap graph bundled with the app
// (built by scripts/build_walk_graph.mjs from an Overpass extract). Works fully offline.
import { bearing, haversine } from '../geo'
import type { LatLon } from '../types'
import { assemble } from './providers'
import type { Maneuver, RouteLeg, RoutingProvider } from './types'

export interface WalkGraphFile {
  format: 'trails-walk-graph/v1'
  source: string
  bbox: [number, number, number, number]
  /** node coordinates as integer micro-degrees: [lat0, lon0, lat1, lon1, ...] */
  coords: number[]
  /** CSR adjacency */
  offsets: number[]
  targets: number[]
  /** edge length in decimetres */
  lengths: number[]
  /** index into names (-1 = unnamed) per edge */
  nameIdx: number[]
  names: string[]
}

class MinHeap {
  private k: number[] = []
  private v: number[] = []
  get size() { return this.k.length }
  push(key: number, val: number) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key); v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]; v[i] = v[p]; i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): number {
    const k = this.k, v = this.v
    const top = v[0]
    const lk = k.pop()!, lv = v.pop()!
    if (k.length) {
      let i = 0
      const n = k.length
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && k[c + 1] < k[c]) c++
        if (k[c] >= lk) break
        k[i] = k[c]; v[i] = v[c]; i = c
      }
      k[i] = lk; v[i] = lv
    }
    return top
  }
}

export class WalkGraph {
  readonly n: number
  private lat: Float64Array
  private lon: Float64Array
  private grid = new Map<string, number[]>()
  private readonly cell = 0.002
  readonly g: WalkGraphFile
  constructor(g: WalkGraphFile) {
    this.g = g
    this.n = g.coords.length / 2
    this.lat = new Float64Array(this.n)
    this.lon = new Float64Array(this.n)
    for (let i = 0; i < this.n; i++) {
      this.lat[i] = g.coords[2 * i] / 1e6
      this.lon[i] = g.coords[2 * i + 1] / 1e6
      const key = this.key(this.lat[i], this.lon[i])
      const arr = this.grid.get(key)
      if (arr) arr.push(i)
      else this.grid.set(key, [i])
    }
  }
  private key(lat: number, lon: number) {
    return `${Math.floor(lat / this.cell)}:${Math.floor(lon / this.cell)}`
  }
  pos(i: number): LatLon { return { lat: this.lat[i], lon: this.lon[i] } }

  /** Nearest graph node with at least one edge; null if none within maxDist metres. */
  nearest(p: LatLon, maxDist = 400): { node: number; dist: number } | null {
    let best = -1, bd = Infinity
    const cy = Math.floor(p.lat / this.cell), cx = Math.floor(p.lon / this.cell)
    for (let r = 0; r <= 3 && best < 0; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dy), Math.abs(dx)) !== r) continue
        for (const i of this.grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
          if (this.g.offsets[i + 1] === this.g.offsets[i]) continue
          const d = haversine(p, this.pos(i))
          if (d < bd) { bd = d; best = i }
        }
      }
    }
    return best >= 0 && bd <= maxDist ? { node: best, dist: bd } : null
  }

  /** A* shortest path; returns node sequence + edge indices, or null if unreachable. */
  shortestPath(s: number, t: number): { nodes: number[]; edges: number[]; length_m: number } | null {
    const { offsets, targets, lengths } = this.g
    const dist = new Float64Array(this.n).fill(Infinity)
    const prevEdge = new Int32Array(this.n).fill(-1)
    const prevNode = new Int32Array(this.n).fill(-1)
    const done = new Uint8Array(this.n)
    const goal = this.pos(t)
    const h = (i: number) => haversine(this.pos(i), goal) * 10 // decimetres, admissible
    const heap = new MinHeap()
    dist[s] = 0
    heap.push(h(s), s)
    while (heap.size) {
      const u = heap.pop()
      if (done[u]) continue
      done[u] = 1
      if (u === t) break
      for (let e = offsets[u]; e < offsets[u + 1]; e++) {
        const v = targets[e]
        const nd = dist[u] + lengths[e]
        if (nd < dist[v]) {
          dist[v] = nd; prevEdge[v] = e; prevNode[v] = u
          heap.push(nd + h(v), v)
        }
      }
    }
    if (!isFinite(dist[t])) return null
    const nodes: number[] = [], edges: number[] = []
    for (let v = t; v !== -1; v = prevNode[v]) {
      nodes.push(v)
      if (prevEdge[v] >= 0) edges.push(prevEdge[v])
    }
    return { nodes: nodes.reverse(), edges: edges.reverse(), length_m: dist[t] / 10 }
  }

  /** One-to-all Dijkstra; returns metres to every node (Infinity if unreachable). */
  distancesFrom(s: number, maxM = 6000): Float64Array {
    const { offsets, targets, lengths } = this.g
    const dist = new Float64Array(this.n).fill(Infinity)
    const heap = new MinHeap()
    dist[s] = 0
    heap.push(0, s)
    const lim = maxM * 10
    while (heap.size) {
      const u = heap.pop()
      const du = dist[u]
      if (du > lim) break
      for (let e = offsets[u]; e < offsets[u + 1]; e++) {
        const v = targets[e]
        const nd = du + lengths[e]
        if (nd < dist[v]) { dist[v] = nd; heap.push(nd, v) }
      }
    }
    for (let i = 0; i < this.n; i++) dist[i] /= 10
    return dist
  }

  /** Turn a path into street-level instructions (name changes and turns > 30 degrees). */
  maneuvers(nodes: number[], edges: number[]): Maneuver[] {
    const out: Maneuver[] = []
    const name = (e: number) => (this.g.nameIdx[e] >= 0 ? this.g.names[this.g.nameIdx[e]] : '')
    let cur = { name: name(edges[0] ?? -1), begin: 0, dist: 0 }
    const flush = (instruction: string) => out.push({ instruction, distance_m: cur.dist, begin: cur.begin })
    let first = true
    let lastInstr = cur.name ? `Head out on ${cur.name}` : 'Head out'
    for (let i = 0; i < edges.length; i++) {
      const nm = name(edges[i])
      if (i > 0) {
        const b1 = bearing(this.pos(nodes[i - 1]), this.pos(nodes[i]))
        const b2 = bearing(this.pos(nodes[i]), this.pos(nodes[i + 1]))
        const turn = ((b2 - b1 + 540) % 360) - 180
        if ((nm !== cur.name && (nm || Math.abs(turn) > 30)) || Math.abs(turn) > 60) {
          flush(lastInstr)
          first = false
          const dir = Math.abs(turn) < 30 ? 'Continue' : turn > 0 ? (turn > 120 ? 'Turn sharply right' : 'Turn right') : turn < -120 ? 'Turn sharply left' : 'Turn left'
          lastInstr = nm ? `${dir} onto ${nm}` : dir
          cur = { name: nm, begin: i, dist: 0 }
        }
      }
      cur.dist += this.g.lengths[edges[i]] / 10
    }
    flush(first && !edges.length ? 'You are already at the stop' : lastInstr)
    out.push({ instruction: 'Arrive at the stop', distance_m: 0, begin: nodes.length - 1 })
    return out
  }
}

export function walkGraphProvider(graph: WalkGraph): RoutingProvider {
  return {
    id: 'trails-local',
    label: 'TRAILS router on bundled OpenStreetMap data',
    quality: 'local',
    async route(waypoints, { speedKmh }) {
      const legs: RouteLeg[] = []
      for (let i = 1; i < waypoints.length; i++) {
        const a = graph.nearest(waypoints[i - 1]), b = graph.nearest(waypoints[i])
        if (!a || !b) throw new Error('waypoint outside the bundled street network')
        const path = graph.shortestPath(a.node, b.node)
        if (!path) throw new Error('no walkable connection in the bundled street network')
        const geometry: [number, number][] = [
          [waypoints[i - 1].lat, waypoints[i - 1].lon],
          ...path.nodes.map((n) => { const p = graph.pos(n); return [p.lat, p.lon] as [number, number] }),
          [waypoints[i].lat, waypoints[i].lon],
        ]
        const d = path.length_m + a.dist + b.dist
        const mans = graph.maneuvers(path.nodes, path.edges).map((m) => ({ ...m, begin: m.begin + 1 }))
        legs.push({ distance_m: d, duration_s: d / (speedKmh / 3.6), geometry, maneuvers: mans })
      }
      return assemble('trails-local', 'local', legs)
    },
  }
}

let graphPromise: Promise<WalkGraph | null> | null = null
export function loadWalkGraph(url = `${import.meta.env?.BASE_URL ?? '/'}data/walk_graph.json`): Promise<WalkGraph | null> {
  if (!graphPromise) {
    graphPromise = fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: WalkGraphFile | null) => (j && j.format === 'trails-walk-graph/v1' ? new WalkGraph(j) : null))
      .catch(() => null)
  }
  return graphPromise
}
