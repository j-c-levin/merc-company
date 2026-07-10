import { describe, it, expect } from 'vitest'
import { project } from '../../src/sim/projection'
import { newRun } from '../../src/sim/tick'
import type { GameState, Merc } from '../../src/sim/types'

function addMerc(state: GameState, rank: number, affinity: Merc['affinity']): Merc {
  const m: Merc = { id: state.nextId++, name: `M${state.nextId}`, klass: 'Fixer', rank, hp: 20, maxHp: 20, affinity, hirePrice: 0 }
  state.mercs.push(m)
  return m
}

describe('project', () => {
  it('matches the spec worked example (3★, power 15 → 6 ticks, 1 consequence)', () => {
    const s = newRun(1)
    s.mercs = []
    const a = addMerc(s, 2, 'urban'), b = addMerc(s, 3, 'rural'), c = addMerc(s, 4, 'urban')
    const p = project(s, [a.id, b.id, c.id], 3, 'urban')
    expect(p.power).toBe(15)
    expect(p.shortfall).toBe(3 * 3 - 15) // threat-neutral power is 3×rating
    expect(p.durationTicks).toBe(6) // ceil(3×30 / 15)
    // over-staffed team on a 3★: min == expected == max == floor(6×3/18) = 1
    expect(p.minConsequences).toBe(1)
    expect(p.expectedConsequences).toBe(1)
    expect(p.maxConsequences).toBe(1)
  })

  it('widens the forecast when understaffed', () => {
    const s = newRun(2)
    s.mercs = []
    const a = addMerc(s, 2, 'forest') // rural 3★ job, no match: power 2
    const p = project(s, [a.id], 3, 'rural')
    expect(p.shortfall).toBe(7) // 3×3 − 2
    expect(p.durationTicks).toBe(45) // ceil(3×30 / 2)
    expect(p.maxConsequences).toBeGreaterThan(p.expectedConsequences)
    expect(p.expectedConsequences).toBeGreaterThan(p.minConsequences)
  })

  it('returns Infinity duration for an empty squad', () => {
    const s = newRun(3)
    expect(project(s, [], 1, 'urban').durationTicks).toBe(Infinity)
  })
})
