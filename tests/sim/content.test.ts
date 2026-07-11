import { describe, it, expect } from 'vitest'
import { createRng } from '../../src/sim/rng'
import { maxTier, generateMerc, generateJob, generateCandidate } from '../../src/sim/content'
import type { GameState } from '../../src/sim/types'
import { HP_BASE, HP_PER_RANK, HIRE_COST_PER_RANK_SQ, PAYOUT_PER_RATING_SQ, WORK_PER_RATING } from '../../src/sim/balance'

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

describe('generateJob / generateCandidate', () => {
  it('stamps source and leaves TTL unstamped until it is seated', () => {
    const state = stubState(0)
    const rng = createRng(5)
    const job = generateJob(state, rng, 3)
    expect(job.kind).toBe('job')
    expect(job.source).toBe('job3')
    expect(job.postedAt).toBe(0)
    expect(job.expiresAt).toBe(0)
    expect(job.job!.rating).toBe(3)
    expect(job.job!.payout).toBe(9 * PAYOUT_PER_RATING_SQ)
    expect(job.job!.work).toBe(3 * WORK_PER_RATING)

    const cand = generateCandidate(state, rng)
    expect(cand.kind).toBe('candidate')
    expect(cand.source).toBe('candidate')
    expect(cand.candidate).toBeDefined()
    expect(cand.postedAt).toBe(0)
    expect(cand.expiresAt).toBe(0)
  })

  it('generateJob takes its rating from the caller, not from reputation', () => {
    const state = stubState(0) // rep 0: the old maxTier path would cap at 1★
    const rng = createRng(6)
    expect(generateJob(state, rng, 5).job!.rating).toBe(5)
  })
})
