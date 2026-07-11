import { describe, it, expect } from 'vitest'
import { newRun } from '../../src/sim/tick'
import { dismiss, buySlot, buySeat, medbayHeal, dispatch, idleMercIds } from '../../src/sim/actions'
import type { GameState, Offer } from '../../src/sim/types'
import { SLOT_PRICES, SEAT_PRICES, MAX_ROSTER_SLOTS, MAX_SEATS, MEDBAY_PER_HP, STARTING_SEATS } from '../../src/sim/balance'

function jobOffer(state: GameState): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'job', source: 'job1', postedAt: state.tick, expiresAt: state.tick + 60,
    job: { rating: 1, environment: 'urban', payout: 150, work: 100 },
  }
  state.seated.push(o)
  return o
}

describe('dismiss', () => {
  it('removes an idle merc', () => {
    const s = newRun(20)
    dismiss(s, s.mercs[0].id)
    expect(s.mercs).toHaveLength(1)
  })

  it('refuses to dismiss a deployed merc', () => {
    const s = newRun(21)
    const o = jobOffer(s)
    const [first] = idleMercIds(s)
    dispatch(s, o.id, [first])
    expect(() => dismiss(s, first)).toThrow(/idle/i)
  })
})

describe('purchases', () => {
  it('sells slots at escalating prices up to the max', () => {
    const s = newRun(22)
    s.cash = 10000
    buySlot(s); buySlot(s); buySlot(s)
    expect(s.rosterSlots).toBe(MAX_ROSTER_SLOTS)
    expect(s.cash).toBe(10000 - SLOT_PRICES.reduce((a, b) => a + b, 0))
    expect(() => buySlot(s)).toThrow(/max/i)
  })

  it('sells seats at escalating prices up to the max', () => {
    const s = newRun(23)
    s.cash = 100000
    expect(s.waitingSeats).toBe(STARTING_SEATS) // 1
    for (let i = 0; i < MAX_SEATS - STARTING_SEATS; i++) buySeat(s)
    expect(s.waitingSeats).toBe(MAX_SEATS) // 5
    expect(s.cash).toBe(100000 - SEAT_PRICES.reduce((a, b) => a + b, 0))
    expect(() => buySeat(s)).toThrow(/max/i)
  })

  it('refuses purchases without cash', () => {
    const s = newRun(24)
    s.cash = 0
    expect(() => buySlot(s)).toThrow(/cash|afford/i)
    expect(() => buySeat(s)).toThrow(/cash|afford/i)
  })
})

describe('medbayHeal', () => {
  it('charges per missing hp and fills to max', () => {
    const s = newRun(25)
    s.cash = 1000
    const m = s.mercs[0]
    m.hp = m.maxHp - 8
    const paid = medbayHeal(s, m.id)
    expect(paid).toBe(8 * MEDBAY_PER_HP)
    expect(m.hp).toBe(m.maxHp)
    expect(s.cash).toBe(1000 - paid)
  })

  it('throws at full hp', () => {
    const s = newRun(26)
    expect(() => medbayHeal(s, s.mercs[0].id)).toThrow(/full/i)
  })
})
