import type { GameState, Offer, TimerKey } from './types'
import type { Rng } from './rng'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER, OFFER_TTL_MIN, OFFER_TTL_MAX } from './balance'
import { generateJob, generateCandidate } from './content'

/** Fixed source order; determinism relies on it when weights are equal. */
export const TIMER_KEYS: TimerKey[] = ['job1', 'job2', 'job3', 'job4', 'job5', 'candidate']

function ratesFor(key: TimerKey): { unlockRep: number; atUnlock: number; ramped: number } {
  if (key === 'candidate') return { unlockRep: 0, ...CANDIDATE_ARRIVAL }
  return JOB_TIERS[Number(key.slice(3)) - 1]
}

export function unlockedTimers(reputation: number): TimerKey[] {
  return TIMER_KEYS.filter(key => reputation >= ratesFor(key).unlockRep)
}

/** Deterministic center interval for a single source: atUnlock at unlockRep,
 *  ramping to ramped over REP_RAMP reputation, then clamped. */
export function baseInterval(key: TimerKey, reputation: number): number {
  const { unlockRep, atUnlock, ramped } = ratesFor(key)
  const t = Math.min(1, Math.max(0, (reputation - unlockRep) / REP_RAMP))
  return atUnlock + (ramped - atUnlock) * t
}

/** Aggregate cadence of all unlocked sources — the harmonic sum of their
 *  individual rates, i.e. how often *some* offer would arrive under the old
 *  independent-timer model. Seats then throttle actual arrivals. */
export function combinedInterval(reputation: number): number {
  const rate = unlockedTimers(reputation).reduce((sum, key) => sum + 1 / baseInterval(key, reputation), 0)
  return rate > 0 ? 1 / rate : Infinity
}

/** Whole-tick interval until the next arrival, jittered ±ARRIVAL_JITTER. */
export function arrivalInterval(reputation: number, rng: Rng): number {
  const jitter = 1 + (rng.next() * 2 - 1) * ARRIVAL_JITTER
  return Math.max(1, Math.round(combinedInterval(reputation) * jitter))
}

/** Pick the next offer's source, weighted by each unlocked source's rate at
 *  this reputation. Preserves the rank-shifted mix without new constants. */
export function pickSource(reputation: number, rng: Rng): TimerKey {
  const keys = unlockedTimers(reputation)
  const weights = keys.map(key => 1 / baseInterval(key, reputation))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i]
    if (r < 0) return keys[i]
  }
  return keys[keys.length - 1]
}

function generateFor(state: GameState, rng: Rng, key: TimerKey): Offer {
  return key === 'candidate'
    ? generateCandidate(state, rng)
    : generateJob(state, rng, Number(key.slice(3)))
}

/** Per-tick pump for the seat-gated waiting room. Order matters:
 *  1 expire → 2 schedule → 3 arrive. A seat freed this tick (by expiry) can be
 *  filled this tick. All offer RNG is consumed here and only here. */
export function pumpOffers(state: GameState, rng: Rng): void {
  // 1. expire seated offers whose TTL ran out (frees seats); locked offers
  //    ("take a seat") never expire and keep holding their seat.
  state.seated = state.seated.filter(o => o.locked || o.expiresAt > state.tick)

  // 2. schedule the next arrival if none is pending (0 = unscheduled)
  if (!state.nextOfferAt) {
    state.nextOfferAt = state.tick + arrivalInterval(state.reputation, rng)
  }

  // 3. arrive: only when due AND a seat is free (else it stays due for later)
  if (state.nextOfferAt <= state.tick && state.seated.length < state.waitingSeats) {
    const offer = generateFor(state, rng, pickSource(state.reputation, rng))
    offer.postedAt = state.tick
    offer.expiresAt = state.tick + rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)
    state.seated.push(offer)
    state.nextOfferAt = 0 // reschedule next tick
  }
}
