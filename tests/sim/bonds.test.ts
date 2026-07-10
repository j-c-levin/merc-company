import { describe, it, expect } from 'vitest'
import { pairKey, bondLevel, recordMissionTogether, squadPower } from '../../src/sim/bonds'
import type { GameState, Merc } from '../../src/sim/types'

function merc(id: number, rank: number, affinity: Merc['affinity']): Merc {
  return { id, name: `M${id}`, klass: 'Scout', rank, hp: 20, maxHp: 20, affinity, hirePrice: 100 }
}

function stubState(mercs: Merc[], bonds: Record<string, number> = {}): GameState {
  return { mercs, bonds } as GameState
}

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey(7, 3)).toBe('3-7')
    expect(pairKey(3, 7)).toBe('3-7')
  })
})

describe('bondLevel', () => {
  it('maps points to levels via thresholds 2/5/9', () => {
    expect(bondLevel(0)).toBe(0)
    expect(bondLevel(1)).toBe(0)
    expect(bondLevel(2)).toBe(1)
    expect(bondLevel(4)).toBe(1)
    expect(bondLevel(5)).toBe(2)
    expect(bondLevel(9)).toBe(3)
    expect(bondLevel(50)).toBe(3)
  })
})

describe('recordMissionTogether', () => {
  it('adds one point to every pair', () => {
    const state = stubState([])
    recordMissionTogether(state, [1, 2, 3])
    expect(state.bonds).toEqual({ '1-2': 1, '1-3': 1, '2-3': 1 })
    recordMissionTogether(state, [1, 2])
    expect(state.bonds['1-2']).toBe(2)
  })
})

describe('squadPower', () => {
  it('sums ranks, doubling on affinity match', () => {
    const state = stubState([merc(1, 2, 'urban'), merc(2, 3, 'rural'), merc(3, 4, 'urban')])
    // urban mission: 2×2 + 3 + 4×2 = 15 (the spec's worked example)
    expect(squadPower(state, [1, 2, 3], 'urban')).toBe(15)
  })

  it('adds bond level for pairs deployed together', () => {
    const state = stubState([merc(1, 2, 'forest'), merc(2, 2, 'forest')], { '1-2': 5 }) // level 2
    // rural mission, no affinity: 2 + 2 + 2 = 6
    expect(squadPower(state, [1, 2], 'rural')).toBe(6)
    // bond only counts when BOTH are deployed
    expect(squadPower(state, [1], 'rural')).toBe(2)
  })
})
