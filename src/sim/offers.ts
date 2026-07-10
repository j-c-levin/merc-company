import type { TimerKey } from './types'
import type { Rng } from './rng'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER } from './balance'

/** Firing order is fixed: when several timers are due on the same tick, jobs
 *  fire low tier first, candidate last. Determinism depends on this order. */
export const TIMER_KEYS: TimerKey[] = ['job1', 'job2', 'job3', 'job4', 'job5', 'candidate']

function ratesFor(key: TimerKey): { unlockRep: number; slow: number; fast: number } {
  if (key === 'candidate') return { unlockRep: 0, ...CANDIDATE_ARRIVAL }
  return JOB_TIERS[Number(key.slice(3)) - 1]
}

export function unlockedTimers(reputation: number): TimerKey[] {
  return TIMER_KEYS.filter(key => reputation >= ratesFor(key).unlockRep)
}

/** Deterministic center of the arrival interval; jitter lives in arrivalInterval. */
export function baseInterval(key: TimerKey, reputation: number): number {
  const { unlockRep, slow, fast } = ratesFor(key)
  const t = Math.min(1, Math.max(0, (reputation - unlockRep) / REP_RAMP))
  return slow + (fast - slow) * t
}

export function arrivalInterval(key: TimerKey, reputation: number, rng: Rng): number {
  const jitter = 1 + (rng.next() * 2 - 1) * ARRIVAL_JITTER
  return Math.max(1, Math.round(baseInterval(key, reputation) * jitter))
}
