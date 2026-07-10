import { describe, it, expect } from 'vitest'
import { newRun, tick } from '../../src/sim/tick'
import { seatOffer, rejectOffer, hire, dispatch, idleMercIds } from '../../src/sim/actions'
import type { GameState, Offer } from '../../src/sim/types'
import { OFFER_TTL_MAX, STARTING_SEATS } from '../../src/sim/balance'

function jobOffer(state: GameState, rating = 1): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'job', expiresAt: state.tick + 60,
    job: { rating, environment: 'urban', payout: rating * rating * 150, work: rating * 100 },
  }
  state.offers.push(o)
  return o
}

function candidateOffer(state: GameState): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'candidate', expiresAt: state.tick + 60,
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
