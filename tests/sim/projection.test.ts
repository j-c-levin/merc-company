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
  it('matches the spec worked example (3★, power 15 → 20 ticks, 3 consequences)', () => {
    const s = newRun(1)
    s.mercs = []
    const a = addMerc(s, 2, 'urban'), b = addMerc(s, 3, 'rural'), c = addMerc(s, 4, 'urban')
    const p = project(s, [a.id, b.id, c.id], 3, 'urban')
    expect(p.power).toBe(15)
    expect(p.shortfall).toBe(0)
    expect(p.durationTicks).toBe(20)
    // maxed team on a 3★: min == expected == max == floor(20×3/18) = 3
    expect(p.minConsequences).toBe(3)
    expect(p.expectedConsequences).toBe(3)
    expect(p.maxConsequences).toBe(3)
  })

  it('widens the forecast when understaffed', () => {
    const s = newRun(2)
    s.mercs = []
    const a = addMerc(s, 2, 'forest') // rural 3★ job, no match: power 2
    const p = project(s, [a.id], 3, 'rural')
    expect(p.shortfall).toBe(13)
    expect(p.durationTicks).toBe(150)
    expect(p.maxConsequences).toBeGreaterThan(p.expectedConsequences)
    expect(p.expectedConsequences).toBeGreaterThan(p.minConsequences)
  })

  it('returns Infinity duration for an empty squad', () => {
    const s = newRun(3)
    expect(project(s, [], 1, 'urban').durationTicks).toBe(Infinity)
  })
})
