// Landmark recognition by visual similarity: embed the camera frame (whole frame + crops),
// compare with embeddings of licensed reference photos of each supported landmark, and accept
// a match only above a calibrated similarity threshold and margin. Otherwise: "unknown".
import { haversine } from '../geo'
import type { LatLon } from '../types'
import { PLACE_BY_ID } from '../data'

export interface RefEntry { placeId: string; file: string; vec: Float32Array }

export interface ReferenceIndexFile {
  format: 'trails-vision-index/v1'
  model: string
  dim: number
  created: string
  /** calibrated on reference photos only (leave-one-out) — see scripts/vision_eval.mjs */
  threshold: number
  margin: number
  entries: { p: string; f: string; q: string }[] // q = base64 int8 of the L2-normalised vector * 127
}

export interface Region { x: number; y: number; w: number; h: number } // fractions of the frame

export interface Candidate { placeId: string; score: number }

export interface Recognition {
  status: 'recognized' | 'uncertain' | 'unknown'
  best: Candidate | null
  candidates: Candidate[]
  region: Region
  ms: number
}

export function encodeVec(v: Float32Array): string {
  const b = new Int8Array(v.length)
  for (let i = 0; i < v.length; i++) b[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)))
  let s = ''
  const u = new Uint8Array(b.buffer)
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
  return btoa(s)
}

export function decodeVec(q: string): Float32Array {
  const s = atob(q)
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i)
  const b = new Int8Array(u.buffer)
  const v = new Float32Array(b.length)
  let n = 0
  for (let i = 0; i < b.length; i++) { v[i] = b[i] / 127; n += v[i] * v[i] }
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Crops evaluated per frame: whole frame, centre, and four overlapping quadrants. */
export const REGIONS: Region[] = [
  { x: 0, y: 0, w: 1, h: 1 },
  { x: 0.15, y: 0.15, w: 0.7, h: 0.7 },
  { x: 0, y: 0, w: 0.65, h: 0.65 },
  { x: 0.35, y: 0, w: 0.65, h: 0.65 },
  { x: 0, y: 0.35, w: 0.65, h: 0.65 },
  { x: 0.35, y: 0.35, w: 0.65, h: 0.65 },
]

/** Per-landmark score for one query vector: mean of the top-2 reference similarities. */
export function landmarkScores(q: Float32Array, refs: RefEntry[], allowed?: Set<string>): Map<string, number> {
  const per = new Map<string, number[]>()
  for (const r of refs) {
    if (allowed && !allowed.has(r.placeId)) continue
    const s = dot(q, r.vec)
    const arr = per.get(r.placeId)
    if (arr) arr.push(s)
    else per.set(r.placeId, [s])
  }
  const out = new Map<string, number>()
  for (const [k, arr] of per) {
    arr.sort((a, b) => b - a)
    out.set(k, arr.length > 1 ? (arr[0] + arr[1]) / 2 : arr[0])
  }
  return out
}

export function decide(scores: Map<string, number>, threshold: number, margin: number): { status: Recognition['status']; ranked: Candidate[] } {
  const ranked = [...scores.entries()].map(([placeId, score]) => ({ placeId, score })).sort((a, b) => b.score - a.score)
  const b = ranked[0], s = ranked[1]
  if (!b || b.score < threshold - 0.06) return { status: 'unknown', ranked }
  if (b.score < threshold || (s && b.score - s.score < margin)) return { status: 'uncertain', ranked }
  return { status: 'recognized', ranked }
}

export function allowedNear(refs: RefEntry[], at: LatLon | null, radiusM: number): Set<string> | undefined {
  if (!at) return undefined
  const ids = new Set(refs.map((r) => r.placeId))
  return new Set([...ids].filter((id) => { const p = PLACE_BY_ID[id]; return p && haversine(at, p) <= radiusM }))
}

export class Recognizer {
  refs: RefEntry[]
  threshold: number
  margin: number
  model: string
  private canvas = document.createElement('canvas')
  private embedFn: (c: HTMLCanvasElement) => Float32Array
  constructor(index: ReferenceIndexFile, embedFn: (c: HTMLCanvasElement) => Float32Array) {
    this.embedFn = embedFn
    this.refs = index.entries.map((e) => ({ placeId: e.p, file: e.f, vec: decodeVec(e.q) }))
    this.threshold = index.threshold
    this.margin = index.margin
    this.model = index.model
  }

  get supported(): string[] { return [...new Set(this.refs.map((r) => r.placeId))] }

  /** Recognise from any drawable source (video frame, image). */
  recognize(src: CanvasImageSource, w: number, h: number, opts: { near?: LatLon | null; radiusM?: number; regions?: Region[] } = {}): Recognition {
    const t0 = performance.now()
    const allowed = allowedNear(this.refs, opts.near ?? null, opts.radiusM ?? 2000)
    let bestRegion = REGIONS[0]
    let agg = new Map<string, number>()
    let bestScore = -1
    for (const r of opts.regions ?? REGIONS) {
      const size = 256
      const cw = Math.round(w * r.w), ch = Math.round(h * r.h)
      const s = size / Math.max(cw, ch)
      this.canvas.width = Math.max(1, Math.round(cw * s)); this.canvas.height = Math.max(1, Math.round(ch * s))
      const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(src, w * r.x, h * r.y, cw, ch, 0, 0, this.canvas.width, this.canvas.height)
      const sc = landmarkScores(this.embedFn(this.canvas), this.refs, allowed)
      for (const [k, v] of sc) agg.set(k, Math.max(agg.get(k) ?? -1, v))
      const top = Math.max(...sc.values())
      if (top > bestScore) { bestScore = top; bestRegion = r }
    }
    if (!agg.size) agg = new Map()
    const { status, ranked } = decide(agg, this.threshold, this.margin)
    return { status, best: ranked[0] ?? null, candidates: ranked.slice(0, 3), region: bestRegion, ms: performance.now() - t0 }
  }
}

let indexP: Promise<ReferenceIndexFile> | null = null
export function loadReferenceIndex(): Promise<ReferenceIndexFile> {
  if (!indexP) {
    indexP = fetch(`${import.meta.env.BASE_URL}vision/reference_index.json`).then((r) => {
      if (!r.ok) throw new Error(`reference index HTTP ${r.status}`)
      return r.json()
    })
    indexP.catch(() => { indexP = null })
  }
  return indexP
}
