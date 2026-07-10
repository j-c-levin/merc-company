import { describe, it, expect } from 'vitest'
import { createRng } from '../../src/sim/rng'
import { maxTier, generateMerc, generateOffer } from '../../src/sim/content'
import type { GameState } from '../../src/sim/types'
import { HP_BASE, HP_PER_RANK, HIRE_COST_PER_RANK_SQ, PAYOUT_PER_RATING_SQ, WORK_PER_RATING, OFFER_TTL_MIN, OFFER_TTL_MAX } from '../../src/sim/balance'

// Minimal state stub for generation — only fields content.ts reads/writes.
function stubState(reputation = 0): GameState {
  return { reputation, nextId: 1, tick: 100 } as GameState
}

describe('maxTier', () => {
  it('starts at 1 with zero reputation', () => expect(maxTier(0)).toBe(1))
  it('unlocks a tier per REP_PER_TIER', () => expect(maxTier(4)).toBe(2))
  it('caps at 5', () => expect(maxTier(999)).toBe(5))
})

describe('generateMerc', () => {
  it('derives hp and price from rank and assigns unique ids', () => {
    const state = stubState(999) // all ranks possible
    const rng = createRng(1)
    for (let i = 0; i < 50; i++) {
      const m = generateMerc(state, rng)
      expect(m.rank).toBeGreaterThanOrEqual(1)
      expect(m.rank).toBeLessThanOrEqual(5)
      expect(m.maxHp).toBe(HP_BASE + HP_PER_RANK * m.rank)
      expect(m.hp).toBe(m.maxHp)
      expect(m.hirePrice).toBe(m.rank * m.rank * HIRE_COST_PER_RANK_SQ)
      expect(m.name.length).toBeGreaterThan(0)
    }
    expect(state.nextId).toBe(51)
  })

  it('respects the reputation tier cap', () => {
    const state = stubState(0)
    const rng = createRng(2)
    for (let i = 0; i < 30; i++) expect(generateMerc(state, rng).rank).toBe(1)
  })
})

describe('generateOffer', () => {
  it('produces jobs with spec-anchored payout/work and a TTL in range', () => {
    const state = stubState(999)
    const rng = createRng(3)
    let sawJob = false, sawCandidate = false
    for (let i = 0; i < 100; i++) {
      const o = generateOffer(state, rng)
      expect(o.expiresAt - state.tick).toBeGreaterThanOrEqual(OFFER_TTL_MIN)
      expect(o.expiresAt - state.tick).toBeLessThanOrEqual(OFFER_TTL_MAX)
      if (o.kind === 'job') {
        sawJob = true
        expect(o.job!.payout).toBe(o.job!.rating ** 2 * PAYOUT_PER_RATING_SQ)
        expect(o.job!.work).toBe(o.job!.rating * WORK_PER_RATING)
      } else {
        sawCandidate = true
        expect(o.candidate).toBeDefined()
      }
    }
    expect(sawJob && sawCandidate).toBe(true)
  })
})
