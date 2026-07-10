import { describe, it, expect } from 'vitest'
import { runOne } from '../../scripts/simulate'

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
