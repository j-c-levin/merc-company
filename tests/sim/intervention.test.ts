import { describe, it, expect } from 'vitest'
import { newRun, tick } from '../../src/sim/tick'
import { reinforce, withdraw, sendSupply } from '../../src/sim/actions'
import type { GameState, Merc, Mission } from '../../src/sim/types'
import { REINFORCE_TRAVEL, SUPPLY_TRAVEL, MEDKIT, SUPPRESSOR, STIM } from '../../src/sim/balance'

// Big rank-5 matched mercs → shortfall ≤ 0 → deterministic minimum threat.
function addMerc(state: GameState, hp = 99): Merc {
  const m: Merc = { id: state.nextId++, name: `M${state.nextId}`, klass: 'Gunner', rank: 5, hp, maxHp: 99, affinity: 'urban', hirePrice: 0 }
  state.mercs.push(m)
  return m
}

function addMission(state: GameState, squad: number[], rating = 1): Mission {
  const mission: Mission = {
    id: state.nextId++, rating, environment: 'urban', payout: 150,
    workRequired: 10000, workDone: 0, threatBar: 0, threatLevel: 0,
    squad, inbound: [], supplies: [], stimUntil: 0,
  }
  state.missions.push(mission)
  return mission
}

function freshState(): GameState {
  const s = newRun(30)
  s.mercs = []
  s.cash = 10000
  return s
}

describe('reinforce', () => {
  it('adds the merc to the squad after the travel delay', () => {
    const s = freshState()
    const a = addMerc(s), b = addMerc(s)
    const m = addMission(s, [a.id])
    reinforce(s, m.id, b.id)
    expect(m.inbound).toHaveLength(1)
    for (let i = 0; i < REINFORCE_TRAVEL; i++) tick(s)
    expect(m.squad).toContain(b.id)
    expect(m.inbound).toHaveLength(0)
  })
})

describe('withdraw', () => {
  it('removes the merc and sends them homebound; empty mission fails next tick', () => {
    const s = freshState()
    const a = addMerc(s)
    const m = addMission(s, [a.id])
    withdraw(s, m.id, a.id)
    expect(m.squad).toHaveLength(0)
    expect(s.homebound).toHaveLength(1)
    tick(s)
    expect(s.missions).toHaveLength(0)
    expect(s.stats.jobsFailed).toBe(1)
  })
})

describe('supplies', () => {
  it('medkit heals the most injured squad member after travel', () => {
    const s = freshState()
    const a = addMerc(s, 50), b = addMerc(s, 20)
    const m = addMission(s, [a.id, b.id])
    sendSupply(s, m.id, 'medkit')
    expect(s.cash).toBe(10000 - MEDKIT.price)
    for (let i = 0; i < SUPPLY_TRAVEL; i++) tick(s)
    expect(b.hp).toBe(20 + MEDKIT.heal)
    expect(a.hp).toBe(50)
  })

  it('suppressor knocks the threat bar down, floored at 0', () => {
    const s = freshState()
    const a = addMerc(s)
    const m = addMission(s, [a.id], 1) // min threat 1/tick, shortfall ≤ 0
    sendSupply(s, m.id, 'suppressor')
    for (let i = 0; i < SUPPLY_TRAVEL; i++) tick(s)
    // ticks 1-2 add the minimum 1 each (bar 2); on tick 3 the suppressor lands
    // FIRST (2−9 → floored at 0), then that tick's threat still adds 1.
    expect(SUPPRESSOR.reduce).toBeGreaterThan(SUPPLY_TRAVEL) // sanity: full wipe
    expect(m.threatBar).toBe(1)
  })

  it('stim boosts completion for its duration', () => {
    const s = freshState()
    const a = addMerc(s) // rank 5, urban match → power 10
    const m = addMission(s, [a.id])
    sendSupply(s, m.id, 'stim')
    for (let i = 0; i < SUPPLY_TRAVEL; i++) tick(s)
    const before = m.workDone
    tick(s)
    expect(m.workDone - before).toBe(Math.floor(10 * STIM.multiplier))
    for (let i = 0; i < STIM.duration + 1; i++) tick(s)
    const later = m.workDone
    tick(s)
    expect(m.workDone - later).toBe(10) // stim expired
  })
})
