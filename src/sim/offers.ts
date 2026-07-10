import type { GameState, Offer, TimerKey } from './types'
import type { Rng } from './rng'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER, OFFER_TTL_MIN, OFFER_TTL_MAX } from './balance'
import { generateJob, generateCandidate } from './content'

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

/** A timer holds its single credit iff none of its offers are in flight
 *  (door or queue). Seated offers returned their credit when seated. */
export function creditHeld(state: GameState, key: TimerKey): boolean {
  return state.door?.source !== key && !state.queue.some(o => o.source === key)
}

function fireTimer(state: GameState, rng: Rng, key: TimerKey): Offer {
  return key === 'candidate'
    ? generateCandidate(state, rng)
    : generateJob(state, rng, Number(key.slice(3)))
}

/** Per-tick pump. Order matters:
 *  1 expire → 2 schedule → 3 fire → 4 promote.
 *  Expiry precedes promotion so a door freed this tick refills this tick;
 *  scheduling precedes firing so a fresh schedule fires no earlier than
 *  tick + interval. All RNG for offers is consumed here and only here. */
export function pumpOffers(state: GameState, rng: Rng): void {
  if (state.door && state.door.expiresAt <= state.tick) state.door = null

  const unlocked = unlockedTimers(state.reputation)
  for (const key of unlocked) {
    if (state.timers[key] === undefined && creditHeld(state, key)) {
      state.timers[key] = state.tick + arrivalInterval(key, state.reputation, rng)
    }
  }
  for (const key of unlocked) {
    const nextAt = state.timers[key]
    if (nextAt !== undefined && nextAt <= state.tick) {
      state.queue.push(fireTimer(state, rng, key))
      delete state.timers[key]
    }
  }
  if (!state.door && state.queue.length > 0) {
    const offer = state.queue.shift()!
    offer.postedAt = state.tick
    offer.expiresAt = state.tick + rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)
    state.door = offer
  }
}
