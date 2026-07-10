import { describe, it, expect } from 'vitest'
import { newRun, tick } from '../../src/sim/tick'
import { seatOffer, rejectOffer, hire, dispatch, idleMercIds } from '../../src/sim/actions'
import type { GameState, Offer } from '../../src/sim/types'
import { OFFER_TTL_MAX, STARTING_SEATS } from '../../src/sim/balance'
import { createRng } from '../../src/sim/rng'
import { TIMER_KEYS, unlockedTimers, baseInterval, arrivalInterval } from '../../src/sim/offers'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER } from '../../src/sim/balance'

function jobOffer(state: GameState, rating = 1): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'job', postedAt: state.tick, expiresAt: state.tick + 60,
    job: { rating, environment: 'urban', payout: rating * rating * 150, work: rating * 100 },
  }
  state.offers.push(o)
  return o
}

function candidateOffer(state: GameState): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'candidate', postedAt: state.tick, expiresAt: state.tick + 60,
    candidate: { id: state.nextId++, name: 'Rook Ash', klass: 'Scout', rank: 1, hp: 20, maxHp: 20, affinity: 'urban', hirePrice: 100 },
  }
  state.offers.push(o)
  return o
}

describe('offer stream in tick', () => {
  it('spawns offers over time and expires unseated ones', () => {
    const s = newRun(10)
    for (let i = 0; i < OFFER_TTL_MAX + 100; i++) tick(s)
    // offers arrived (some may have expired, but the stream is alive)
    expect(s.nextOfferAt).toBeGreaterThan(0)
    for (const o of s.offers) expect(o.expiresAt).toBeGreaterThan(s.tick)
  })

  it('never expires seated offers', () => {
    const s = newRun(11)
    const o = jobOffer(s)
    seatOffer(s, o.id)
    for (let i = 0; i < OFFER_TTL_MAX + 50; i++) tick(s)
    expect(s.seated.some(x => x.id === o.id)).toBe(true)
  })
})

describe('seat/reject', () => {
  it('seats up to capacity then throws', () => {
    const s = newRun(12)
    const offers = [jobOffer(s), jobOffer(s), jobOffer(s)]
    seatOffer(s, offers[0].id)
    seatOffer(s, offers[1].id)
    expect(s.seated).toHaveLength(STARTING_SEATS)
    expect(() => seatOffer(s, offers[2].id)).toThrow(/seat/i)
  })

  it('rejects from either list', () => {
    const s = newRun(13)
    const a = jobOffer(s), b = jobOffer(s)
    seatOffer(s, a.id)
    rejectOffer(s, a.id)
    rejectOffer(s, b.id)
    expect(s.seated).toHaveLength(0)
    expect(s.offers).toHaveLength(0)
  })
})

describe('hire', () => {
  it('moves the candidate into the roster and charges cash', () => {
    const s = newRun(14)
    const o = candidateOffer(s)
    const cash = s.cash
    hire(s, o.id)
    expect(s.mercs).toHaveLength(3)
    expect(s.cash).toBe(cash - 100)
  })

  it('throws when the roster is full', () => {
    const s = newRun(15)
    s.rosterSlots = 2 // roster already has 2 starters
    const o = candidateOffer(s)
    expect(() => hire(s, o.id)).toThrow(/roster/i)
  })

  it('throws when cash is short', () => {
    const s = newRun(16)
    s.cash = 50
    const o = candidateOffer(s)
    expect(() => hire(s, o.id)).toThrow(/cash|afford/i)
  })
})

describe('dispatch', () => {
  it('creates a mission from a job offer with the chosen squad', () => {
    const s = newRun(17)
    const o = jobOffer(s, 2)
    const squad = idleMercIds(s)
    const missionId = dispatch(s, o.id, squad)
    expect(s.offers).toHaveLength(0)
    const m = s.missions.find(x => x.id === missionId)!
    expect(m.squad).toEqual(squad)
    expect(m.workRequired).toBe(200)
    expect(m.threatBar).toBe(0)
  })

  it('refuses mercs that are already deployed', () => {
    const s = newRun(18)
    const a = jobOffer(s, 1), b = jobOffer(s, 1)
    const squad = idleMercIds(s)
    dispatch(s, a.id, squad)
    expect(() => dispatch(s, b.id, squad)).toThrow(/idle/i)
  })

  it('refuses an empty squad', () => {
    const s = newRun(19)
    const o = jobOffer(s, 1)
    expect(() => dispatch(s, o.id, [])).toThrow(/empty/i)
  })
})

describe('unlockedTimers', () => {
  it('starts with job1 and candidate only', () => {
    expect(unlockedTimers(0)).toEqual(['job1', 'candidate'])
  })

  it('unlocks each job tier at its unlockRep', () => {
    expect(unlockedTimers(3)).not.toContain('job2')
    expect(unlockedTimers(4)).toContain('job2')
    expect(unlockedTimers(16)).toEqual(TIMER_KEYS)
  })
})

describe('baseInterval', () => {
  it('starts at slow on unlock', () => {
    expect(baseInterval('job1', 0)).toBe(JOB_TIERS[0].slow)
    expect(baseInterval('job2', 4)).toBe(JOB_TIERS[1].slow)
    expect(baseInterval('candidate', 0)).toBe(CANDIDATE_ARRIVAL.slow)
  })

  it('reaches fast after REP_RAMP rep past unlock and clamps there', () => {
    expect(baseInterval('job1', REP_RAMP)).toBe(JOB_TIERS[0].fast)
    expect(baseInterval('job1', 999)).toBe(JOB_TIERS[0].fast)
    expect(baseInterval('job5', 999)).toBe(JOB_TIERS[4].fast)
    expect(baseInterval('candidate', 999)).toBe(CANDIDATE_ARRIVAL.fast)
  })

  it('is monotonically non-increasing in reputation for every timer', () => {
    for (const key of TIMER_KEYS) {
      let prev = Infinity
      for (let rep = 0; rep <= 40; rep++) {
        const v = baseInterval(key, rep)
        expect(v).toBeLessThanOrEqual(prev)
        prev = v
      }
    }
  })
})

describe('arrivalInterval', () => {
  it('applies bounded jitter around the base and never drops below 1', () => {
    const rng = createRng(1)
    const lo = Math.floor(JOB_TIERS[0].slow * (1 - ARRIVAL_JITTER))
    const hi = Math.ceil(JOB_TIERS[0].slow * (1 + ARRIVAL_JITTER))
    for (let i = 0; i < 200; i++) {
      const v = arrivalInterval('job1', 0, rng)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(lo)
      expect(v).toBeLessThanOrEqual(hi)
    }
  })
})
