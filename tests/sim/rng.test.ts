import { describe, it, expect } from 'vitest'
import { createRng } from '../../src/sim/rng'

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()])
  })

  it('produces values in [0,1)', () => {
    const rng = createRng(1)
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int(min,max) is inclusive on both ends and hits both', () => {
    const rng = createRng(7)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(rng.int(1, 3))
    expect([...seen].sort()).toEqual([1, 2, 3])
  })

  it('state round-trips: resuming from getState continues the same sequence', () => {
    const a = createRng(99)
    a.next(); a.next()
    const s = a.getState()
    const expected = [a.next(), a.next()]
    const b = createRng(0)
    b.setState(s)
    expect([b.next(), b.next()]).toEqual(expected)
  })
})
