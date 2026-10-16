// Human-readable summary of how one rating moved the walker's taste profile.
import { INTEREST_LABEL, INTERESTS, placeAxes, type Affinity } from './model/features'
import { applySignal, type Signal } from './profile'
import type { Place } from './types'

export interface TasteShift { label: string; delta: number }

export function tasteShift(before: Affinity, place: Place, signal: Signal): TasteShift[] {
  const after = applySignal(before, placeAxes(place), signal)
  return INTERESTS
    .map((k) => ({ label: INTEREST_LABEL[k], delta: after[k] - before[k] }))
    .filter((x) => Math.abs(x.delta) > 0.005)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

export function describeShift(shift: TasteShift[]): string {
  if (!shift.length) return 'No change: your taste profile is already at its limit for this kind of place.'
  return shift.map((x) => `${x.label} ${x.delta > 0 ? '↑' : '↓'}`).join(' · ')
}
