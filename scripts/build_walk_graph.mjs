// Build TRAILS' compact pedestrian graph from an Overpass extract (data/open/osm_walk.json),
// keeping only the largest connected component. Output: public/data/walk_graph.json
//   node scripts/build_walk_graph.mjs [data/open/osm_walk.json]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2] ?? 'data/open/osm_walk.json'
const osm = JSON.parse(readFileSync(src, 'utf8'))
const nodes = new Map()
for (const e of osm.elements) if (e.type === 'node') nodes.set(e.id, [e.lat, e.lon])

const R = 6371000
const hav = (a, b) => {
  const p1 = (a[0] * Math.PI) / 180, p2 = (b[0] * Math.PI) / 180
  const dp = p2 - p1, dl = ((b[1] - a[1]) * Math.PI) / 180
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2))
}

const idx = new Map()
const coords = []
const adj = []
const names = []
const nameIdx = new Map()
const id = (osmId) => {
  let i = idx.get(osmId)
  if (i === undefined) { i = coords.length; idx.set(osmId, i); coords.push(nodes.get(osmId)); adj.push([]) }
  return i
}
let ways = 0
for (const w of osm.elements) {
  if (w.type !== 'way' || !w.nodes) continue
  const t = w.tags ?? {}
  if (t.foot === 'no' || t.access === 'private' || t.access === 'no' || t.area === 'yes') continue
  const nm = t.name ?? (t.highway === 'steps' ? 'steps' : '')
  let ni = -1
  if (nm) { if (!nameIdx.has(nm)) { nameIdx.set(nm, names.length); names.push(nm) } ni = nameIdx.get(nm) }
  for (let k = 1; k < w.nodes.length; k++) {
    if (!nodes.has(w.nodes[k - 1]) || !nodes.has(w.nodes[k])) continue
    const a = id(w.nodes[k - 1]), b = id(w.nodes[k])
    const len = Math.max(1, Math.round(hav(coords[a], coords[b]) * 10))
    adj[a].push([b, len, ni]); adj[b].push([a, len, ni])
  }
  ways++
}

// largest connected component
const comp = new Int32Array(coords.length).fill(-1)
let best = -1, bestSize = 0
for (let s = 0, c = 0; s < coords.length; s++) {
  if (comp[s] >= 0) continue
  let size = 0
  const stack = [s]; comp[s] = c
  while (stack.length) { const u = stack.pop(); size++; for (const [v] of adj[u]) if (comp[v] < 0) { comp[v] = c; stack.push(v) } }
  if (size > bestSize) { bestSize = size; best = c }
  c++
}
const remap = new Int32Array(coords.length).fill(-1)
const out = { format: 'trails-walk-graph/v1', source: `OpenStreetMap contributors (ODbL), Overpass extract ${src}`, bbox: null, coords: [], offsets: [0], targets: [], lengths: [], nameIdx: [], names }
for (let i = 0; i < coords.length; i++) if (comp[i] === best) { remap[i] = out.coords.length / 2; out.coords.push(Math.round(coords[i][0] * 1e6), Math.round(coords[i][1] * 1e6)) }
for (let i = 0; i < coords.length; i++) {
  if (remap[i] < 0) continue
  for (const [v, len, ni] of adj[i]) { out.targets.push(remap[v]); out.lengths.push(len); out.nameIdx.push(ni) }
  out.offsets.push(out.targets.length)
}
const lats = out.coords.filter((_, i) => i % 2 === 0), lons = out.coords.filter((_, i) => i % 2 === 1)
out.bbox = [Math.min(...lats) / 1e6, Math.min(...lons) / 1e6, Math.max(...lats) / 1e6, Math.max(...lons) / 1e6]
mkdirSync('public/data', { recursive: true })
writeFileSync('public/data/walk_graph.json', JSON.stringify(out))
console.log(`[TRAILS] ${ways} ways -> ${out.coords.length / 2} nodes, ${out.targets.length} directed edges (largest component of ${coords.length} nodes), ${names.length} street names`)
