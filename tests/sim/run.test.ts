import { describe, it, expect } from 'vitest'
import { newRun, tick } from '../../src/sim/tick'
import { CYCLE_LENGTH } from '../../src/sim/balance'

describe('deadline', () => {
  it('wins at the deadline when cash covers the loan', () => {
    const s = newRun(40)
    s.cash = s.loan
    for (let i = 0; i < CYCLE_LENGTH; i++) tick(s)
    expect(s.status).toBe('won')
  })

  it('loses at the deadline when cash falls short', () => {
    const s = newRun(41)
    s.cash = 0
    s.offers = []
    s.nextOfferAt = CYCLE_LENGTH + 999 // no income possible
    for (let i = 0; i < CYCLE_LENGTH; i++) tick(s)
    expect(s.status).toBe('lost')
  })

  it('freezes after the run ends', () => {
    const s = newRun(42)
    s.cash = s.loan
    for (let i = 0; i < CYCLE_LENGTH + 50; i++) tick(s)
    expect(s.tick).toBe(CYCLE_LENGTH)
  })
})

describe('determinism and serialization', () => {
  it('same seed → identical state after many ticks', () => {
    const a = newRun(77), b = newRun(77)
    for (let i = 0; i < 300; i++) { tick(a); tick(b) }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('a JSON round-trip resumes the exact same future', () => {
    const a = newRun(78)
    for (let i = 0; i < 100; i++) tick(a)
    const b = JSON.parse(JSON.stringify(a))
    for (let i = 0; i < 100; i++) { tick(a); tick(b) }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
