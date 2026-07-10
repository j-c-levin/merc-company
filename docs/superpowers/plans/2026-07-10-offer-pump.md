# Offer Pump, Pacing & Bar Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single random offer stream with six credit-limited timers feeding a one-slot door, speed up the opening (job at the door at tick 0, TTL 18–24), and animate the progress/threat bars smoothly.

**Architecture:** A new `src/sim/offers.ts` module owns the pump: per-tick it expires the door offer, schedules unlocked timers that hold their credit, fires due timers into a hidden FIFO `queue`, and promotes the queue front to the single visible `door` slot. Credit-held is derived (an offer with the timer's `source` in door/queue), never stored. All RNG consumption stays inside `tick()`/`newRun()` — player actions in `actions.ts` must consume no RNG, or `?seed=` replay breaks.

**Tech Stack:** TypeScript, Svelte 5 (runes), Vitest 4 (run via `npm test`), vite 8. Spec: `docs/superpowers/specs/2026-07-10-offer-pump-design.md`.

## Global Constraints

- **Determinism:** `actions.ts` consumes no RNG. All `rng.*` calls happen inside `newRun()` or `tick()` (including `pumpOffers`). Same seed + same actions at same ticks ⇒ identical `JSON.stringify(state)`.
- **Gates:** `npm test` AND `npm run check` must pass at the end of every task. Run both before every commit.
- `tsconfig.node.json` has `noUnusedLocals`/`noUnusedParameters` — remove imports that a change makes unused, or `npm run check` fails.
- One tick = one second at default speed; `?seed=` and `?speed=` URL params must keep working.
- `SCHEMA_VERSION` bumps 2 → 3 in Task 4 (the state-shape change). `store.svelte.ts` already nulls mismatched saves — no migration code.
- **Out of scope:** bot heuristics and win-rate balance. `scripts/simulate.ts` gets the minimum mechanical edit to compile (Task 4); do not retune it.
- Rate table (copy verbatim, Task 1): `JOB_TIERS` rows `(rating, unlockRep, slow, fast)` = (1, 0, 40, 26), (2, 4, 65, 40), (3, 8, 95, 58), (4, 12, 130, 80), (5, 16, 170, 105); `CANDIDATE_ARRIVAL = { slow: 60, fast: 45 }`; `REP_RAMP = 16`; `ARRIVAL_JITTER = 0.15`; TTL retunes to `OFFER_TTL_MIN = 18`, `OFFER_TTL_MAX = 24` (Task 4).
- Suggested subagent models: Tasks 1, 2, 3, 5 → Sonnet (fully specified below). Task 4 → strongest available (cross-cutting switchover).

## File Structure

| File | Role |
|---|---|
| `src/sim/balance.ts` | tuning constants (modify: Tasks 1, 4) |
| `src/sim/types.ts` | `TimerKey`, `Offer.source`, `GameState` door/queue/timers (modify: Tasks 1, 2, 3, 4) |
| `src/sim/offers.ts` | **new** — the pump: interval math, unlock ladder, `creditHeld`, `pumpOffers` (create: Task 1; extend: Task 3) |
| `src/sim/content.ts` | `generateJob`/`generateCandidate` split (modify: Tasks 2, 4) |
| `src/sim/tick.ts` | calls the pump; opening job in `newRun` (modify: Tasks 3, 4) |
| `src/sim/actions.ts` | door/seated instead of offers (modify: Task 4) |
| `src/ui/JobsTab.svelte`, `src/App.svelte`, `src/ui/DispatchSheet.svelte` | door rendering, badge, existence check (modify: Task 4; JobsTab again Task 5) |
| `src/ui/MissionsTab.svelte`, `src/app.css`, `src/ui/store.svelte.ts` | animations (modify: Task 5) |
| `scripts/simulate.ts` | mechanical compile fix only (modify: Task 4) |
| `tests/sim/offers.test.ts`, `tests/sim/content.test.ts`, `tests/sim/roster.test.ts`, `tests/sim/run.test.ts` | new + ported tests |

---

### Task 1: Rate table and scheduling math

**Files:**
- Modify: `src/sim/balance.ts` (append constants)
- Modify: `src/sim/types.ts` (add `TimerKey` type only)
- Create: `src/sim/offers.ts`
- Test: `tests/sim/offers.test.ts` (append new describes; leave existing content untouched)

**Interfaces:**
- Consumes: `Rng` from `src/sim/rng.ts` (`rng.next(): number` in [0,1)).
- Produces: `TIMER_KEYS: TimerKey[]` (order `job1..job5, candidate` — this order is load-bearing: the pump fires in it), `unlockedTimers(reputation: number): TimerKey[]`, `baseInterval(key: TimerKey, reputation: number): number` (pure, no jitter), `arrivalInterval(key: TimerKey, reputation: number, rng: Rng): number` (jittered, integer ≥ 1). New balance exports: `JOB_TIERS`, `CANDIDATE_ARRIVAL`, `REP_RAMP`, `ARRIVAL_JITTER`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sim/offers.test.ts` (add `createRng` and the new symbols to the imports at the top; keep all existing imports and tests):

```ts
import { createRng } from '../../src/sim/rng'
import { TIMER_KEYS, unlockedTimers, baseInterval, arrivalInterval } from '../../src/sim/offers'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER } from '../../src/sim/balance'

describe('unlockedTimers', () => {
  it('starts with job1 and candidate only', () => {
    expect(unlockedTimers(0)).toEqual(['job1', 'candidate'])
  })

  it('unlocks each job tier at its unlockRep', () => {
    expect(unlockedTimers(3)).not.toContain('job2')
    expect(unlockedTimers(4)).toContain('job2')
    expect(unlockedTimers(16)).toEqual(TIMER_KEYS)
  })
})

describe('baseInterval', () => {
  it('starts at slow on unlock', () => {
    expect(baseInterval('job1', 0)).toBe(JOB_TIERS[0].slow)
    expect(baseInterval('job2', 4)).toBe(JOB_TIERS[1].slow)
    expect(baseInterval('candidate', 0)).toBe(CANDIDATE_ARRIVAL.slow)
  })

  it('reaches fast after REP_RAMP rep past unlock and clamps there', () => {
    expect(baseInterval('job1', REP_RAMP)).toBe(JOB_TIERS[0].fast)
    expect(baseInterval('job1', 999)).toBe(JOB_TIERS[0].fast)
    expect(baseInterval('job5', 999)).toBe(JOB_TIERS[4].fast)
    expect(baseInterval('candidate', 999)).toBe(CANDIDATE_ARRIVAL.fast)
  })

  it('is monotonically non-increasing in reputation for every timer', () => {
    for (const key of TIMER_KEYS) {
      let prev = Infinity
      for (let rep = 0; rep <= 40; rep++) {
        const v = baseInterval(key, rep)
        expect(v).toBeLessThanOrEqual(prev)
        prev = v
      }
    }
  })
})

describe('arrivalInterval', () => {
  it('applies bounded jitter around the base and never drops below 1', () => {
    const rng = createRng(1)
    const lo = Math.floor(JOB_TIERS[0].slow * (1 - ARRIVAL_JITTER))
    const hi = Math.ceil(JOB_TIERS[0].slow * (1 + ARRIVAL_JITTER))
    for (let i = 0; i < 200; i++) {
      const v = arrivalInterval('job1', 0, rng)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(lo)
      expect(v).toBeLessThanOrEqual(hi)
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/sim/offers.test.ts`
Expected: FAIL — `src/sim/offers.ts` does not exist / balance has no `JOB_TIERS` export.

- [ ] **Step 3: Implement**

Append to `src/sim/balance.ts`:

```ts
// ── offer pump ────────────────────────────────────────────────────────────
// Per-tier arrival timers. `slow` is the interval (ticks) at unlockRep;
// it ramps linearly to `fast` over REP_RAMP reputation and clamps there.
export const JOB_TIERS: { rating: number; unlockRep: number; slow: number; fast: number }[] = [
  { rating: 1, unlockRep: 0,  slow: 40,  fast: 26  },
  { rating: 2, unlockRep: 4,  slow: 65,  fast: 40  },
  { rating: 3, unlockRep: 8,  slow: 95,  fast: 58  },
  { rating: 4, unlockRep: 12, slow: 130, fast: 80  },
  { rating: 5, unlockRep: 16, slow: 170, fast: 105 },
]
export const CANDIDATE_ARRIVAL = { slow: 60, fast: 45 }
export const REP_RAMP = 16
export const ARRIVAL_JITTER = 0.15
```

Add to `src/sim/types.ts` (above `export interface Offer`):

```ts
export type TimerKey = 'job1' | 'job2' | 'job3' | 'job4' | 'job5' | 'candidate'
```

Create `src/sim/offers.ts`:

```ts
import type { TimerKey } from './types'
import type { Rng } from './rng'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER } from './balance'

/** Firing order is fixed: when several timers are due on the same tick, jobs
 *  fire low tier first, candidate last. Determinism depends on this order. */
export const TIMER_KEYS: TimerKey[] = ['job1', 'job2', 'job3', 'job4', 'job5', 'candidate']

function ratesFor(key: TimerKey): { unlockRep: number; slow: number; fast: number } {
  if (key === 'candidate') return { unlockRep: 0, ...CANDIDATE_ARRIVAL }
  return JOB_TIERS[Number(key.slice(3)) - 1]
}

export function unlockedTimers(reputation: number): TimerKey[] {
  return TIMER_KEYS.filter(key => reputation >= ratesFor(key).unlockRep)
}

/** Deterministic center of the arrival interval; jitter lives in arrivalInterval. */
export function baseInterval(key: TimerKey, reputation: number): number {
  const { unlockRep, slow, fast } = ratesFor(key)
  const t = Math.min(1, Math.max(0, (reputation - unlockRep) / REP_RAMP))
  return slow + (fast - slow) * t
}

export function arrivalInterval(key: TimerKey, reputation: number, rng: Rng): number {
  const jitter = 1 + (rng.next() * 2 - 1) * ARRIVAL_JITTER
  return Math.max(1, Math.round(baseInterval(key, reputation) * jitter))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sim/offers.test.ts` then `npm test` and `npm run check`
Expected: all PASS, 0 check errors.

- [ ] **Step 5: Commit**

```bash
git add src/sim/balance.ts src/sim/types.ts src/sim/offers.ts tests/sim/offers.test.ts
git commit -m "feat: per-tier arrival rate table and scheduling math for the offer pump"
```

---

### Task 2: `Offer.source` and the content split

**Files:**
- Modify: `src/sim/types.ts` (Offer interface)
- Modify: `src/sim/content.ts`
- Modify: `tests/sim/offers.test.ts:7-23` (both helper literals), `tests/sim/roster.test.ts:7-14` (helper literal)
- Test: `tests/sim/content.test.ts` (append)

**Interfaces:**
- Consumes: `TimerKey` from Task 1; existing `generateMerc(state, rng): Merc`, `maxTier(reputation): number`.
- Produces: `Offer.source: TimerKey` (required field). `generateJob(state: GameState, rng: Rng, rating: number): Offer` — source `` `job${rating}` ``, `postedAt`/`expiresAt` = 0 (TTL is stamped at door promotion, never here). `generateCandidate(state: GameState, rng: Rng): Offer` — source `'candidate'`, TTL likewise unstamped. `generateOffer` survives (Task 4 deletes it) but delegates to the new functions.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sim/content.test.ts` (extend the import from `content` to `{ maxTier, generateMerc, generateOffer, generateJob, generateCandidate }`):

```ts
describe('generateJob / generateCandidate', () => {
  it('stamps source and leaves TTL unstamped until door promotion', () => {
    const state = stubState(0)
    const rng = createRng(5)
    const job = generateJob(state, rng, 3)
    expect(job.kind).toBe('job')
    expect(job.source).toBe('job3')
    expect(job.postedAt).toBe(0)
    expect(job.expiresAt).toBe(0)
    expect(job.job!.rating).toBe(3)
    expect(job.job!.payout).toBe(9 * PAYOUT_PER_RATING_SQ)
    expect(job.job!.work).toBe(3 * WORK_PER_RATING)

    const cand = generateCandidate(state, rng)
    expect(cand.kind).toBe('candidate')
    expect(cand.source).toBe('candidate')
    expect(cand.candidate).toBeDefined()
    expect(cand.postedAt).toBe(0)
    expect(cand.expiresAt).toBe(0)
  })

  it('generateJob takes its rating from the caller, not from reputation', () => {
    const state = stubState(0) // rep 0: the old maxTier path would cap at 1★
    const rng = createRng(6)
    expect(generateJob(state, rng, 5).job!.rating).toBe(5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/sim/content.test.ts`
Expected: FAIL — no export `generateJob`.

- [ ] **Step 3: Implement**

In `src/sim/types.ts`, change the `Offer` interface to:

```ts
export interface Offer {
  id: number
  kind: 'job' | 'candidate'
  source: TimerKey // which timer emitted this; its credit is spent while the offer is in flight
  postedAt: number // tick the offer reached the door; 0 while queued
  expiresAt: number // tick at which it auto-rejects; 0 while queued (ignored while seated)
  job?: JobDetails
  candidate?: Merc
}
```

In `src/sim/content.ts`, add `TimerKey` to the type import and replace `generateOffer` (lines 32–50) with:

```ts
export function generateJob(state: GameState, rng: Rng, rating: number): Offer {
  return {
    id: state.nextId++,
    kind: 'job',
    source: `job${rating}` as TimerKey,
    postedAt: 0,
    expiresAt: 0,
    job: {
      rating,
      environment: ENVIRONMENTS[rng.int(0, ENVIRONMENTS.length - 1)],
      payout: rating * rating * PAYOUT_PER_RATING_SQ,
      work: rating * WORK_PER_RATING,
    },
  }
}

export function generateCandidate(state: GameState, rng: Rng): Offer {
  return {
    id: state.nextId++,
    kind: 'candidate',
    source: 'candidate',
    postedAt: 0,
    expiresAt: 0,
    candidate: generateMerc(state, rng),
  }
}

export function generateOffer(state: GameState, rng: Rng): Offer {
  const expiresAt = state.tick + rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)
  const offer = rng.next() < CANDIDATE_CHANCE
    ? generateCandidate(state, rng)
    : generateJob(state, rng, rng.int(1, maxTier(state.reputation)))
  offer.postedAt = state.tick
  offer.expiresAt = expiresAt
  return offer
}
```

(This preserves the old function's RNG draw order exactly: TTL, kind, then content.)

Fix the two offer-literal test helpers to satisfy the now-required `source` field. In `tests/sim/offers.test.ts` add `source: 'job1',` to the `jobOffer` literal and `source: 'candidate',` to the `candidateOffer` literal; in `tests/sim/roster.test.ts` add `source: 'job1',` to its `jobOffer` literal. Example (offers.test.ts):

```ts
function jobOffer(state: GameState, rating = 1): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'job', source: 'job1', postedAt: state.tick, expiresAt: state.tick + 60,
    job: { rating, environment: 'urban', payout: rating * rating * 150, work: rating * 100 },
  }
  state.offers.push(o)
  return o
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` and `npm run check`
Expected: all PASS, 0 check errors.

- [ ] **Step 5: Commit**

```bash
git add src/sim/types.ts src/sim/content.ts tests/sim/content.test.ts tests/sim/offers.test.ts tests/sim/roster.test.ts
git commit -m "feat: split generateOffer into generateJob/generateCandidate with timer source"
```

---

### Task 3: The pump — `creditHeld` and `pumpOffers` (built alongside the old system)

**Files:**
- Modify: `src/sim/types.ts` (GameState), `src/sim/tick.ts` (`newRun` init only — `tick()` untouched)
- Modify: `src/sim/offers.ts`
- Test: `tests/sim/offers.test.ts` (append)

**Interfaces:**
- Consumes: `generateJob`/`generateCandidate` (Task 2), `unlockedTimers`/`arrivalInterval`/`TIMER_KEYS` (Task 1), `OFFER_TTL_MIN`/`OFFER_TTL_MAX` from balance.
- Produces: `GameState` gains `door: Offer | null`, `queue: Offer[]`, `timers: Partial<Record<TimerKey, number>>` (kept **alongside** `offers`/`nextOfferAt` until Task 4 — the old system still runs the game after this task). `creditHeld(state: GameState, key: TimerKey): boolean` — true iff no offer with that `source` sits in `door` or `queue` (seated offers do NOT hold credit). `pumpOffers(state: GameState, rng: Rng): void` — the four-step per-tick pump. Nothing calls `pumpOffers` from `tick()` yet.

**Invariant to preserve (Task 4's actions rely on it):** a timer whose offer is in `door`/`queue` has no `timers[key]` entry — firing deletes it, and scheduling requires `creditHeld`. So resolving an offer needs no timer bookkeeping at all: the entry is already absent, and the next pump reschedules.

- [ ] **Step 1: Write the failing tests**

Append to `tests/sim/offers.test.ts` (extend the `offers` import with `{ creditHeld, pumpOffers }`; `Offer` and `GameState` types are already imported):

```ts
/** Fresh state with the pump fields empty and reputation set. */
function pumpState(rep = 0): GameState {
  const s = newRun(50)
  s.reputation = rep
  s.door = null
  s.queue = []
  s.timers = {}
  return s
}

describe('pumpOffers', () => {
  it('schedules unlocked timers that hold credit; locked tiers never fire', () => {
    const s = pumpState(0)
    pumpOffers(s, createRng(1))
    expect(s.timers.job1).toBeGreaterThan(s.tick)
    expect(s.timers.candidate).toBeGreaterThan(s.tick)
    expect(s.timers.job2).toBeUndefined()
  })

  it('crossing unlockRep initialises a tier with no special case', () => {
    const s = pumpState(0)
    pumpOffers(s, createRng(1))
    s.reputation = 4
    pumpOffers(s, createRng(2))
    expect(s.timers.job2).toBeGreaterThan(s.tick)
  })

  it('fires a due timer into the door, stamping postedAt/expiresAt on promotion', () => {
    const s = pumpState(0)
    s.timers.job1 = s.tick
    pumpOffers(s, createRng(2))
    expect(s.door).not.toBeNull()
    expect(s.door!.source).toBe('job1')
    expect(s.door!.postedAt).toBe(s.tick)
    expect(s.door!.expiresAt).toBeGreaterThan(s.tick)
    expect(s.timers.job1).toBeUndefined() // credit spent: not rescheduled while in flight
  })

  it('never reschedules a timer whose offer is in flight', () => {
    const s = pumpState(0)
    s.timers.job1 = s.tick
    const rng = createRng(3)
    pumpOffers(s, rng)
    expect(creditHeld(s, 'job1')).toBe(false)
    pumpOffers(s, rng)
    expect(s.timers.job1).toBeUndefined()
  })

  it('queued offers are frozen and promote FIFO by fire order', () => {
    const s = pumpState(4)
    s.timers.job1 = s.tick
    s.timers.job2 = s.tick
    const rng = createRng(4)
    pumpOffers(s, rng)
    expect(s.door!.source).toBe('job1') // TIMER_KEYS order: job1 fires first
    expect(s.queue).toHaveLength(1)
    expect(s.queue[0].source).toBe('job2')
    expect(s.queue[0].expiresAt).toBe(0) // frozen while queued
    s.door = null // simulate the player resolving the door offer
    pumpOffers(s, rng)
    expect(s.door!.source).toBe('job2')
    expect(s.door!.expiresAt).toBeGreaterThan(s.tick)
  })

  it('expires the door offer and refills from the queue in the same pump', () => {
    const s = pumpState(0)
    s.door = {
      id: 900, kind: 'job', source: 'job1', postedAt: 0, expiresAt: s.tick,
      job: { rating: 1, environment: 'urban', payout: 150, work: 100 },
    }
    s.queue.push({
      id: 901, kind: 'candidate', source: 'candidate', postedAt: 0, expiresAt: 0,
      candidate: { id: 902, name: 'Rook Ash', klass: 'Scout', rank: 1, hp: 20, maxHp: 20, affinity: 'urban', hirePrice: 100 },
    })
    pumpOffers(s, createRng(7))
    expect(s.door!.id).toBe(901)
    expect(s.door!.expiresAt).toBeGreaterThan(s.tick)
    expect(s.queue).toHaveLength(0)
    expect(s.timers.job1).toBeGreaterThan(s.tick) // expiry returned job1's credit
  })

  it('a re-locked tier stops firing but keeps its due timer entry', () => {
    const s = pumpState(4)
    s.timers.job2 = s.tick
    s.reputation = 0 // rep loss re-locks tier 2 before the pump runs
    pumpOffers(s, createRng(8))
    expect(s.door?.source ?? null).not.toBe('job2') // did not fire
    expect(s.timers.job2).toBe(s.tick) // entry kept for when rep recovers
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/sim/offers.test.ts`
Expected: FAIL — `door`/`queue`/`timers` missing from GameState; no `pumpOffers` export.

- [ ] **Step 3: Implement**

`src/sim/types.ts` — inside `GameState`, directly under the `seated` line, add (keep `offers` and `nextOfferAt` for now; Task 4 removes them):

```ts
  door: Offer | null // the one visible offer; TTL runs only here
  queue: Offer[] // hidden FIFO of fired-but-not-yet-shown offers
  timers: Partial<Record<TimerKey, number>> // key -> tick it next fires; absent = "reschedule me"
```

(`TimerKey` is declared earlier in this same file — no import needed.)

`src/sim/tick.ts` — in `newRun`'s state literal, under `seated: [],` add:

```ts
    door: null,
    queue: [],
    timers: {},
```

`src/sim/offers.ts` — extend imports and append:

```ts
import type { GameState, Offer, TimerKey } from './types'
import { JOB_TIERS, CANDIDATE_ARRIVAL, REP_RAMP, ARRIVAL_JITTER, OFFER_TTL_MIN, OFFER_TTL_MAX } from './balance'
import { generateJob, generateCandidate } from './content'
```

```ts
/** A timer holds its single credit iff none of its offers are in flight
 *  (door or queue). Seated offers returned their credit when seated. */
export function creditHeld(state: GameState, key: TimerKey): boolean {
  return state.door?.source !== key && !state.queue.some(o => o.source === key)
}

function fireTimer(state: GameState, rng: Rng, key: TimerKey): Offer {
  return key === 'candidate'
    ? generateCandidate(state, rng)
    : generateJob(state, rng, Number(key.slice(3)))
}

/** Per-tick pump. Order matters:
 *  1 expire → 2 schedule → 3 fire → 4 promote.
 *  Expiry precedes promotion so a door freed this tick refills this tick;
 *  scheduling precedes firing so a fresh schedule fires no earlier than
 *  tick + interval. All RNG for offers is consumed here and only here. */
export function pumpOffers(state: GameState, rng: Rng): void {
  if (state.door && state.door.expiresAt <= state.tick) state.door = null

  const unlocked = unlockedTimers(state.reputation)
  for (const key of unlocked) {
    if (state.timers[key] === undefined && creditHeld(state, key)) {
      state.timers[key] = state.tick + arrivalInterval(key, state.reputation, rng)
    }
  }
  for (const key of unlocked) {
    const nextAt = state.timers[key]
    if (nextAt !== undefined && nextAt <= state.tick) {
      state.queue.push(fireTimer(state, rng, key))
      delete state.timers[key]
    }
  }
  if (!state.door && state.queue.length > 0) {
    const offer = state.queue.shift()!
    offer.postedAt = state.tick
    offer.expiresAt = state.tick + rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)
    state.door = offer
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` and `npm run check`
Expected: all PASS (old suite still green — the game still runs on `offers`/`nextOfferAt`), 0 check errors.

- [ ] **Step 5: Commit**

```bash
git add src/sim/types.ts src/sim/tick.ts src/sim/offers.ts tests/sim/offers.test.ts
git commit -m "feat: credit-based offer pump (door/queue/timers), not yet wired into tick"
```

---

### Task 4: Switchover — tick, actions, UI, and test port (strongest model)

**Files:**
- Modify: `src/sim/balance.ts`, `src/sim/types.ts`, `src/sim/content.ts`, `src/sim/tick.ts`, `src/sim/actions.ts`
- Modify: `src/ui/JobsTab.svelte`, `src/App.svelte`, `src/ui/DispatchSheet.svelte`, `scripts/simulate.ts`
- Test: `tests/sim/offers.test.ts` (rewrite the two old describes + new integration tests), `tests/sim/roster.test.ts`, `tests/sim/run.test.ts`, `tests/sim/content.test.ts`

**Interfaces:**
- Consumes: `pumpOffers`, `creditHeld` (Task 3); `generateJob` (Task 2).
- Produces: `GameState` WITHOUT `offers`/`nextOfferAt`; `SCHEMA_VERSION = 3`; TTL constants 18/24; actions (`seatOffer`, `rejectOffer`, `hire`, `dispatch`) operating on `door`/`seated` with unchanged signatures; `generateOffer` and `CANDIDATE_CHANCE`/`OFFER_ARRIVAL_MIN`/`OFFER_ARRIVAL_MAX` deleted.
- **Actions touch no timers and no RNG** — by the Task 3 invariant, an in-flight offer's timer entry is already absent; clearing `door` alone returns the credit.

- [ ] **Step 1: Rewrite the offer tests (failing first)**

In `tests/sim/offers.test.ts`, replace the two helper functions and the `'offer stream in tick'` describe with:

```ts
function atDoor(state: GameState, offer: Offer): Offer {
  state.door = offer
  return offer
}

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

describe('offer pump in tick', () => {
  it('newRun opens with a 1★ job at the door, TTL running', () => {
    const s = newRun(10)
    expect(s.door).not.toBeNull()
    expect(s.door!.kind).toBe('job')
    expect(s.door!.source).toBe('job1')
    expect(s.door!.job!.rating).toBe(1)
    expect(s.door!.postedAt).toBe(0)
    expect(s.door!.expiresAt).toBeGreaterThanOrEqual(OFFER_TTL_MIN)
    expect(s.door!.expiresAt).toBeLessThanOrEqual(OFFER_TTL_MAX)
  })

  it('the opening offer expires and the pump replaces it over time', () => {
    const s = newRun(10)
    const openingId = s.door!.id
    let sawReplacement = false
    for (let i = 0; i < 200; i++) {
      tick(s)
      if (s.door && s.door.id !== openingId) sawReplacement = true
    }
    // NOT s.door !== null at the end: the door legitimately sits empty
    // between an expiry and the next timer firing.
    expect(sawReplacement).toBe(true)
  })

  it('rejecting the door offer returns the credit — the next tick reschedules the timer', () => {
    const s = newRun(11)
    rejectOffer(s, s.door!.id)
    expect(s.door).toBeNull()
    tick(s)
    expect(s.timers.job1).toBeGreaterThan(s.tick)
  })

  it('never expires seated offers', () => {
    const s = newRun(12)
    const id = s.door!.id
    seatOffer(s, id)
    for (let i = 0; i < OFFER_TTL_MAX + 50; i++) tick(s)
    expect(s.seated.some(o => o.id === id)).toBe(true)
  })

  it('seating returns the credit while the offer persists in seated', () => {
    const s = newRun(12)
    seatOffer(s, s.door!.id)
    expect(creditHeld(s, 'job1')).toBe(true)
    tick(s)
    expect(s.timers.job1).toBeGreaterThan(s.tick)
  })

  it('player actions consume no RNG', () => {
    const s = newRun(13)
    const before = s.rngState
    seatOffer(s, s.door!.id)
    rejectOffer(s, s.seated[0].id)
    expect(s.rngState).toBe(before)
  })

  it('same seed + same actions at same ticks → identical states', () => {
    const play = (): GameState => {
      const s = newRun(77)
      for (let i = 0; i < 120; i++) {
        tick(s)
        if (i === 30 && s.door) rejectOffer(s, s.door.id)
        if (i === 60 && s.door && s.seated.length < s.waitingSeats) seatOffer(s, s.door.id)
      }
      return s
    }
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()))
  })
})
```

Adapt the remaining describes in the same file — each place an offer with `atDoor` instead of pushing to `state.offers` (note `newRun` already fills the door with the opening job; `atDoor` overwrites it, which is fine):

```ts
describe('seat/reject', () => {
  it('seats up to capacity then throws', () => {
    const s = newRun(12)
    seatOffer(s, atDoor(s, jobOffer(s)).id)
    seatOffer(s, atDoor(s, jobOffer(s)).id)
    expect(s.seated).toHaveLength(STARTING_SEATS)
    expect(() => seatOffer(s, atDoor(s, jobOffer(s)).id)).toThrow(/seat/i)
  })

  it('rejects from the door and from a seat', () => {
    const s = newRun(13)
    const a = atDoor(s, jobOffer(s))
    seatOffer(s, a.id)
    const b = atDoor(s, jobOffer(s))
    rejectOffer(s, a.id)
    rejectOffer(s, b.id)
    expect(s.seated).toHaveLength(0)
    expect(s.door).toBeNull()
  })
})
```

In the `hire` describe, replace each `const o = candidateOffer(s)` with `const o = atDoor(s, candidateOffer(s))`; assertions are unchanged. In the `dispatch` describe likewise use `atDoor(s, jobOffer(s, 2))` etc., and change `expect(s.offers).toHaveLength(0)` to `expect(s.door).toBeNull()`. The two-offer test becomes sequential:

```ts
  it('refuses mercs that are already deployed', () => {
    const s = newRun(18)
    const squad = idleMercIds(s)
    dispatch(s, atDoor(s, jobOffer(s)).id, squad)
    expect(() => dispatch(s, atDoor(s, jobOffer(s)).id, squad)).toThrow(/idle/i)
  })
```

Update this file's imports: add `TimerKey` to the types import, add `creditHeld` (already imported since Task 3), add `OFFER_TTL_MIN` to the balance import.

`tests/sim/roster.test.ts` — change the helper to place at the door:

```ts
function jobOffer(state: GameState): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'job', source: 'job1', postedAt: state.tick, expiresAt: state.tick + 60,
    job: { rating: 1, environment: 'urban', payout: 150, work: 100 },
  }
  state.door = o
  return o
}
```

`tests/sim/run.test.ts` — the "loses at the deadline" setup becomes:

```ts
    s.cash = 0
    s.door = null
    s.queue = []
    s.timers = { job1: CYCLE_LENGTH + 999, candidate: CYCLE_LENGTH + 999 } // no income possible
```

`tests/sim/content.test.ts` — delete the `generateOffer` describe and drop `generateOffer`, `OFFER_TTL_MIN`, `OFFER_TTL_MAX` from the imports (`noUnusedLocals`).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test`
Expected: FAIL — `s.timers.job1` never scheduled by `tick`, `newRun` has no door offer, actions still read `state.offers`.

- [ ] **Step 3: Implement the switchover**

`src/sim/balance.ts`:
- `SCHEMA_VERSION` → `3`
- `OFFER_TTL_MIN` → `18`, `OFFER_TTL_MAX` → `24`
- Delete `OFFER_ARRIVAL_MIN`, `OFFER_ARRIVAL_MAX`, `CANDIDATE_CHANCE`.

`src/sim/types.ts` — in `GameState`, delete `offers: Offer[]` and `nextOfferAt: number`.

`src/sim/content.ts` — delete `generateOffer` entirely; remove `OFFER_TTL_MIN`, `OFFER_TTL_MAX`, `CANDIDATE_CHANCE` from the balance import. `maxTier` stays (it caps candidate rank via `generateMerc`).

`src/sim/tick.ts`:
- Imports: replace `generateOffer` with `generateJob`; drop `OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX` and add `OFFER_TTL_MIN, OFFER_TTL_MAX` in the balance import; add `import { pumpOffers } from './offers'`.
- `newRun`: delete the `offers: [],` and `nextOfferAt: 0,` lines from the literal and the `state.nextOfferAt = rng.int(...)` line. After the `state.mercs.push(...)` line insert:

```ts
  // opening: a 1★ job is already at the door, TTL running; job1's credit is spent
  const opening = generateJob(state, rng, 1)
  opening.postedAt = 0
  opening.expiresAt = rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)
  state.door = opening
```

- `tick()`: replace the arrival block and expiry filter (currently lines 60–64):

```ts
  if (state.tick >= state.nextOfferAt) {
    state.offers.push(generateOffer(state, rng))
    state.nextOfferAt = state.tick + rng.int(OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX)
  }
  state.offers = state.offers.filter(o => o.expiresAt > state.tick)
```

with:

```ts
  pumpOffers(state, rng)
```

`src/sim/actions.ts` — replace `takeOffer` and `seatOffer` and the two lookup lines:

```ts
function takeOffer(state: GameState, offerId: number): Offer {
  const offer = state.door?.id === offerId ? state.door : state.seated.find(o => o.id === offerId)
  if (!offer) throw new Error(`no offer ${offerId}`)
  if (state.door?.id === offerId) state.door = null // credit returns via creditHeld; no timer bookkeeping
  state.seated = state.seated.filter(o => o.id !== offerId)
  return offer
}

export function seatOffer(state: GameState, offerId: number): void {
  if (state.seated.length >= state.waitingSeats) throw new Error('no free seat')
  if (state.door?.id !== offerId) throw new Error(`no door offer ${offerId}`)
  state.seated.push(state.door)
  state.door = null
}
```

In `hire` (line 39) and `dispatch` (line 50), replace
`state.offers.find(o => o.id === offerId) ?? state.seated.find(o => o.id === offerId)` with
`(state.door?.id === offerId ? state.door : undefined) ?? state.seated.find(o => o.id === offerId)`.

`src/ui/JobsTab.svelte` — replace the "at the door" section body (lines 48–53):

```svelte
  {#if game.state.door}
    {@render offerCard(game.state.door, false)}
  {:else}
    <p class="dim">nobody at the door — they'll come</p>
  {/if}
```

`src/App.svelte` line 37:

```svelte
    Jobs ({(game.state.door ? 1 : 0) + game.state.seated.length})
```

`src/ui/DispatchSheet.svelte` lines 14–16:

```ts
  const offerAlive = $derived(
    game.state.door?.id === offer.id || game.state.seated.some(o => o.id === offer.id)
  )
```

`scripts/simulate.ts` — mechanical only. At the top of `botAct` add:

```ts
  const doorOffers = state.door ? [state.door] : []
```

then replace `[...state.offers, ...state.seated]` (twice, lines 15 and 52) with `[...doorOffers, ...state.seated]`, and `state.offers` (line 66) with `doorOffers`. Change nothing else in this file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test` and `npm run check`
Expected: all PASS, 0 check errors. If a pre-existing test not listed here breaks, fix its state setup to the new fields — do not weaken its assertion. Note the pump consumes different RNG draws than the old stream, so a test that hardcoded a seed-dependent outcome (a specific merc name, an exact cash value after N ticks) may legitimately need its expected value re-derived — but spec anchors (payout = rating² × 150, work = rating × 100, TTL bounds) must hold as written.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: switch the game to the credit-based offer pump (schema v3, TTL 18-24)"
```

---

### Task 5: Bar animations

**Files:**
- Modify: `src/app.css`, `src/ui/store.svelte.ts`, `src/ui/MissionsTab.svelte`, `src/ui/JobsTab.svelte`

**Interfaces:**
- Consumes: `--tick` CSS custom property on `#app`; `mission.threatLevel` (increments exactly when the threat bar wraps); `game.state.door.id`.
- Produces: purely visual — no sim or test changes. `npm test` and `npm run check` must still pass.

- [ ] **Step 1: CSS — tick-synced transitions, flash, reduced motion**

In `src/app.css`, change the `#app` and `.bar > div` rules and append the animation block:

```css
#app { display: flex; flex-direction: column; height: 100dvh; max-width: 480px; margin: 0 auto; --tick: 1000ms; }
```

```css
.bar > div { height: 100%; transition: width var(--tick) linear; }
```

Append at the end of the file:

```css
@keyframes flash {
  0% { border-color: var(--danger); box-shadow: 0 0 10px rgba(192, 80, 77, 0.6); }
  100% { border-color: var(--line); box-shadow: none; }
}
.card.flash { animation: flash calc(var(--tick) * 1.5) ease-out; }
@media (prefers-reduced-motion: reduce) {
  .bar > div { transition: none; }
  .card.flash { animation: none; }
}
```

- [ ] **Step 2: Sync `--tick` to the `?speed=` param**

In `src/ui/store.svelte.ts` `startLoop()`, directly after the `const speed = ...` line, add:

```ts
  document.getElementById('app')?.style.setProperty('--tick', `${Math.round(1000 / speed)}ms`)
```

(`speed` is already validated finite and > 0 on the previous line.)

- [ ] **Step 3: Threat snap + flash in MissionsTab**

In `src/ui/MissionsTab.svelte`, wrap each mission card in `{#key mission.threatLevel}` so a threat-level wrap remounts the card — a fresh node has no prior computed style, so the bar snaps back instead of tweening downward — and add the flash class (guarded so the initial level-0 mount doesn't flash):

```svelte
{#each game.state.missions as mission (mission.id)}
  {#key mission.threatLevel}
    <div class="card" class:hot={mission.threatBar >= DANGER_THREAT} class:flash={mission.threatLevel > 0}>
      ... (existing card body unchanged) ...
    </div>
  {/key}
{/each}
```

Only the wrapper and the two `class:` directives change; the card body is untouched. Note `class:flash` needs no scoped style — `.card.flash` lives in `app.css` (global).

- [ ] **Step 4: Snap the TTL bar between door offers**

In `src/ui/JobsTab.svelte`, wrap the door card render in `{#key}` so a *new* offer's TTL bar doesn't tween from the previous offer's value:

```svelte
  {#if game.state.door}
    {#key game.state.door.id}
      {@render offerCard(game.state.door, false)}
    {/key}
  {:else}
    <p class="dim">nobody at the door — they'll come</p>
  {/if}
```

- [ ] **Step 5: Verify and commit**

Run: `npm test` and `npm run check` — both green (no sim changes).
Visual check (best-effort): `npm run dev`, confirm mission bars glide, threat bar snaps + card flashes on level-up, TTL bar drains smoothly and snaps for a new arrival, and `?speed=4` animations keep pace with the faster ticks.

```bash
git add src/app.css src/ui/store.svelte.ts src/ui/MissionsTab.svelte src/ui/JobsTab.svelte
git commit -m "feat: tick-synced bar animations with threat snap/flash and reduced-motion support"
```
