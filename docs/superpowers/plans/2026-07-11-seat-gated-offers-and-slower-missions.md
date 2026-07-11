# Seat-Gated Offers + 30% Slower Missions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make missions take 30% longer at unchanged lethality, and replace the door/queue/credit offer pump with a seat-gated waiting room where offers arrive only when a seat is free.

**Architecture:** Change 2 is pure `balance.ts` tuning — scale the work bar and the threat cap together so per-mission consequence count (and thus survivability) is preserved. Change 1 deletes `door`/`queue`/`timers` from `GameState`, adds a single `nextOfferAt` scheduler, and rewrites `pumpOffers` to emit one weighted-by-rank offer into a free seat per due tick. Actions, `newRun`, the harness bot, and the UI all move from "door + seats" to "seats only".

**Tech Stack:** TypeScript, Svelte 5 (runes), Vite 8, vitest (pure-node sim tests), seeded mulberry32 RNG. The sim is pure, deterministic, JSON-serializable — no DOM, no `Math.random`/`Date.now`.

## Global Constraints

- All game logic lives in `src/sim/`; `src/ui/` computes no game logic. Balance edits touch `src/sim/balance.ts` only (plus the tests/harness that assert on it).
- No `Math.random()` / `Date.now()`; all randomness flows through the `Rng` passed into sim functions. All offer RNG is consumed in `pumpOffers` and only there.
- `GameState` holds no classes/Maps/functions and must stay JSON-serializable. Any shape change bumps `SCHEMA_VERSION` in `balance.ts` (old saves are discarded, not migrated).
- Determinism is a hard invariant: same seed + same actions at the same ticks → byte-identical `JSON.stringify(state)`.
- Every throw path of a sim action must be covered by a disabled/hidden button — the UI has no try/catch.
- Verify with `npm test` (vitest), `npm run check` (svelte-check + tsc), `npm run sim -- scenario` and `npm run sim -- offers` (balance harness). The binding balance gates live in `tests/sim/harness.test.ts`.

---

## Task 1: 30% slower missions at unchanged lethality

**Files:**
- Modify: `src/sim/balance.ts` (constants)
- Modify: `tests/sim/projection.test.ts` (duration expectations)
- Modify: `tests/sim/tick.test.ts` (cap-overflow expectation → cap-agnostic)
- Test: `tests/sim/harness.test.ts` scenario gates must keep passing **unchanged**

**Interfaces:**
- Consumes: nothing new.
- Produces: `WORK_PER_RATING = 39`, `THREAT_CAP = 23` (or 24), `DANGER_THREAT = 15`. `content.ts` and `projection.ts` already read these — no logic change there.

**Why this holds survivability:** a mission lasts `workRequired / power` ticks; the per-tick threat increment is independent of both `WORK_PER_RATING` and `THREAT_CAP`. Consequence events per mission ≈ `(threat/tick) × ticks / THREAT_CAP`. Scaling work ×1.3 and cap ×1.3 cancels — same consequence count, same damage, same survivability, 30% longer.

- [ ] **Step 1: Update projection duration expectations to the WORK=39 world (RED first)**

In `tests/sim/projection.test.ts`, change the two duration literals and their comments. The consequence-count assertions stay (they prove the cap-scaling preserves them):

```ts
    // first test (3★, power 15):
    expect(p.durationTicks).toBe(8) // ceil(3×39 / 15)
    // over-staffed team on a 3★: min == expected == max == floor(8×3 / THREAT_CAP) = 1
    expect(p.minConsequences).toBe(1)
    expect(p.expectedConsequences).toBe(1)
    expect(p.maxConsequences).toBe(1)
```

```ts
    // second test (understaffed, power 2):
    expect(p.durationTicks).toBe(59) // ceil(3×39 / 2)
```

- [ ] **Step 2: Run projection tests to see them fail against the current code**

Run: `npx vitest run tests/sim/projection.test.ts`
Expected: FAIL — current code yields `durationTicks` 6 and 45 (WORK_PER_RATING still 30).

- [ ] **Step 3: Make the tick cap-overflow test cap-agnostic (stays green under cap 18)**

In `tests/sim/tick.test.ts`, replace the body of the `'overflows at the cap: level +1, bar keeps remainder, someone takes damage'` test so it derives the tick count from `THREAT_CAP` (min threat is 3/tick for this over-staffed 3★ setup):

```ts
  it('overflows at the cap: level +1, bar keeps remainder, someone takes damage', () => {
    const { s, m, a, b, c } = setup()
    const ticks = Math.ceil(THREAT_CAP / 3) // 3/tick minimum threat crosses the cap once
    for (let i = 0; i < ticks; i++) tick(s)
    expect(m.threatLevel).toBe(1)
    expect(m.threatBar).toBe(ticks * 3 - THREAT_CAP)
    const totalHp = a.hp + b.hp + c.hp
    expect(totalHp).toBeLessThan(3 * 99) // consequence dealt ≥1 damage
  })
```

Run: `npx vitest run tests/sim/tick.test.ts`
Expected: PASS (still on cap 18: ticks=6, remainder 0 — same as before).

- [ ] **Step 4: Apply the balance constants**

In `src/sim/balance.ts`:

```ts
export const WORK_PER_RATING = 39      // design anchor: 30% longer missions
export const THREAT_CAP = 23           // design anchor: scaled ~×1.3 with work so per-mission consequence count holds
export const DANGER_THREAT = 15        // UI "hot" marker, kept at ~⅔ of the cap
```

Leave `THREAT_BASE_PER_RATING = 3` and `CONSEQUENCE_SPREAD = 2` unchanged.

- [ ] **Step 5: Run the sim + projection + tick tests**

Run: `npx vitest run tests/sim/projection.test.ts tests/sim/tick.test.ts`
Expected: PASS (projection now 8/59; tick cap-overflow: ticks=8, remainder `24 − 23 = 1`, level 1).

- [ ] **Step 6: Verify survivability bands hold, pick the cap**

Run: `npm run sim -- scenario`
Expected: numbers land inside the existing `harness.test.ts` bands — 2 fresh 1★ mercs ≥90% success / ≤2% any-death; solo 1★ 55–75% success / ≤10% any-death. If any band is missed, set `THREAT_CAP = 24` and re-run; keep whichever value best reproduces the bands. Do **not** edit the bands in `harness.test.ts`.

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: all pass (82). `content.test.ts`'s `work).toBe(3 * WORK_PER_RATING)` follows the constant automatically.

- [ ] **Step 8: Commit**

```bash
git add src/sim/balance.ts tests/sim/projection.test.ts tests/sim/tick.test.ts
git commit -m "feat: missions take 30% longer at unchanged lethality

Scale WORK_PER_RATING 30->39 and THREAT_CAP 18->23 together so per-mission
consequence count (and survivability) is preserved while duration grows 30%."
```

---

## Task 2: Seat-gated offer arrivals (model rewrite)

Atomic migration off `door`/`queue`/`timers` to a seat-gated waiting room. Touches the sim core, the harness bot, the UI, and the offer tests together so the tree stays green (`npm test` **and** `npm run check`) at the end.

**Files:**
- Modify: `src/sim/types.ts` (drop `door`/`queue`/`timers`; add `nextOfferAt`)
- Modify: `src/sim/balance.ts` (seat constants, `SCHEMA_VERSION`)
- Rewrite: `src/sim/offers.ts` (seat-gated pump + weighted picker)
- Modify: `src/sim/actions.ts` (seated-only; drop `seatOffer`; `SEAT_PRICES`)
- Modify: `src/sim/tick.ts` (`newRun` seats the opening offer)
- Modify: `scripts/simulate.ts` (`botAct`, `runMissionScenario`, `measureOfferMix`)
- Modify: `src/ui/JobsTab.svelte` (one seat list, TTL on every card)
- Modify: `src/ui/DispatchSheet.svelte` (`offerAlive` seated-only)
- Rewrite: `tests/sim/offers.test.ts` (seat model)
- Modify: `tests/sim/run.test.ts`, `tests/sim/roster.test.ts`, `tests/sim/content.test.ts` (fixups)

**Interfaces:**
- Consumes: `newRun`, `tick`, `generateJob`/`generateCandidate`, `Rng`.
- Produces (exact signatures other steps rely on):
  - `GameState.nextOfferAt: number` — tick the next offer is scheduled; `0` means "unscheduled, reschedule me". `door`, `queue`, `timers` are **removed**.
  - `offers.ts`: `combinedInterval(reputation: number): number`, `arrivalInterval(reputation: number, rng: Rng): number`, `pickSource(reputation: number, rng: Rng): TimerKey`, `pumpOffers(state: GameState, rng: Rng): void`. `baseInterval`, `unlockedTimers`, `TIMER_KEYS` keep today's signatures. `creditHeld` and `ratesFor`-as-export are gone (`ratesFor` stays module-private).
  - `actions.ts`: `dispatch`/`hire`/`rejectOffer` operate on `state.seated` only; `seatOffer` is **removed**; `buySeat` uses `SEAT_PRICES`.
  - `balance.ts`: `STARTING_SEATS = 1`, `MAX_SEATS = 5`, `SEAT_PRICES: number[]` (replaces scalar `SEAT_PRICE`), `SCHEMA_VERSION = 4`.

- [ ] **Step 1: Rewrite the offer tests for the seat model (RED first)**

Replace the entire contents of `tests/sim/offers.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { newRun, tick } from '../../src/sim/tick'
import { rejectOffer, hire, dispatch, idleMercIds } from '../../src/sim/actions'
import type { GameState, Offer, TimerKey } from '../../src/sim/types'
import { OFFER_TTL_MIN, OFFER_TTL_MAX } from '../../src/sim/balance'
import { createRng } from '../../src/sim/rng'
import {
  TIMER_KEYS, unlockedTimers, baseInterval, combinedInterval,
  arrivalInterval, pickSource, pumpOffers,
} from '../../src/sim/offers'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER } from '../../src/sim/balance'

function jobOffer(state: GameState, rating = 1): Offer {
  return {
    id: state.nextId++, kind: 'job', source: `job${rating}` as TimerKey,
    postedAt: state.tick, expiresAt: state.tick + 60,
    job: { rating, environment: 'urban', payout: rating * rating * 150, work: rating * 100 },
  }
}
function candidateOffer(state: GameState): Offer {
  return {
    id: state.nextId++, kind: 'candidate', source: 'candidate',
    postedAt: state.tick, expiresAt: state.tick + 60,
    candidate: { id: state.nextId++, name: 'Rook Ash', klass: 'Scout', rank: 1, hp: 20, maxHp: 20, affinity: 'urban', hirePrice: 100 },
  }
}

describe('newRun opening offer', () => {
  it('seats a single 1★ job with its TTL running', () => {
    const s = newRun(10)
    expect(s.seated).toHaveLength(1)
    const o = s.seated[0]
    expect(o.kind).toBe('job')
    expect(o.source).toBe('job1')
    expect(o.job!.rating).toBe(1)
    expect(o.postedAt).toBe(0)
    expect(o.expiresAt).toBeGreaterThanOrEqual(OFFER_TTL_MIN)
    expect(o.expiresAt).toBeLessThanOrEqual(OFFER_TTL_MAX)
  })

  it('has no door/queue/timers fields, and a numeric nextOfferAt', () => {
    const s = newRun(10) as unknown as Record<string, unknown>
    expect(s.door).toBeUndefined()
    expect(s.queue).toBeUndefined()
    expect(s.timers).toBeUndefined()
    expect(typeof s.nextOfferAt).toBe('number')
  })
})

describe('seat-gated arrivals', () => {
  it('draws no new offer while every seat is full', () => {
    const s = newRun(10) // 1 seat, filled by the opening offer
    const id = s.seated[0].id
    for (let i = 0; i < OFFER_TTL_MIN - 1; i++) tick(s) // before the opening TTL can expire
    expect(s.seated).toHaveLength(1)
    expect(s.seated[0].id).toBe(id)
  })

  it('a freed seat draws the next offer', () => {
    const s = newRun(10)
    rejectOffer(s, s.seated[0].id) // free the only seat
    let filled = false
    for (let i = 0; i < 80 && !filled; i++) { tick(s); if (s.seated.length === 1) filled = true }
    expect(filled).toBe(true)
  })

  it('an expired offer frees its seat', () => {
    const s = newRun(10)
    const id = s.seated[0].id
    for (let i = 0; i <= OFFER_TTL_MAX; i++) tick(s)
    expect(s.seated.every(o => o.id !== id)).toBe(true) // opening offer is gone
  })

  it('fills toward a larger seat capacity but never past it', () => {
    const s = newRun(10)
    s.waitingSeats = 3
    rejectOffer(s, s.seated[0].id)
    let max = 0
    for (let i = 0; i < 300; i++) { tick(s); max = Math.max(max, s.seated.length) } // never act
    expect(max).toBeGreaterThan(1)
    expect(max).toBeLessThanOrEqual(3)
  })
})

describe('pumpOffers', () => {
  function pumpState(rep = 0): GameState {
    const s = newRun(50)
    s.reputation = rep
    s.seated = []
    s.nextOfferAt = 0
    return s
  }

  it('schedules the next arrival when none is pending, seating nothing yet', () => {
    const s = pumpState(0)
    pumpOffers(s, createRng(1))
    expect(s.nextOfferAt).toBeGreaterThan(s.tick)
    expect(s.seated).toHaveLength(0)
  })

  it('seats one offer when due and a seat is free, then reschedules', () => {
    const s = pumpState(0)
    s.nextOfferAt = s.tick
    pumpOffers(s, createRng(2))
    expect(s.seated).toHaveLength(1)
    expect(s.seated[0].postedAt).toBe(s.tick)
    expect(s.seated[0].expiresAt).toBeGreaterThan(s.tick)
    expect(s.nextOfferAt).toBe(0) // cleared → reschedules next tick
  })

  it('does not seat when due but all seats are full, keeping the due time', () => {
    const s = pumpState(0)
    s.waitingSeats = 1
    s.seated = [jobOffer(s)] // seat occupied
    s.nextOfferAt = s.tick
    pumpOffers(s, createRng(3))
    expect(s.seated).toHaveLength(1)
    expect(s.nextOfferAt).toBe(s.tick) // still due, arrives the instant a seat frees
  })

  it('expires a seated offer whose TTL ran out, freeing the seat', () => {
    const s = pumpState(0)
    s.waitingSeats = 1
    const stale = jobOffer(s)
    stale.expiresAt = s.tick // already due to expire
    s.seated = [stale]
    s.nextOfferAt = s.tick + 999 // nothing new arrives this pump
    pumpOffers(s, createRng(4))
    expect(s.seated).toHaveLength(0)
  })
})

describe('rank-shifted mix', () => {
  it('unlockedTimers starts with job1 and candidate only', () => {
    expect(unlockedTimers(0)).toEqual(['job1', 'candidate'])
  })

  it('unlocks each job tier at its unlockRep', () => {
    expect(unlockedTimers(3)).not.toContain('job2')
    expect(unlockedTimers(4)).toContain('job2')
    expect(unlockedTimers(16)).toEqual(TIMER_KEYS)
  })

  it('baseInterval runs atUnlock → ramped over REP_RAMP and clamps', () => {
    expect(baseInterval('job1', 0)).toBe(JOB_TIERS[0].atUnlock)
    expect(baseInterval('job1', REP_RAMP)).toBe(JOB_TIERS[0].ramped)
    expect(baseInterval('job1', 999)).toBe(JOB_TIERS[0].ramped)
    expect(baseInterval('candidate', 999)).toBe(CANDIDATE_ARRIVAL.ramped)
  })

  it('shifts the mix with rank: 1★ fades while 3★-5★ speed up', () => {
    expect(baseInterval('job1', 40)).toBeGreaterThan(baseInterval('job1', 0))
    for (const tier of [3, 4, 5]) {
      const { unlockRep } = JOB_TIERS[tier - 1]
      expect(baseInterval(`job${tier}` as TimerKey, unlockRep + REP_RAMP)).toBeLessThan(
        baseInterval(`job${tier}` as TimerKey, unlockRep),
      )
    }
  })

  it('combinedInterval is the harmonic aggregate of unlocked rates', () => {
    const expected = 1 / (1 / baseInterval('job1', 0) + 1 / baseInterval('candidate', 0))
    expect(combinedInterval(0)).toBeCloseTo(expected, 6)
  })

  it('arrivalInterval jitters around the combined center, integer, ≥ 1', () => {
    const rng = createRng(1)
    const center = combinedInterval(0)
    const lo = Math.floor(center * (1 - ARRIVAL_JITTER))
    const hi = Math.ceil(center * (1 + ARRIVAL_JITTER))
    for (let i = 0; i < 200; i++) {
      const v = arrivalInterval(0, rng)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(Math.max(1, lo))
      expect(v).toBeLessThanOrEqual(hi)
    }
  })

  it('pickSource only returns unlocked sources', () => {
    const rng = createRng(2)
    for (let i = 0; i < 200; i++) expect(unlockedTimers(8)).toContain(pickSource(8, rng))
  })

  it('pickSource at rep 0 yields only job1 among jobs', () => {
    const rng = createRng(3)
    for (let i = 0; i < 300; i++) {
      const k = pickSource(0, rng)
      if (k !== 'candidate') expect(k).toBe('job1')
    }
  })
})

describe('seated actions', () => {
  function seatJob(s: GameState, rating = 1): Offer { const o = jobOffer(s, rating); s.seated.push(o); return o }
  function seatCand(s: GameState): Offer { const o = candidateOffer(s); s.seated.push(o); return o }

  it('rejecting frees the seat', () => {
    const s = newRun(13)
    const a = seatJob(s)
    rejectOffer(s, a.id)
    expect(s.seated.some(o => o.id === a.id)).toBe(false)
  })

  it('hire moves the candidate into the roster and charges cash', () => {
    const s = newRun(14)
    s.seated = []
    const o = seatCand(s)
    const cash = s.cash
    hire(s, o.id)
    expect(s.mercs).toHaveLength(3)
    expect(s.cash).toBe(cash - 100)
    expect(s.seated.some(x => x.id === o.id)).toBe(false)
  })

  it('hire throws when the roster is full', () => {
    const s = newRun(15)
    s.rosterSlots = 2
    const o = seatCand(s)
    expect(() => hire(s, o.id)).toThrow(/roster/i)
  })

  it('dispatch creates a mission from a seated job and frees the seat', () => {
    const s = newRun(17)
    s.seated = []
    const o = seatJob(s, 2)
    const squad = idleMercIds(s)
    const missionId = dispatch(s, o.id, squad)
    const m = s.missions.find(x => x.id === missionId)!
    expect(m.squad).toEqual(squad)
    expect(m.workRequired).toBe(200) // fixture work = rating × 100
    expect(s.seated.some(x => x.id === o.id)).toBe(false)
  })

  it('dispatch refuses mercs already deployed', () => {
    const s = newRun(18)
    s.seated = []
    const squad = idleMercIds(s)
    dispatch(s, seatJob(s).id, squad)
    expect(() => dispatch(s, seatJob(s).id, squad)).toThrow(/idle/i)
  })

  it('dispatch refuses an empty squad', () => {
    const s = newRun(19)
    s.seated = []
    expect(() => dispatch(s, seatJob(s).id, [])).toThrow(/empty/i)
  })
})

describe('determinism', () => {
  it('same seed → identical state after many ticks (offers included)', () => {
    const a = newRun(77), b = newRun(77)
    for (let i = 0; i < 200; i++) { tick(a); tick(b) }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('player actions consume no RNG', () => {
    const s = newRun(13)
    const before = s.rngState
    rejectOffer(s, s.seated[0].id)
    expect(s.rngState).toBe(before)
  })
})
```

- [ ] **Step 2: Run the new offer tests to confirm they fail**

Run: `npx vitest run tests/sim/offers.test.ts`
Expected: FAIL — `combinedInterval`/`pickSource` are undefined, `nextOfferAt` missing, `arrivalInterval` has the old 3-arg signature.

- [ ] **Step 3: Update `GameState` in `src/sim/types.ts`**

Remove the `door`, `queue`, `timers` fields and add `nextOfferAt`. Update the `Offer` comments that mention the queue/credit. The `seated`, `Offer`, `TimerKey` shapes are otherwise unchanged:

```ts
export interface Offer {
  id: number
  kind: 'job' | 'candidate'
  source: TimerKey // which timer/tier this offer represents; used for the offer-mix harness
  postedAt: number // tick the offer took its seat
  expiresAt: number // tick at which it auto-rejects (times out) and frees the seat
  job?: JobDetails
  candidate?: Merc
}
```

In `GameState`, replace the three offer-pump fields:

```ts
  seated: Offer[] // the waiting room: one offer per seat, capped at waitingSeats
  nextOfferAt: number // tick the next offer is scheduled to arrive; 0 = reschedule me
```

(Delete the `door`, `queue`, and `timers` lines.)

- [ ] **Step 4: Update `src/sim/balance.ts` seat constants + schema version**

```ts
export const SCHEMA_VERSION = 4
```

```ts
export const STARTING_SEATS = 1
export const MAX_SEATS = 5
export const SEAT_PRICES = [250, 400, 600, 900] // seats 2..5, escalating like SLOT_PRICES
```

(Delete the old `STARTING_SEATS = 2`, `MAX_SEATS = 3`, and `SEAT_PRICE = 250` lines.)

- [ ] **Step 5: Rewrite `src/sim/offers.ts`**

Replace the whole file with the seat-gated pump:

```ts
import type { GameState, Offer, TimerKey } from './types'
import type { Rng } from './rng'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER, OFFER_TTL_MIN, OFFER_TTL_MAX } from './balance'
import { generateJob, generateCandidate } from './content'

/** Fixed source order; determinism relies on it when weights are equal. */
export const TIMER_KEYS: TimerKey[] = ['job1', 'job2', 'job3', 'job4', 'job5', 'candidate']

function ratesFor(key: TimerKey): { unlockRep: number; atUnlock: number; ramped: number } {
  if (key === 'candidate') return { unlockRep: 0, ...CANDIDATE_ARRIVAL }
  return JOB_TIERS[Number(key.slice(3)) - 1]
}

export function unlockedTimers(reputation: number): TimerKey[] {
  return TIMER_KEYS.filter(key => reputation >= ratesFor(key).unlockRep)
}

/** Deterministic center interval for a single source: atUnlock at unlockRep,
 *  ramping to ramped over REP_RAMP reputation, then clamped. */
export function baseInterval(key: TimerKey, reputation: number): number {
  const { unlockRep, atUnlock, ramped } = ratesFor(key)
  const t = Math.min(1, Math.max(0, (reputation - unlockRep) / REP_RAMP))
  return atUnlock + (ramped - atUnlock) * t
}

/** Aggregate cadence of all unlocked sources — the harmonic sum of their
 *  individual rates, i.e. how often *some* offer would arrive under the old
 *  independent-timer model. Seats then throttle actual arrivals. */
export function combinedInterval(reputation: number): number {
  const rate = unlockedTimers(reputation).reduce((sum, key) => sum + 1 / baseInterval(key, reputation), 0)
  return rate > 0 ? 1 / rate : Infinity
}

/** Whole-tick interval until the next arrival, jittered ±ARRIVAL_JITTER. */
export function arrivalInterval(reputation: number, rng: Rng): number {
  const jitter = 1 + (rng.next() * 2 - 1) * ARRIVAL_JITTER
  return Math.max(1, Math.round(combinedInterval(reputation) * jitter))
}

/** Pick the next offer's source, weighted by each unlocked source's rate at
 *  this reputation. Preserves the rank-shifted mix without new constants. */
export function pickSource(reputation: number, rng: Rng): TimerKey {
  const keys = unlockedTimers(reputation)
  const weights = keys.map(key => 1 / baseInterval(key, reputation))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng.next() * total
  for (let i = 0; i < keys.length; i++) {
    r -= weights[i]
    if (r < 0) return keys[i]
  }
  return keys[keys.length - 1]
}

function generateFor(state: GameState, rng: Rng, key: TimerKey): Offer {
  return key === 'candidate'
    ? generateCandidate(state, rng)
    : generateJob(state, rng, Number(key.slice(3)))
}

/** Per-tick pump for the seat-gated waiting room. Order matters:
 *  1 expire → 2 schedule → 3 arrive. A seat freed this tick (by expiry) can be
 *  filled this tick. All offer RNG is consumed here and only here. */
export function pumpOffers(state: GameState, rng: Rng): void {
  // 1. expire seated offers whose TTL ran out (frees seats)
  state.seated = state.seated.filter(o => o.expiresAt > state.tick)

  // 2. schedule the next arrival if none is pending (0 = unscheduled)
  if (!state.nextOfferAt) {
    state.nextOfferAt = state.tick + arrivalInterval(state.reputation, rng)
  }

  // 3. arrive: only when due AND a seat is free (else it stays due for later)
  if (state.nextOfferAt <= state.tick && state.seated.length < state.waitingSeats) {
    const offer = generateFor(state, rng, pickSource(state.reputation, rng))
    offer.postedAt = state.tick
    offer.expiresAt = state.tick + rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)
    state.seated.push(offer)
    state.nextOfferAt = 0 // reschedule next tick
  }
}
```

- [ ] **Step 6: Update `src/sim/actions.ts` for the seated-only model**

Change the import line from `SEAT_PRICE` to `SEAT_PRICES` and add `STARTING_SEATS`:

```ts
import {
  SLOT_PRICES, SEAT_PRICES, MAX_ROSTER_SLOTS, MAX_SEATS,
  MEDBAY_PER_HP, STARTING_ROSTER_SLOTS, STARTING_SEATS,
  MEDKIT, SUPPRESSOR, STIM, REINFORCE_TRAVEL, SUPPLY_TRAVEL,
} from './balance'
```

Replace `takeOffer` and delete `seatOffer`:

```ts
function takeOffer(state: GameState, offerId: number): Offer {
  const offer = state.seated.find(o => o.id === offerId)
  if (!offer) throw new Error(`no offer ${offerId}`)
  state.seated = state.seated.filter(o => o.id !== offerId)
  return offer
}

export function rejectOffer(state: GameState, offerId: number): void {
  takeOffer(state, offerId)
}
```

In `hire` and `dispatch`, change the offer lookup from the door/seated pair to seated-only:

```ts
export function hire(state: GameState, offerId: number): void {
  const offer = state.seated.find(o => o.id === offerId)
  if (!offer || offer.kind !== 'candidate') throw new Error(`no candidate offer ${offerId}`)
  // ...unchanged body...
```

```ts
export function dispatch(state: GameState, offerId: number, mercIds: number[]): number {
  const offer = state.seated.find(o => o.id === offerId)
  if (!offer || offer.kind !== 'job') throw new Error(`no job offer ${offerId}`)
  // ...unchanged body...
```

Update `buySeat` to the escalating price:

```ts
export function buySeat(state: GameState): void {
  if (state.waitingSeats >= MAX_SEATS) throw new Error('seats at max')
  const price = SEAT_PRICES[state.waitingSeats - STARTING_SEATS]
  if (state.cash < price) throw new Error('cannot afford seat')
  state.cash -= price
  state.waitingSeats++
}
```

- [ ] **Step 7: Update `newRun` in `src/sim/tick.ts`**

In the state literal, delete `door: null`, `queue: []`, `timers: {}` and set the seat fields. Then seat the opening offer:

```ts
    seated: [],
    nextOfferAt: 0,
```

Replace the opening block:

```ts
  state.mercs.push(generateMerc(state, rng), generateMerc(state, rng))
  // opening: a 1★ job already sits in the single starting seat, TTL running
  const opening = generateJob(state, rng, 1)
  opening.postedAt = 0
  opening.expiresAt = rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)
  state.seated.push(opening)
  // nextOfferAt stays 0; the first pump schedules it. The seat is full, so
  // nothing new arrives until the player clears the opening offer.
  state.rngState = rng.getState()
  return state
```

(`OFFER_TTL_MIN`/`OFFER_TTL_MAX` are already imported in this file.)

- [ ] **Step 8: Run the sim-core tests**

Run: `npx vitest run tests/sim/offers.test.ts tests/sim/tick.test.ts`
Expected: `offers.test.ts` PASS. `tick.test.ts` PASS (it never touched door/queue). If `newRun` determinism drifts, confirm `pumpOffers` consumes RNG only inside the scheduled/arrival branches.

- [ ] **Step 9: Fix `tests/sim/run.test.ts` (silence the pump via the new shape)**

In the `'loses at the deadline when cash falls short'` test, replace the three pump-silencing lines:

```ts
    const s = newRun(41)
    s.cash = 0
    s.seated = []
    s.nextOfferAt = CYCLE_LENGTH + 999 // no offer ever arrives → no income possible
```

(Delete the `s.door = null`, `s.queue = []`, `s.timers = {...}` lines.)

- [ ] **Step 10: Fix `tests/sim/roster.test.ts` (seat the fixture; new seat-growth test)**

Change the import: `SEAT_PRICE` → `SEAT_PRICES`, and `STARTING_SEATS`:

```ts
import { SLOT_PRICES, SEAT_PRICES, MAX_ROSTER_SLOTS, MAX_SEATS, MEDBAY_PER_HP, STARTING_SEATS } from '../../src/sim/balance'
```

Change the `jobOffer` helper to seat the offer instead of putting it at the door:

```ts
function jobOffer(state: GameState): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'job', source: 'job1', postedAt: state.tick, expiresAt: state.tick + 60,
    job: { rating: 1, environment: 'urban', payout: 150, work: 100 },
  }
  state.seated.push(o)
  return o
}
```

Replace the `'sells the third seat once'` test with the 1→5 growth path:

```ts
  it('sells seats at escalating prices up to the max', () => {
    const s = newRun(23)
    s.cash = 100000
    expect(s.waitingSeats).toBe(STARTING_SEATS) // 1
    for (let i = 0; i < MAX_SEATS - STARTING_SEATS; i++) buySeat(s)
    expect(s.waitingSeats).toBe(MAX_SEATS) // 5
    expect(s.cash).toBe(100000 - SEAT_PRICES.reduce((a, b) => a + b, 0))
    expect(() => buySeat(s)).toThrow(/max/i)
  })
```

(The `'refuses purchases without cash'` test still works — `buySeat` throws on cash with 1 free seat.)

- [ ] **Step 11: Fix the comment in `tests/sim/content.test.ts`**

The generation behavior is unchanged (TTL stamped on seating, not generation), so only the comment is stale. Change the test title/comment `'...until door promotion'` to `'...until it is seated'`. No assertion changes.

- [ ] **Step 12: Update `scripts/simulate.ts` (bot + harness)**

Change the import (drop `seatOffer`):

```ts
import { hire, dispatch, sendSupply, buySlot, medbayHeal, idleMercIds, withdraw, rejectOffer } from '../src/sim/actions'
```

In `botAct`: delete the `const doorOffers = ...` line at the top; iterate `state.seated` directly in steps 1 and 4; and **delete step 5 entirely** (the seat-the-best block — seating is automatic now):

```ts
export function botAct(state: GameState): void {
  // 1. hire affordable candidates when a slot is free
  for (const offer of state.seated) {
    if (offer.kind !== 'candidate') continue
    if (state.mercs.length >= state.rosterSlots) break
    if (state.cash - offer.candidate!.hirePrice >= RESERVE) hire(state, offer.id)
  }
  // 2. grow the company (unchanged)
  // ...
  // 3. medbay (unchanged)
  // ...
  // 4. dispatch all idle mercs to the best seated job they can nearly fully staff
  const idle = idleMercIds(state)
  if (idle.length > 0) {
    const jobs = state.seated
      .filter(o => o.kind === 'job')
      .sort((a, b) => b.job!.rating - a.job!.rating)
    for (const offer of jobs) {
      const p = project(state, idle, offer.job!.rating, offer.job!.environment)
      if (p.shortfall <= 1) { dispatch(state, offer.id, idle); break }
    }
  }
  // 5. (deleted — offers seat themselves; no manual seating)
  // 6. suppress missions about to tick over (unchanged)
  // ...
}
```

In `runMissionScenario`, replace the pump-silencing + door setup:

```ts
    const s = newRun(seed) // two fresh rank-1 mercs, random affinities
    s.seated = []
    s.nextOfferAt = CYCLE_LENGTH * 10 // the pump never arrives during the mission
    const rng = createRng(seed * 7919)
    const offer = generateJob(s, rng, 1)
    offer.expiresAt = CYCLE_LENGTH
    s.seated.push(offer)
    const squad = s.mercs.slice(0, squadSize).map(m => m.id)
    const missionId = dispatch(s, offer.id, squad)
```

In `measureOfferMix`, count arrivals into `seated` (reject each so the seat frees) instead of reading the door:

```ts
export function measureOfferMix(rep: number, ticks = 1400, seeds = 10): OfferMix {
  const bySource: Record<string, number> = {}
  for (let seed = 1; seed <= seeds; seed++) {
    const s = newRun(seed)
    s.reputation = rep
    s.mercs = []
    s.seated = []      // drop the opening offer; count from a clean pump
    s.nextOfferAt = 0
    for (let i = 0; i < ticks && s.status === 'running'; i++) {
      tick(s)
      for (const o of [...s.seated]) {
        bySource[o.source] = (bySource[o.source] ?? 0) + 1
        rejectOffer(s, o.id) // free the seat so the next offer can arrive
      }
    }
  }
  // ...rest of the function (jobKeys/jobShare/jobsPer100) unchanged...
}
```

- [ ] **Step 13: Update the UI — `src/ui/JobsTab.svelte`**

Collapse the two sections into one seat list where every card shows the TTL. Replace the whole file:

```svelte
<script lang="ts">
  import { game, act } from './store.svelte'
  import { rejectOffer, hire, buySeat, idleMercIds } from '../sim/actions'
  import { project } from '../sim/projection'
  import { SEAT_PRICES, MAX_SEATS, STARTING_SEATS } from '../sim/balance'
  import type { Offer } from '../sim/types'
  import DispatchSheet from './DispatchSheet.svelte'

  let dispatching: Offer | null = $state(null)

  const seatPrice = $derived(SEAT_PRICES[game.state.waitingSeats - STARTING_SEATS] ?? 0)

  function ttl(offer: Offer): number {
    return Math.max(0, offer.expiresAt - game.state.tick)
  }

  function ttlPct(offer: Offer): number {
    const total = offer.expiresAt - offer.postedAt
    if (total <= 0) return 0
    const pct = ((offer.expiresAt - game.state.tick) / total) * 100
    return Math.max(0, Math.min(100, pct))
  }

  function estimatedDuration(offer: Offer): string {
    const idle = idleMercIds(game.state)
    if (idle.length === 0) return '—'
    const proj = project(game.state, idle, offer.job!.rating, offer.job!.environment)
    if (!Number.isFinite(proj.durationTicks)) return '—'
    return `~${proj.durationTicks}s with your idle crew`
  }
</script>

<section>
  <h3 class="dim">waiting room ({game.state.seated.length}/{game.state.waitingSeats})</h3>
  {#each game.state.seated as offer (offer.id)}
    {@render offerCard(offer)}
  {/each}
  {#if game.state.seated.length === 0}
    <p class="dim">no offers waiting — a free seat draws the next one</p>
  {/if}
  {#if game.state.waitingSeats < MAX_SEATS}
    <button class="ghost" disabled={game.state.cash < seatPrice} onclick={() => act(() => buySeat(game.state))}>
      add a seat — {seatPrice}cr
    </button>
  {/if}
</section>

{#if dispatching}
  <DispatchSheet offer={dispatching} onclose={() => (dispatching = null)} />
{/if}

{#snippet offerCard(offer: Offer)}
  <div class="card">
    {#if offer.kind === 'job'}
      <div class="row">
        <strong>{'★'.repeat(offer.job!.rating)} job · {offer.job!.environment}</strong>
        <span class="payout">{offer.job!.payout}cr</span>
      </div>
      <div class="dim">{estimatedDuration(offer)}</div>
    {:else}
      <div class="row">
        <strong>{offer.candidate!.name}</strong>
        <span class="dim">{offer.candidate!.klass} · {'★'.repeat(offer.candidate!.rank)} · {offer.candidate!.affinity}</span>
      </div>
      <div class="row dim"><span>hire for {offer.candidate!.hirePrice}cr</span></div>
    {/if}
    <div class="bar"><div style="width:{ttlPct(offer)}%; background:var(--danger)"></div></div>
    <div class="dim">{ttl(offer)}s before they walk</div>
    <div class="row">
      {#if offer.kind === 'job'}
        <button class="action" onclick={() => (dispatching = offer)}>accept</button>
      {:else}
        <button
          class="action"
          disabled={game.state.mercs.length >= game.state.rosterSlots || game.state.cash < offer.candidate!.hirePrice}
          onclick={() => act(() => hire(game.state, offer.id))}
        >hire</button>
      {/if}
      <button class="ghost" onclick={() => act(() => rejectOffer(game.state, offer.id))}>reject</button>
    </div>
  </div>
{/snippet}

<style>
  .row { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .payout { color: var(--accent); font-weight: 700; }
  section { margin-bottom: 1.2rem; }
  h3 { margin: 0 0 0.5rem; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
</style>
```

- [ ] **Step 14: Update the UI — `src/ui/DispatchSheet.svelte`**

`offerAlive` no longer has a door to check:

```ts
  const offerAlive = $derived(game.state.seated.some(o => o.id === offer.id))
```

- [ ] **Step 15: Full type + test sweep**

Run: `npm run check`
Expected: PASS — no dangling `door`/`queue`/`timers`/`seatOffer`/`SEAT_PRICE` references in app or scripts.

Run: `npm test`
Expected: PASS for every sim test. `harness.test.ts`'s offer-mix rate gate is addressed in Task 3; if it fails here on `jobsPer100`, leave it red and resolve it in Task 3 Step 2. All other suites must be green.

- [ ] **Step 16: Commit**

```bash
git add src/sim/types.ts src/sim/balance.ts src/sim/offers.ts src/sim/actions.ts src/sim/tick.ts \
  scripts/simulate.ts src/ui/JobsTab.svelte src/ui/DispatchSheet.svelte \
  tests/sim/offers.test.ts tests/sim/run.test.ts tests/sim/roster.test.ts tests/sim/content.test.ts
git commit -m "feat: seat-gated offer arrivals

Replace door/queue/credit pump with a single-scheduler waiting room: offers
arrive only when a seat is free, occupy a seat while they wait, and time out or
are acted on to free it. Start 1 seat, grow to 5. Rank-shifted mix preserved via
rate-weighted source selection. Bumps SCHEMA_VERSION."
```

---

## Task 3: New-flow balance + end-to-end verification

**Files:**
- Modify: `tests/sim/harness.test.ts` (offer-mix rate gate for the seat model)
- Modify (if tuning needed): `src/sim/balance.ts` (`SEAT_PRICES`)
- Verify only: `src/sim/CLAUDE.md` numbers, browser flow

**Interfaces:**
- Consumes: `measureOfferMix`, `runOne` from `scripts/simulate.ts`.
- Produces: an offer-mix rate gate that reflects the seat-gated reality, with a comment noting the intent change.

- [ ] **Step 1: Measure the seat-gated offer mix**

Run: `npm run sim -- offers`
Expected: a table of `job offers/100 ticks` and per-tier shares by reputation. Record the rep-0 `jobsPer100` and confirm the mix intent still holds (rep 0 → 100% 1★; rep 24 → 1★ share small, 4★+5★ dominant).

- [ ] **Step 2: Set the offer-mix rate gate to reality**

In `tests/sim/harness.test.ts`, the `'early game: a steady stream of 1★ jobs'` test asserts `jobShare.job1 === 1` (keep) and `jobsPer100 >= 5`. Seat-gating intentionally throttles arrivals. If the measured rep-0 `jobsPer100` from Step 1 is ≥ 5, leave the gate at 5. If it is lower, set the threshold to `Math.floor(measured) - 1` and update the comment:

```ts
  it('early game: a steady stream of 1★ jobs', () => {
    const m = measureOfferMix(0)
    expect(m.jobShare.job1).toBe(1) // only tier unlocked
    // seat-gated arrivals throttle throughput by design; this floor reflects the
    // measured seat-model rate, not the old free-pump rate.
    expect(m.jobsPer100).toBeGreaterThanOrEqual(N) // N = measured floor
  })
```

The rep-24 mix test (`job1 < 0.15`, `job4+job5 > job1`) should pass unchanged — the weighted picker preserves the curve. Confirm it does; if not, stop and report (a mix regression means the weighting is wrong, not a band to widen).

- [ ] **Step 3: Sanity-check the full bot run and seat economy**

Run: `npm run sim`
Expected: the heuristic bot still reaches terminal states and wins a healthy share with a cash surplus (it's a smoke test / lower bound). Note whether seats gate the bot so hard that jobs-done collapses. If jobs-done/run drops sharply versus before, lower the early `SEAT_PRICES` (e.g. `[200, 350, 500, 750]`) so the bot can widen its pipeline, and re-run. Keep prices where the bot can grow but seats still cost a real decision.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: all pass, including the updated offer-mix gate.

- [ ] **Step 5: End-to-end browser verification**

Use the `verify` skill (`.claude/skills/verify/SKILL.md`) to drive the built app:
- `npm run build && npm run preview`, open `http://localhost:4173/merc-company/?seed=1&speed=8`.
- Confirm: the waiting room starts with **one** seat holding a 1★ job with a running TTL bar; rejecting/accepting it frees the seat and a new offer arrives shortly after; a second offer never appears while the single seat is occupied; "add a seat" shows the escalating price and, once bought, a second offer can wait; every card (job and candidate) shows the countdown bar; dispatching still opens the sheet and launches a mission.
- Confirm a mission's forecast duration reads ~30% longer than before (a solo 1★ ~39s) while the risk/consequence text is unchanged.

- [ ] **Step 6: Update docs if numbers are quoted**

Skim `src/sim/CLAUDE.md` for any literal offer-pump description that is now wrong (the "door / queue / credit" section and the offer-mix band note). Update the prose to describe the seat-gated pump and the corrected `jobsPer100` gate. Keep it a router — do not restate constants that live in `balance.ts`.

- [ ] **Step 7: Commit**

```bash
git add tests/sim/harness.test.ts src/sim/balance.ts src/sim/CLAUDE.md
git commit -m "test: retune offer-mix rate gate for seat-gated arrivals

Re-derive the rep-0 job throughput floor from the seat model and note the
intent change; tune SEAT_PRICES against bot runs. Mix intent unchanged."
```

---

## Self-Review

**Spec coverage:**
- Change 2 (WORK_PER_RATING, THREAT_CAP, DANGER_THREAT; survivability held) → Task 1. ✓
- Change 1 state model (drop door/queue/timers, add nextOfferAt) → Task 2 Steps 3. ✓
- Seat constants (STARTING_SEATS 1, MAX_SEATS 5, SEAT_PRICES, SCHEMA_VERSION) → Task 2 Steps 4. ✓
- Pump rewrite (expire→schedule→arrive, weighted rank-shift) → Task 2 Step 5. ✓
- Actions (delete seatOffer, seated-only, buySeat pricing) → Task 2 Step 6. ✓
- newRun opening in a seat → Task 2 Step 7. ✓
- Harness bot + measureOfferMix + runMissionScenario → Task 2 Step 12. ✓
- UI (JobsTab one list + TTL everywhere, DispatchSheet offerAlive) → Task 2 Steps 13–14. ✓
- Candidates share the waiting room → covered implicitly (pickSource includes `candidate`; JobsTab renders candidate cards in the seat list). ✓
- Tests rewritten; offer-mix rate gate re-derived; mix intent bands kept → Task 2 Step 1, Task 3 Step 2. ✓
- SCHEMA_VERSION bump / saves discarded → Task 2 Step 4 (persistence code in store.svelte already discards on mismatch; no change needed). ✓

**Placeholder scan:** the only intentionally-deferred value is `N` (the offer-mix rate floor) in Task 3 Step 2 and the `THREAT_CAP` 23-vs-24 choice in Task 1 Step 6 — both are measurement-driven balance decisions with an explicit procedure and default, not code placeholders. Everything else is concrete.

**Type consistency:** `nextOfferAt: number` (0 = unscheduled) is used identically in types.ts, offers.ts, tick.ts, simulate.ts, and the tests. `SEAT_PRICES: number[]` indexed by `waitingSeats - STARTING_SEATS` in both actions.ts and JobsTab.svelte. `combinedInterval(rep)`, `arrivalInterval(rep, rng)`, `pickSource(rep, rng)`, `pumpOffers(state, rng)` signatures match between offers.ts and offers.test.ts. `seatOffer` removed from actions.ts, simulate.ts import, and offers.test.ts together.
