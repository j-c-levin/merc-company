export interface Rng {
  next(): number
  int(min: number, max: number): number
  getState(): number
  setState(s: number): void
}

/** mulberry32 — tiny, fast, good-enough PRNG with a single uint32 of state. */
export function createRng(seedOrState: number): Rng {
  let state = seedOrState >>> 0
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    int(min, max) {
      return min + Math.floor(this.next() * (max - min + 1))
    },
    getState: () => state,
    setState(s) { state = s >>> 0 },
  }
}
