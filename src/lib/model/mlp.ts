// Browser/Node inference for the TRAILS preference MLP (weights exported by ml/train.py).
// Pure TypeScript dense layers: ~1.5k parameters, so no wasm runtime is needed.
import type { Interest, Place } from '../types'
import { INPUT_SIZE, INTERESTS, SCHEMA_VERSION, placeAxes, placeVector, userVector, type Affinity } from './features'

export interface MLPWeights {
  schema_version: string
  format: string
  trained_with?: string
  test_auc_synthetic?: number
  layers: { W: number[][]; b: number[] }[]
}

export class PreferenceModel {
  readonly weights: MLPWeights
  constructor(weights: MLPWeights) {
    if (weights.schema_version !== SCHEMA_VERSION) throw new Error(`schema mismatch: ${weights.schema_version}`)
    if (weights.layers[0]?.W[0]?.length !== INPUT_SIZE) throw new Error('input size mismatch')
    this.weights = weights
  }

  /** Relevance probability in [0, 1] for one encoded (user, place) feature vector. */
  predictVector(x: number[]): number {
    let h = x
    const L = this.weights.layers
    for (let li = 0; li < L.length; li++) {
      const { W, b } = L[li]
      const out = new Array<number>(W.length)
      for (let i = 0; i < W.length; i++) {
        let s = b[i]
        const row = W[i]
        for (let j = 0; j < row.length; j++) s += row[j] * h[j]
        out[i] = li < L.length - 1 ? Math.max(0, s) : s
      }
      h = out
    }
    return 1 / (1 + Math.exp(-h[0]))
  }
}

export type ScoreSource = 'neural-network' | 'fallback-rule'

export interface Scorer {
  source: ScoreSource
  info: string
  score(interests: Interest[], affinity: Affinity, place: Place): number
}

export function neuralScorer(model: PreferenceModel): Scorer {
  return {
    source: 'neural-network',
    info: `Preference MLP (${model.weights.trained_with ?? 'trained offline'})`,
    score: (interests, affinity, place) =>
      model.predictVector([...userVector(interests, affinity), ...placeVector(place)]),
  }
}

/**
 * Deterministic fallback used ONLY if the trained model cannot be loaded.
 * Same inputs, simple transparent rule; the UI labels results produced with it.
 */
export const fallbackScorer: Scorer = {
  source: 'fallback-rule',
  info: 'Rule-based fallback (model unavailable)',
  score(interests, affinity, place) {
    const ax = placeAxes(place)
    const n = Math.sqrt(Math.max(1, ax.reduce((a, b) => a + b, 0)))
    let s = 0
    INTERESTS.forEach((k, i) => {
      s += ax[i] * ((interests.includes(k) ? 1 : 0) + 0.5 * (affinity[k] ?? 0))
    })
    const z = 1.6 * (s / n) + 0.8 * ((place.significance - 1) / 4) - 0.8
    return 1 / (1 + Math.exp(-z))
  },
}

let cached: Promise<Scorer> | null = null

export function loadScorer(url = `${import.meta.env?.BASE_URL ?? '/'}models/preference_mlp.json`): Promise<Scorer> {
  if (!cached) {
    cached = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((w: MLPWeights) => neuralScorer(new PreferenceModel(w)))
      .catch((e) => {
        console.warn('[TRAILS] preference model unavailable, using fallback rule:', e)
        return fallbackScorer
      })
  }
  return cached
}
