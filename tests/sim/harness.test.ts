import { describe, it, expect } from 'vitest'
import { runOne, runMissionScenario, measureOfferMix } from '../../scripts/simulate'

describe('balance harness', () => {
  it('plays a full run to a terminal state, deterministically', () => {
    const a = runOne(1), b = runOne(1)
    expect(['won', 'lost']).toContain(a.status)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('the bot actually plays (some jobs get done across seeds)', () => {
    let jobs = 0
    for (let seed = 1; seed <= 5; seed++) jobs += runOne(seed).stats.jobsDone
    expect(jobs).toBeGreaterThan(0)
  })
})

// The seeded runs are deterministic, so these are exact regression gates on
// the balance constants, not flaky statistical tests.
describe('1★ job balance guarantees', () => {
  it('two fresh 1★ mercs: success the strong norm, deaths rare', () => {
    const r = runMissionScenario(2, 1000)
    expect(r.success / r.runs).toBeGreaterThanOrEqual(0.9)
    expect(r.anyDeath / r.runs).toBeLessThanOrEqual(0.02)
  })

  it('one fresh 1★ merc: a real challenge, but death uncommon', () => {
    const r = runMissionScenario(1, 1000)
    expect(r.success / r.runs).toBeGreaterThanOrEqual(0.55)
    expect(r.success / r.runs).toBeLessThanOrEqual(0.75)
    expect(r.anyDeath / r.runs).toBeLessThanOrEqual(0.1)
  })
})

describe('offer mix by rank', () => {
  it('early game: a steady stream of 1★ jobs', () => {
    const m = measureOfferMix(0)
    expect(m.jobShare.job1).toBe(1) // only tier unlocked
    expect(m.jobsPer100).toBeGreaterThanOrEqual(5) // ≥ one 1★ job per ~20 ticks
  })

  it('high rank: 1★ offers become scarce in favor of higher tiers', () => {
    const m = measureOfferMix(24)
    expect(m.jobShare.job1).toBeLessThan(0.15)
    expect((m.jobShare.job4 ?? 0) + (m.jobShare.job5 ?? 0)).toBeGreaterThan(m.jobShare.job1)
  })
})
