// Feature encoding for schema trails-pref-v1 — mirrors ml/features.py exactly.
import type { Interest, Place } from '../types'

export const SCHEMA_VERSION = 'trails-pref-v1'
export const INTERESTS: Interest[] = [
  'ancient', 'medieval', 'renaissance', 'baroque', 'modern', 'archaeology', 'art_architecture', 'hidden_gems',
]
export const PERIODS = ['ancient', 'medieval', 'renaissance', 'baroque', 'modern'] as const
export const THEMES = ['archaeology', 'architecture', 'art', 'religion', 'civic'] as const
export const INPUT_SIZE = 29

export const INTEREST_LABEL: Record<Interest, string> = {
  ancient: 'Ancient history',
  medieval: 'Medieval history',
  renaissance: 'Renaissance',
  baroque: 'Baroque',
  modern: 'Modern history',
  archaeology: 'Archaeology',
  art_architecture: 'Art & architecture',
  hidden_gems: 'Hidden gems',
}

export type Affinity = Record<Interest, number>

export function zeroAffinity(): Affinity {
  return Object.fromEntries(INTERESTS.map((k) => [k, 0])) as Affinity
}

export function placeVector(p: Place): number[] {
  const v: number[] = []
  for (const per of PERIODS) v.push(p.periods.includes(per) ? 1 : 0)
  for (const th of THEMES) v.push(p.themes.includes(th) ? 1 : 0)
  v.push(p.kind === 'hidden_gem' ? 1 : 0)
  v.push((p.significance - 1) / 4)
  v.push(Math.min(p.visit_minutes, 60) / 60)
  return v
}

/** 0/1 expression of each interest axis by a place (used by the affinity update rule). */
export function placeAxes(p: Place): number[] {
  return [
    p.periods.includes('ancient') ? 1 : 0,
    p.periods.includes('medieval') ? 1 : 0,
    p.periods.includes('renaissance') ? 1 : 0,
    p.periods.includes('baroque') ? 1 : 0,
    p.periods.includes('modern') ? 1 : 0,
    p.themes.includes('archaeology') ? 1 : 0,
    p.themes.includes('art') || p.themes.includes('architecture') ? 1 : 0,
    p.kind === 'hidden_gem' ? 1 : 0,
  ]
}

export function userVector(interests: Interest[], affinity: Affinity): number[] {
  const sel = INTERESTS.map((k) => (interests.includes(k) ? 1 : 0))
  const aff = INTERESTS.map((k) => Math.max(-1, Math.min(1, affinity[k] ?? 0)))
  return [...sel, ...aff]
}
