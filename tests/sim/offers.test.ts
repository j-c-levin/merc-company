import { describe, it, expect } from 'vitest'
import { newRun, tick } from '../../src/sim/tick'
import { rejectOffer, hire, dispatch, idleMercIds, takeSeat } from '../../src/sim/actions'
import type { GameState, Offer, TimerKey } from '../../src/sim/types'
import { OFFER_TTL_MIN, OFFER_TTL_MAX } from '../../src/sim/balance'
import { createRng } from '../../src/sim/rng'
import {
  TIMER_KEYS, unlockedTimers, baseInterval, combinedInterval,
  arrivalInterval, pickSource, pumpOffers,
} from '../../src/sim/offers'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER } from '../../src/sim/balance'

function jobOffer(state: GameState, rating = 1): Offer {
  return {
    id: state.nextId++, kind: 'job', source: `job${rating}` as TimerKey,
    postedAt: state.tick, expiresAt: state.tick + 60,
    job: { rating, environment: 'urban', payout: rating * rating * 150, work: rating * 100 },
  }
}
function candidateOffer(state: GameState): Offer {
  return {
    id: state.nextId++, kind: 'candidate', source: 'candidate',
    postedAt: state.tick, expiresAt: state.tick + 60,
    candidate: { id: state.nextId++, name: 'Rook Ash', klass: 'Scout', rank: 1, hp: 20, maxHp: 20, affinity: 'urban', hirePrice: 100 },
  }
}

describe('newRun opening offer', () => {
  it('seats a single 1★ job with its TTL running', () => {
    const s = newRun(10)
    expect(s.seated).toHaveLength(1)
    const o = s.seated[0]
    expect(o.kind).toBe('job')
    expect(o.source).toBe('job1')
    expect(o.job!.rating).toBe(1)
    expect(o.postedAt).toBe(0)
    expect(o.expiresAt).toBeGreaterThanOrEqual(OFFER_TTL_MIN)
    expect(o.expiresAt).toBeLessThanOrEqual(OFFER_TTL_MAX)
  })

  it('has no door/queue/timers fields, and a numeric nextOfferAt', () => {
    const s = newRun(10) as unknown as Record<string, unknown>
    expect(s.door).toBeUndefined()
    expect(s.queue).toBeUndefined()
    expect(s.timers).toBeUndefined()
    expect(typeof s.nextOfferAt).toBe('number')
  })
})

describe('seat-gated arrivals', () => {
  it('draws no new offer while every seat is full', () => {
    const s = newRun(10) // 1 seat, filled by the opening offer
    const id = s.seated[0].id
    for (let i = 0; i < OFFER_TTL_MIN - 1; i++) tick(s) // before the opening TTL can expire
    expect(s.seated).toHaveLength(1)
    expect(s.seated[0].id).toBe(id)
  })

  it('a freed seat draws the next offer', () => {
    const s = newRun(10)
    rejectOffer(s, s.seated[0].id) // free the only seat
    let filled = false
    for (let i = 0; i < 80 && !filled; i++) { tick(s); if (s.seated.length === 1) filled = true }
    expect(filled).toBe(true)
  })

  it('an expired offer frees its seat', () => {
    const s = newRun(10)
    const id = s.seated[0].id
    for (let i = 0; i <= OFFER_TTL_MAX; i++) tick(s)
    expect(s.seated.every(o => o.id !== id)).toBe(true) // opening offer is gone
  })

  it('fills toward a larger seat capacity but never past it', () => {
    const s = newRun(10)
    s.waitingSeats = 3
    rejectOffer(s, s.seated[0].id)
    let max = 0
    for (let i = 0; i < 300; i++) { tick(s); max = Math.max(max, s.seated.length) } // never act
    expect(max).toBeGreaterThan(1)
    expect(max).toBeLessThanOrEqual(3)
  })
})

describe('pumpOffers', () => {
  function pumpState(rep = 0): GameState {
    const s = newRun(50)
    // Advance off tick 0: nextOfferAt's "0 = unscheduled" sentinel is
    // indistinguishable from "due at tick 0", which several tests below rely
    // on setting via `s.nextOfferAt = s.tick`. Real gameplay never hits this —
    // tick() increments state.tick before calling pumpOffers — so this only
    // disambiguates the isolated unit calls here.
    s.tick = 100
    s.reputation = rep
    s.seated = []
    s.nextOfferAt = 0
    return s
  }

  it('schedules the next arrival when none is pending, seating nothing yet', () => {
    const s = pumpState(0)
    pumpOffers(s, createRng(1))
    expect(s.nextOfferAt).toBeGreaterThan(s.tick)
    expect(s.seated).toHaveLength(0)
  })

  it('seats one offer when due and a seat is free, then reschedules', () => {
    const s = pumpState(0)
    s.nextOfferAt = s.tick
    pumpOffers(s, createRng(2))
    expect(s.seated).toHaveLength(1)
    expect(s.seated[0].postedAt).toBe(s.tick)
    expect(s.seated[0].expiresAt).toBeGreaterThan(s.tick)
    expect(s.nextOfferAt).toBe(0) // cleared → reschedules next tick
  })

  it('does not seat when due but all seats are full, keeping the due time', () => {
    const s = pumpState(0)
    s.waitingSeats = 1
    s.seated = [jobOffer(s)] // seat occupied
    s.nextOfferAt = s.tick
    pumpOffers(s, createRng(3))
    expect(s.seated).toHaveLength(1)
    expect(s.nextOfferAt).toBe(s.tick) // still due, arrives the instant a seat frees
  })

  it('expires a seated offer whose TTL ran out, freeing the seat', () => {
    const s = pumpState(0)
    s.waitingSeats = 1
    const stale = jobOffer(s)
    stale.expiresAt = s.tick // already due to expire
    s.seated = [stale]
    s.nextOfferAt = s.tick + 999 // nothing new arrives this pump
    pumpOffers(s, createRng(4))
    expect(s.seated).toHaveLength(0)
  })
})

describe('rank-shifted mix', () => {
  it('unlockedTimers starts with job1 and candidate only', () => {
    expect(unlockedTimers(0)).toEqual(['job1', 'candidate'])
  })

  it('unlocks each job tier at its unlockRep', () => {
    expect(unlockedTimers(3)).not.toContain('job2')
    expect(unlockedTimers(4)).toContain('job2')
    expect(unlockedTimers(16)).toEqual(TIMER_KEYS)
  })

  it('baseInterval runs atUnlock → ramped over REP_RAMP and clamps', () => {
    expect(baseInterval('job1', 0)).toBe(JOB_TIERS[0].atUnlock)
    expect(baseInterval('job1', REP_RAMP)).toBe(JOB_TIERS[0].ramped)
    expect(baseInterval('job1', 999)).toBe(JOB_TIERS[0].ramped)
    expect(baseInterval('candidate', 999)).toBe(CANDIDATE_ARRIVAL.ramped)
  })

  it('shifts the mix with rank: 1★ fades while 3★-5★ speed up', () => {
    expect(baseInterval('job1', 40)).toBeGreaterThan(baseInterval('job1', 0))
    for (const tier of [3, 4, 5]) {
      const { unlockRep } = JOB_TIERS[tier - 1]
      expect(baseInterval(`job${tier}` as TimerKey, unlockRep + REP_RAMP)).toBeLessThan(
        baseInterval(`job${tier}` as TimerKey, unlockRep),
      )
    }
  })

  it('combinedInterval is the harmonic aggregate of unlocked rates', () => {
    const expected = 1 / (1 / baseInterval('job1', 0) + 1 / baseInterval('candidate', 0))
    expect(combinedInterval(0)).toBeCloseTo(expected, 6)
  })

  it('arrivalInterval jitters around the combined center, integer, ≥ 1', () => {
    const rng = createRng(1)
    const center = combinedInterval(0)
    const lo = Math.floor(center * (1 - ARRIVAL_JITTER))
    const hi = Math.ceil(center * (1 + ARRIVAL_JITTER))
    for (let i = 0; i < 200; i++) {
      const v = arrivalInterval(0, rng)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(Math.max(1, lo))
      expect(v).toBeLessThanOrEqual(hi)
    }
  })

  it('pickSource only returns unlocked sources', () => {
    const rng = createRng(2)
    for (let i = 0; i < 200; i++) expect(unlockedTimers(8)).toContain(pickSource(8, rng))
  })

  it('pickSource at rep 0 yields only job1 among jobs', () => {
    const rng = createRng(3)
    for (let i = 0; i < 300; i++) {
      const k = pickSource(0, rng)
      if (k !== 'candidate') expect(k).toBe('job1')
    }
  })
})

describe('seated actions', () => {
  function seatJob(s: GameState, rating = 1): Offer { const o = jobOffer(s, rating); s.seated.push(o); return o }
  function seatCand(s: GameState): Offer { const o = candidateOffer(s); s.seated.push(o); return o }

  it('rejecting frees the seat', () => {
    const s = newRun(13)
    const a = seatJob(s)
    rejectOffer(s, a.id)
    expect(s.seated.some(o => o.id === a.id)).toBe(false)
  })

  it('hire moves the candidate into the roster and charges cash', () => {
    const s = newRun(14)
    s.seated = []
    const o = seatCand(s)
    const cash = s.cash
    hire(s, o.id)
    expect(s.mercs).toHaveLength(3)
    expect(s.cash).toBe(cash - 100)
    expect(s.seated.some(x => x.id === o.id)).toBe(false)
  })

  it('hire throws when the roster is full', () => {
    const s = newRun(15)
    s.rosterSlots = 2
    const o = seatCand(s)
    expect(() => hire(s, o.id)).toThrow(/roster/i)
  })

  it('dispatch creates a mission from a seated job and frees the seat', () => {
    const s = newRun(17)
    s.seated = []
    const o = seatJob(s, 2)
    const squad = idleMercIds(s)
    const missionId = dispatch(s, o.id, squad)
    const m = s.missions.find(x => x.id === missionId)!
    expect(m.squad).toEqual(squad)
    expect(m.workRequired).toBe(200) // fixture work = rating × 100
    expect(s.seated.some(x => x.id === o.id)).toBe(false)
  })

  it('dispatch refuses mercs already deployed', () => {
    const s = newRun(18)
    s.seated = []
    const squad = idleMercIds(s)
    dispatch(s, seatJob(s).id, squad)
    expect(() => dispatch(s, seatJob(s).id, squad)).toThrow(/idle/i)
  })

  it('dispatch refuses an empty squad', () => {
    const s = newRun(19)
    s.seated = []
    expect(() => dispatch(s, seatJob(s).id, [])).toThrow(/empty/i)
  })
})

describe('take a seat (lock an offer)', () => {
  // A fresh state parked off tick 0 with an empty, single-seat waiting room.
  function lockState(): GameState {
    const s = newRun(60)
    s.tick = 100
    s.waitingSeats = 1
    s.seated = []
    s.nextOfferAt = 0
    return s
  }

  it('takeSeat sets locked on the target seated offer', () => {
    const s = lockState()
    const o = jobOffer(s); s.seated.push(o)
    expect(o.locked).toBeUndefined()
    takeSeat(s, o.id)
    expect(s.seated.find(x => x.id === o.id)!.locked).toBe(true)
  })

  it('takeSeat throws for an unknown offer id', () => {
    const s = lockState()
    expect(() => takeSeat(s, 9999)).toThrow(/no offer/i)
  })

  it('takeSeat is idempotent when called twice', () => {
    const s = lockState()
    const o = jobOffer(s); s.seated.push(o)
    takeSeat(s, o.id)
    expect(() => takeSeat(s, o.id)).not.toThrow()
    expect(o.locked).toBe(true)
  })

  it('a locked offer survives past its original TTL', () => {
    const s = lockState()
    const o = jobOffer(s)
    o.expiresAt = s.tick // would expire this very pump
    s.seated.push(o)
    takeSeat(s, o.id)
    s.nextOfferAt = s.tick + 999 // nothing new arrives to confuse the count
    pumpOffers(s, createRng(1))
    expect(s.seated.some(x => x.id === o.id)).toBe(true)
  })

  it('a locked seat blocks new arrivals even when one is due', () => {
    const s = lockState() // waitingSeats = 1
    const o = jobOffer(s); s.seated.push(o)
    takeSeat(s, o.id)
    s.nextOfferAt = s.tick // an arrival is due right now
    pumpOffers(s, createRng(2))
    expect(s.seated).toHaveLength(1) // seat stays occupied by the locked offer
    expect(s.seated[0].id).toBe(o.id)
    expect(s.nextOfferAt).toBe(s.tick) // still pending — arrives only once a seat frees
  })

  it('rejecting a locked offer still frees the seat', () => {
    const s = lockState()
    const o = jobOffer(s); s.seated.push(o)
    takeSeat(s, o.id)
    rejectOffer(s, o.id)
    expect(s.seated.some(x => x.id === o.id)).toBe(false)
  })

  it('hiring a locked candidate still removes it from the seat', () => {
    const s = lockState()
    const o = candidateOffer(s); s.seated.push(o)
    takeSeat(s, o.id)
    hire(s, o.id)
    expect(s.seated.some(x => x.id === o.id)).toBe(false)
    expect(s.mercs.some(m => m.name === 'Rook Ash')).toBe(true)
  })
})

describe('determinism', () => {
  it('same seed → identical state after many ticks (offers included)', () => {
    const a = newRun(77), b = newRun(77)
    for (let i = 0; i < 200; i++) { tick(a); tick(b) }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('player actions consume no RNG', () => {
    const s = newRun(13)
    const before = s.rngState
    rejectOffer(s, s.seated[0].id)
    expect(s.rngState).toBe(before)
  })
})
