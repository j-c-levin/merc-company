import { describe, it, expect } from 'vitest'
import { newRun, tick } from '../../src/sim/tick'
import { seatOffer, rejectOffer, hire, dispatch, idleMercIds } from '../../src/sim/actions'
import type { GameState, Offer, TimerKey } from '../../src/sim/types'
import { OFFER_TTL_MIN, OFFER_TTL_MAX, STARTING_SEATS } from '../../src/sim/balance'
import { createRng } from '../../src/sim/rng'
import { TIMER_KEYS, unlockedTimers, baseInterval, arrivalInterval, creditHeld, pumpOffers } from '../../src/sim/offers'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER } from '../../src/sim/balance'

function atDoor(state: GameState, offer: Offer): Offer {
  state.door = offer
  return offer
}

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

describe('offer pump in tick', () => {
  it('newRun opens with a 1★ job at the door, TTL running', () => {
    const s = newRun(10)
    expect(s.door).not.toBeNull()
    expect(s.door!.kind).toBe('job')
    expect(s.door!.source).toBe('job1')
    expect(s.door!.job!.rating).toBe(1)
    expect(s.door!.postedAt).toBe(0)
    expect(s.door!.expiresAt).toBeGreaterThanOrEqual(OFFER_TTL_MIN)
    expect(s.door!.expiresAt).toBeLessThanOrEqual(OFFER_TTL_MAX)
  })

  it('the opening offer expires and the pump replaces it over time', () => {
    const s = newRun(10)
    const openingId = s.door!.id
    let sawReplacement = false
    for (let i = 0; i < 200; i++) {
      tick(s)
      if (s.door && s.door.id !== openingId) sawReplacement = true
    }
    // NOT s.door !== null at the end: the door legitimately sits empty
    // between an expiry and the next timer firing.
    expect(sawReplacement).toBe(true)
  })

  it('rejecting the door offer returns the credit — the next tick reschedules the timer', () => {
    const s = newRun(11)
    rejectOffer(s, s.door!.id)
    expect(s.door).toBeNull()
    tick(s)
    expect(s.timers.job1).toBeGreaterThan(s.tick)
  })

  it('never expires seated offers', () => {
    const s = newRun(12)
    const id = s.door!.id
    seatOffer(s, id)
    for (let i = 0; i < OFFER_TTL_MAX + 50; i++) tick(s)
    expect(s.seated.some(o => o.id === id)).toBe(true)
  })

  it('seating returns the credit while the offer persists in seated', () => {
    const s = newRun(12)
    seatOffer(s, s.door!.id)
    expect(creditHeld(s, 'job1')).toBe(true)
    tick(s)
    expect(s.timers.job1).toBeGreaterThan(s.tick)
  })

  it('hiring the door candidate returns the credit', () => {
    const s = newRun(14)
    atDoor(s, candidateOffer(s))
    hire(s, s.door!.id)
    expect(s.door).toBeNull()
    expect(creditHeld(s, 'candidate')).toBe(true)
    tick(s)
    expect(s.timers.candidate).toBeGreaterThan(s.tick)
  })

  it('dispatching the door job returns the credit', () => {
    const s = newRun(15)
    atDoor(s, jobOffer(s))
    dispatch(s, s.door!.id, idleMercIds(s))
    expect(s.door).toBeNull()
    expect(creditHeld(s, 'job1')).toBe(true)
    tick(s)
    expect(s.timers.job1).toBeGreaterThan(s.tick)
  })

  it('player actions consume no RNG', () => {
    const s = newRun(13)
    const before = s.rngState
    seatOffer(s, s.door!.id)
    rejectOffer(s, s.seated[0].id)
    expect(s.rngState).toBe(before)
  })

  it('same seed + same actions at same ticks → identical states', () => {
    const play = (): GameState => {
      const s = newRun(77)
      for (let i = 0; i < 120; i++) {
        tick(s)
        if (i === 30 && s.door) rejectOffer(s, s.door.id)
        if (i === 60 && s.door && s.seated.length < s.waitingSeats) seatOffer(s, s.door.id)
      }
      return s
    }
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()))
  })
})

describe('seat/reject', () => {
  it('seats up to capacity then throws', () => {
    const s = newRun(12)
    seatOffer(s, atDoor(s, jobOffer(s)).id)
    seatOffer(s, atDoor(s, jobOffer(s)).id)
    expect(s.seated).toHaveLength(STARTING_SEATS)
    expect(() => seatOffer(s, atDoor(s, jobOffer(s)).id)).toThrow(/seat/i)
  })

  it('rejects from the door and from a seat', () => {
    const s = newRun(13)
    const a = atDoor(s, jobOffer(s))
    seatOffer(s, a.id)
    const b = atDoor(s, jobOffer(s))
    rejectOffer(s, a.id)
    rejectOffer(s, b.id)
    expect(s.seated).toHaveLength(0)
    expect(s.door).toBeNull()
  })
})

describe('hire', () => {
  it('moves the candidate into the roster and charges cash', () => {
    const s = newRun(14)
    const o = atDoor(s, candidateOffer(s))
    const cash = s.cash
    hire(s, o.id)
    expect(s.mercs).toHaveLength(3)
    expect(s.cash).toBe(cash - 100)
  })

  it('throws when the roster is full', () => {
    const s = newRun(15)
    s.rosterSlots = 2 // roster already has 2 starters
    const o = atDoor(s, candidateOffer(s))
    expect(() => hire(s, o.id)).toThrow(/roster/i)
  })

  it('throws when cash is short', () => {
    const s = newRun(16)
    s.cash = 50
    const o = atDoor(s, candidateOffer(s))
    expect(() => hire(s, o.id)).toThrow(/cash|afford/i)
  })
})

describe('dispatch', () => {
  it('creates a mission from a job offer with the chosen squad', () => {
    const s = newRun(17)
    const o = atDoor(s, jobOffer(s, 2))
    const squad = idleMercIds(s)
    const missionId = dispatch(s, o.id, squad)
    expect(s.door).toBeNull()
    const m = s.missions.find(x => x.id === missionId)!
    expect(m.squad).toEqual(squad)
    expect(m.workRequired).toBe(200)
    expect(m.threatBar).toBe(0)
  })

  it('refuses mercs that are already deployed', () => {
    const s = newRun(18)
    const squad = idleMercIds(s)
    dispatch(s, atDoor(s, jobOffer(s)).id, squad)
    expect(() => dispatch(s, atDoor(s, jobOffer(s)).id, squad)).toThrow(/idle/i)
  })

  it('refuses an empty squad', () => {
    const s = newRun(19)
    const o = atDoor(s, jobOffer(s, 1))
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
  it('starts at atUnlock on unlock', () => {
    expect(baseInterval('job1', 0)).toBe(JOB_TIERS[0].atUnlock)
    expect(baseInterval('job2', 4)).toBe(JOB_TIERS[1].atUnlock)
    expect(baseInterval('candidate', 0)).toBe(CANDIDATE_ARRIVAL.atUnlock)
  })

  it('reaches ramped after REP_RAMP rep past unlock and clamps there', () => {
    expect(baseInterval('job1', REP_RAMP)).toBe(JOB_TIERS[0].ramped)
    expect(baseInterval('job1', 999)).toBe(JOB_TIERS[0].ramped)
    expect(baseInterval('job5', 999)).toBe(JOB_TIERS[4].ramped)
    expect(baseInterval('candidate', 999)).toBe(CANDIDATE_ARRIVAL.ramped)
  })

  it('moves each timer monotonically from atUnlock toward ramped, never past it', () => {
    const rates = (key: (typeof TIMER_KEYS)[number]) =>
      key === 'candidate'
        ? { unlockRep: 0, ...CANDIDATE_ARRIVAL }
        : JOB_TIERS[Number(key.slice(3)) - 1]
    for (const key of TIMER_KEYS) {
      const { unlockRep, atUnlock, ramped } = rates(key)
      const dir = Math.sign(ramped - atUnlock)
      let prev = atUnlock
      for (let rep = unlockRep; rep <= unlockRep + REP_RAMP + 10; rep++) {
        const v = baseInterval(key, rep)
        expect((v - prev) * dir).toBeGreaterThanOrEqual(0) // monotone toward ramped
        expect(v).toBeGreaterThanOrEqual(Math.min(atUnlock, ramped))
        expect(v).toBeLessThanOrEqual(Math.max(atUnlock, ramped))
        prev = v
      }
      expect(baseInterval(key, unlockRep + REP_RAMP)).toBe(ramped)
    }
  })

  it('shifts the mix with rank: 1★ fades out while 3★-5★ speed up', () => {
    expect(baseInterval('job1', 40)).toBeGreaterThan(baseInterval('job1', 0))
    for (const tier of [3, 4, 5]) {
      const { unlockRep, atUnlock, ramped } = JOB_TIERS[tier - 1]
      expect(ramped).toBeLessThan(atUnlock)
      expect(baseInterval(`job${tier}` as TimerKey, unlockRep + REP_RAMP)).toBeLessThan(
        baseInterval(`job${tier}` as TimerKey, unlockRep),
      )
    }
  })
})

describe('arrivalInterval', () => {
  it('applies bounded jitter around the base and never drops below 1', () => {
    const rng = createRng(1)
    const lo = Math.floor(JOB_TIERS[0].atUnlock * (1 - ARRIVAL_JITTER))
    const hi = Math.ceil(JOB_TIERS[0].atUnlock * (1 + ARRIVAL_JITTER))
    for (let i = 0; i < 200; i++) {
      const v = arrivalInterval('job1', 0, rng)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(lo)
      expect(v).toBeLessThanOrEqual(hi)
    }
  })
})

/** Fresh state with the pump fields empty and reputation set. */
function pumpState(rep = 0): GameState {
  const s = newRun(50)
  s.reputation = rep
  s.door = null
  s.queue = []
  s.timers = {}
  return s
}

describe('pumpOffers', () => {
  it('schedules unlocked timers that hold credit; locked tiers never fire', () => {
    const s = pumpState(0)
    pumpOffers(s, createRng(1))
    expect(s.timers.job1).toBeGreaterThan(s.tick)
    expect(s.timers.candidate).toBeGreaterThan(s.tick)
    expect(s.timers.job2).toBeUndefined()
  })

  it('crossing unlockRep initialises a tier with no special case', () => {
    const s = pumpState(0)
    pumpOffers(s, createRng(1))
    s.reputation = 4
    pumpOffers(s, createRng(2))
    expect(s.timers.job2).toBeGreaterThan(s.tick)
  })

  it('fires a due timer into the door, stamping postedAt/expiresAt on promotion', () => {
    const s = pumpState(0)
    s.timers.job1 = s.tick
    pumpOffers(s, createRng(2))
    expect(s.door).not.toBeNull()
    expect(s.door!.source).toBe('job1')
    expect(s.door!.postedAt).toBe(s.tick)
    expect(s.door!.expiresAt).toBeGreaterThan(s.tick)
    expect(s.timers.job1).toBeUndefined() // credit spent: not rescheduled while in flight
  })

  it('never reschedules a timer whose offer is in flight', () => {
    const s = pumpState(0)
    s.timers.job1 = s.tick
    const rng = createRng(3)
    pumpOffers(s, rng)
    expect(creditHeld(s, 'job1')).toBe(false)
    pumpOffers(s, rng)
    expect(s.timers.job1).toBeUndefined()
  })

  it('queued offers are frozen and promote FIFO by fire order', () => {
    const s = pumpState(4)
    s.timers.job1 = s.tick
    s.timers.job2 = s.tick
    const rng = createRng(4)
    pumpOffers(s, rng)
    expect(s.door!.source).toBe('job1') // TIMER_KEYS order: job1 fires first
    expect(s.queue).toHaveLength(1)
    expect(s.queue[0].source).toBe('job2')
    expect(s.queue[0].expiresAt).toBe(0) // frozen while queued
    s.door = null // simulate the player resolving the door offer
    pumpOffers(s, rng)
    expect(s.door!.source).toBe('job2')
    expect(s.door!.expiresAt).toBeGreaterThan(s.tick)
  })

  it('expires the door offer and refills from the queue in the same pump', () => {
    const s = pumpState(0)
    s.door = {
      id: 900, kind: 'job', source: 'job1', postedAt: 0, expiresAt: s.tick,
      job: { rating: 1, environment: 'urban', payout: 150, work: 100 },
    }
    s.queue.push({
      id: 901, kind: 'candidate', source: 'candidate', postedAt: 0, expiresAt: 0,
      candidate: { id: 902, name: 'Rook Ash', klass: 'Scout', rank: 1, hp: 20, maxHp: 20, affinity: 'urban', hirePrice: 100 },
    })
    pumpOffers(s, createRng(7))
    expect(s.door!.id).toBe(901)
    expect(s.door!.expiresAt).toBeGreaterThan(s.tick)
    expect(s.queue).toHaveLength(0)
    expect(s.timers.job1).toBeGreaterThan(s.tick) // expiry returned job1's credit
  })

  it('a re-locked tier stops firing but keeps its due timer entry', () => {
    const s = pumpState(4)
    s.timers.job2 = s.tick
    s.reputation = 0 // rep loss re-locks tier 2 before the pump runs
    pumpOffers(s, createRng(8))
    expect(s.door?.source ?? null).not.toBe('job2') // did not fire
    expect(s.timers.job2).toBe(s.tick) // entry kept for when rep recovers
  })
})
