import { describe, it, expect } from 'vitest'
import { newRun, tick } from '../../src/sim/tick'
import type { GameState, Merc, Mission } from '../../src/sim/types'
import { STARTING_CASH, LOAN, STARTING_ROSTER_SLOTS, THREAT_CAP, REINFORCE_TRAVEL } from '../../src/sim/balance'

function addMerc(state: GameState, rank: number, affinity: Merc['affinity'], hp = 99): Merc {
  const m: Merc = { id: state.nextId++, name: `M${state.nextId}`, klass: 'Gunner', rank, hp, maxHp: hp, affinity, hirePrice: 0 }
  state.mercs.push(m)
  return m
}

function addMission(state: GameState, rating: number, squad: number[]): Mission {
  const mission: Mission = {
    id: state.nextId++, rating, environment: 'urban', payout: rating * rating * 150,
    workRequired: rating * 100, workDone: 0, threatBar: 0, threatLevel: 0,
    squad, inbound: [], supplies: [], stimUntil: 0,
  }
  state.missions.push(mission)
  return mission
}

describe('newRun', () => {
  it('creates the spec starting kit', () => {
    const s = newRun(123)
    expect(s.status).toBe('running')
    expect(s.cash).toBe(STARTING_CASH)
    expect(s.loan).toBe(LOAN)
    expect(s.mercs).toHaveLength(2)
    expect(s.rosterSlots).toBe(STARTING_ROSTER_SLOTS)
    expect(s.tick).toBe(0)
  })

  it('is deterministic per seed', () => {
    const a = newRun(5), b = newRun(5)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('mission tick — the spec worked example', () => {
  // 3★ urban mission; ranks 2,3,4 with two urban affinities → power 15.
  // Synthetic work 300 (fixture) → completes in exactly 20 ticks. Power 15 ≥
  // threat-neutral 9 (3×rating) → shortfall ≤ 0 → threat is exactly the
  // minimum (3/tick): deterministic despite the rng.
  function setup() {
    const s = newRun(1)
    s.mercs = []
    const a = addMerc(s, 2, 'urban')
    const b = addMerc(s, 3, 'rural')
    const c = addMerc(s, 4, 'urban')
    const m = addMission(s, 3, [a.id, b.id, c.id])
    return { s, m, a, b, c }
  }

  it('completes in 20 ticks and pays out', () => {
    const { s } = setup()
    const cash = s.cash
    for (let i = 0; i < 20; i++) tick(s)
    expect(s.missions).toHaveLength(0)
    expect(s.cash).toBe(cash + 9 * 150)
    expect(s.reputation).toBe(3)
    expect(s.stats.jobsDone).toBe(1)
  })

  it('adds exactly the minimum threat when not understaffed', () => {
    const { s, m } = setup()
    for (let i = 0; i < 5; i++) tick(s)
    expect(m.threatBar).toBe(15) // 5 ticks × min 3
    expect(m.threatLevel).toBe(0)
  })

  it('overflows at the cap: level +1, bar keeps remainder, someone takes damage', () => {
    const { s, m, a, b, c } = setup()
    for (let i = 0; i < 6; i++) tick(s) // 18 ≥ cap → wraps to 0
    expect(m.threatLevel).toBe(1)
    expect(m.threatBar).toBe(18 - THREAT_CAP)
    const totalHp = a.hp + b.hp + c.hp
    expect(totalHp).toBeLessThan(3 * 99) // consequence dealt ≥1 damage
  })

  it('records bonds and sends the squad homebound on completion', () => {
    const { s, a, b, c } = setup()
    for (let i = 0; i < 20; i++) tick(s)
    expect(s.bonds[`${a.id}-${b.id}`]).toBe(1)
    expect(s.bonds[`${b.id}-${c.id}`]).toBe(1)
    expect(s.homebound).toHaveLength(3)
    expect(s.homebound[0].arriveAt).toBe(20 + REINFORCE_TRAVEL)
    for (let i = 0; i <= REINFORCE_TRAVEL; i++) tick(s)
    expect(s.homebound).toHaveLength(0)
  })
})

describe('death and mission failure', () => {
  it('kills a merc at 0 hp and fails the mission when the squad wipes', () => {
    const s = newRun(2)
    s.mercs = []
    s.reputation = 10
    const weak = addMerc(s, 1, 'forest', 1) // 1 hp, rank 1 on a 5★ job: doomed
    addMission(s, 5, [weak.id])
    let guard = 0
    while (s.missions.length > 0 && guard++ < 500) tick(s)
    expect(s.mercs).toHaveLength(0)
    expect(s.stats.mercsLost).toBe(1)
    expect(s.stats.jobsFailed).toBe(1)
    expect(s.reputation).toBe(5) // 10 − rating
  })
})

describe('idle healing', () => {
  it('heals hurt idle mercs 1 hp per HEAL_INTERVAL ticks, capped at maxHp', () => {
    const s = newRun(3)
    s.mercs = []
    const m = addMerc(s, 1, 'urban', 20)
    m.hp = 18
    for (let i = 0; i < 25; i++) tick(s)
    expect(m.hp).toBe(20)
  })
})
