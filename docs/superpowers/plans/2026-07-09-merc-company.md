# Merc Company Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 of Merc Company — a phone-first web game where you run a mercenary company and must repay a loan within one ~25-minute cycle of simulated ticks.

**Architecture:** A pure-TypeScript deterministic simulation core (`src/sim/`, zero DOM/Svelte imports) driven by `tick(state)` with a seeded serializable RNG, wrapped by a thin Svelte UI (`src/ui/`) that drives 1 tick/second and renders three tabs. Verification is three-layered: Vitest unit tests on the sim, a headless balance harness playing thousands of seeded runs, and Playwright (MCP) driving the real UI in a mobile viewport.

**Tech Stack:** Vite, Svelte 5, TypeScript, Vitest, tsx (for the harness script), Playwright via MCP.

**Spec:** `docs/superpowers/specs/2026-07-09-merc-company-design.md` — read it before starting any task.

## Global Constraints

- All tuning constants live in `src/sim/balance.ts` and are imported everywhere else — never inline a magic number that appears in the spec's numbers table.
- `src/sim/` must never import from Svelte, the DOM, or `src/ui/`. `src/ui/` must never compute game logic.
- The sim is deterministic: same seed → same run. Never call `Math.random()` or `Date.now()` inside `src/sim/` — all randomness goes through the `Rng` passed around via `state.rngState`.
- Game state mutation happens only inside `src/sim/` functions (`tick`, actions). UI calls them and re-renders.
- Design anchors (do not change without a spec change): mission work = `MR × 100`; base threat = `MR × 5`; min threat/tick = `MR`; threat bar cap = `18`.
- Money: integer credits only. HP: integers.
- Currency/copy: "cr" suffix in UI (e.g. `450cr`).
- Portrait-phone-first UI: single column, three tabs, persistent header.
- Commit after every task (at minimum); use `feat:`/`test:`/`chore:` prefixes.

## File Structure

```
package.json, vite.config.ts, tsconfig.json, index.html   # Task 1 scaffold
src/sim/rng.ts          # Task 2 — mulberry32, serializable state
src/sim/types.ts        # Task 3 — GameState, Merc, Offer, Mission
src/sim/balance.ts      # Task 3 — every tuning constant
src/sim/content.ts      # Task 3 — name/class pools, merc & offer generation
src/sim/bonds.ts        # Task 4 — pair keys, bond levels, squadPower
src/sim/tick.ts         # Tasks 5,6,10 — the per-tick state machine + newRun
src/sim/actions.ts      # Tasks 6,7,8 — player verbs
src/sim/projection.ts   # Task 9 — dispatch forecast
scripts/simulate.ts     # Task 11 — headless balance harness
src/ui/store.ts         # Task 12 — game store, loop driver, save/load
src/App.svelte          # Task 12 — header + tab shell
src/ui/RosterTab.svelte    # Task 13
src/ui/JobsTab.svelte      # Task 14
src/ui/DispatchSheet.svelte # Task 14
src/ui/MissionsTab.svelte  # Task 15
src/ui/EndScreen.svelte    # Task 15
tests/sim/*.test.ts     # per-task unit tests
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.ts`, `src/App.svelte` (via Vite template, then adjusted)

**Interfaces:**
- Produces: a running `npm run dev`, `npm test` (Vitest), `npm run sim` (harness entry, added now so scripts are stable).

- [ ] **Step 1: Scaffold Vite + Svelte + TS in the repo root**

```bash
npm create vite@latest . -- --template svelte-ts
npm install
npm install -D vitest tsx
```

If `npm create vite` refuses a non-empty directory, run it with `--force`` (the repo contains only `docs/` and `.git`).

- [ ] **Step 2: Add test/sim scripts and Vitest config**

In `package.json` `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"sim": "tsx scripts/simulate.ts"
```

In `vite.config.ts`, extend the default to:

```ts
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
```

Add at the top: `/// <reference types="vitest/config" />` so the `test` key typechecks.

- [ ] **Step 3: Add a smoke test**

Create `tests/sim/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 4: Verify everything runs**

Run: `npm test`
Expected: 1 passed.

Run: `npm run build`
Expected: builds without error.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite + svelte + ts + vitest"
```

---

### Task 2: Seeded serializable RNG

**Files:**
- Create: `src/sim/rng.ts`
- Test: `tests/sim/rng.test.ts`

**Interfaces:**
- Produces:
  - `interface Rng { next(): number; int(min: number, max: number): number; getState(): number; setState(s: number): void }`
  - `function createRng(seedOrState: number): Rng` — mulberry32; `next()` in [0,1); `int(min,max)` inclusive both ends.

- [ ] **Step 1: Write the failing test**

Create `tests/sim/rng.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/rng.test.ts`
Expected: FAIL — cannot resolve `src/sim/rng`.

- [ ] **Step 3: Implement**

Create `src/sim/rng.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/sim/rng.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/rng.ts tests/sim/rng.test.ts
git commit -m "feat: seeded serializable mulberry32 rng"
```

---

### Task 3: Types, balance constants, content generation

**Files:**
- Create: `src/sim/types.ts`, `src/sim/balance.ts`, `src/sim/content.ts`
- Test: `tests/sim/content.test.ts`

**Interfaces:**
- Produces (types used by every later task):

```ts
// src/sim/types.ts
export type Environment = 'urban' | 'rural' | 'forest'
export type MercClass = 'Breacher' | 'Scout' | 'Medic' | 'Gunner' | 'Fixer' | 'Sniper'
export type SupplyType = 'medkit' | 'suppressor' | 'stim'

export interface Merc {
  id: number
  name: string
  klass: MercClass
  rank: number // 1-5
  hp: number
  maxHp: number
  affinity: Environment
  hirePrice: number
}

export interface JobDetails {
  rating: number // 1-5
  environment: Environment
  payout: number
  work: number // rating × WORK_PER_RATING
}

export interface Offer {
  id: number
  kind: 'job' | 'candidate'
  expiresAt: number // tick at which it auto-rejects (ignored while seated)
  job?: JobDetails
  candidate?: Merc
}

export interface Inbound { mercId: number; arriveAt: number }
export interface SupplyInbound { type: SupplyType; arriveAt: number }
export interface Homebound { mercId: number; arriveAt: number }

export interface Mission {
  id: number
  rating: number
  environment: Environment
  payout: number
  workRequired: number
  workDone: number
  threatBar: number
  threatLevel: number
  squad: number[] // merc ids on site
  inbound: Inbound[]
  supplies: SupplyInbound[]
  stimUntil: number // tick until which stim is active; 0 = none
}

export interface GameState {
  schemaVersion: number
  seed: number
  rngState: number
  tick: number
  status: 'running' | 'won' | 'lost'
  cash: number
  loan: number
  reputation: number
  rosterSlots: number
  waitingSeats: number
  mercs: Merc[]
  offers: Offer[] // unseated stream
  seated: Offer[] // waiting room
  missions: Mission[]
  homebound: Homebound[] // mercs traveling back (withdrawal / mission end)
  bonds: Record<string, number> // pairKey -> missions completed together
  nextOfferAt: number
  nextId: number
  stats: { jobsDone: number; jobsFailed: number; mercsLost: number }
}
```

A merc's status is **derived**, not stored: on a mission if any `mission.squad`/`mission.inbound` contains their id, traveling if in `homebound`, otherwise idle.

```ts
// src/sim/balance.ts — every value from the spec's numbers table
export const SCHEMA_VERSION = 1
export const CYCLE_LENGTH = 1500
export const LOAN = 5000
export const STARTING_CASH = 500
export const WORK_PER_RATING = 100      // design anchor
export const THREAT_BASE_PER_RATING = 5 // design anchor
export const THREAT_CAP = 18            // design anchor
export const CONSEQUENCE_SPREAD = 2
export const HP_BASE = 15
export const HP_PER_RANK = 5
export const HIRE_COST_PER_RANK_SQ = 100
export const PAYOUT_PER_RATING_SQ = 150
export const STARTING_ROSTER_SLOTS = 3
export const MAX_ROSTER_SLOTS = 6
export const SLOT_PRICES = [300, 600, 1000] // 4th, 5th, 6th
export const STARTING_SEATS = 2
export const MAX_SEATS = 3
export const SEAT_PRICE = 250
export const OFFER_ARRIVAL_MIN = 40
export const OFFER_ARRIVAL_MAX = 60
export const OFFER_TTL_MIN = 60
export const OFFER_TTL_MAX = 90
export const CANDIDATE_CHANCE = 0.3     // else the offer is a job
export const MEDKIT = { price: 100, heal: 10 }
export const SUPPRESSOR = { price: 150, reduce: 9 }
export const STIM = { price: 150, multiplier: 1.5, duration: 10 }
export const REINFORCE_TRAVEL = 5
export const SUPPLY_TRAVEL = 3
export const BOND_THRESHOLDS = [2, 5, 9] // missions together for levels 1/2/3
export const HEAL_INTERVAL = 5          // idle mercs heal 1 hp every N ticks
export const MEDBAY_PER_HP = 10         // instant heal price per missing hp
export const REP_PER_TIER = 4           // rep needed per extra offer/candidate tier
```

- `content.ts` produces:
  - `maxTier(reputation: number): number` — `clamp(1 + floor(rep / REP_PER_TIER), 1, 5)`; caps both job ratings and candidate ranks.
  - `generateMerc(state: GameState, rng: Rng): Merc` — consumes `state.nextId++`; rank `rng.int(1, maxTier(state.reputation))`; hp = `HP_BASE + HP_PER_RANK × rank`; hirePrice = `rank² × HIRE_COST_PER_RANK_SQ`; random name/class/affinity.
  - `generateOffer(state: GameState, rng: Rng): Offer` — candidate with probability `CANDIDATE_CHANCE`, else job; job rating `rng.int(1, maxTier(state.reputation))`, payout `rating² × PAYOUT_PER_RATING_SQ`, work `rating × WORK_PER_RATING`; `expiresAt = state.tick + rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)`.

- [ ] **Step 1: Write the failing test**

Create `tests/sim/content.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createRng } from '../../src/sim/rng'
import { maxTier, generateMerc, generateOffer } from '../../src/sim/content'
import type { GameState } from '../../src/sim/types'
import { HP_BASE, HP_PER_RANK, HIRE_COST_PER_RANK_SQ, PAYOUT_PER_RATING_SQ, WORK_PER_RATING, OFFER_TTL_MIN, OFFER_TTL_MAX } from '../../src/sim/balance'

// Minimal state stub for generation — only fields content.ts reads/writes.
function stubState(reputation = 0): GameState {
  return { reputation, nextId: 1, tick: 100 } as GameState
}

describe('maxTier', () => {
  it('starts at 1 with zero reputation', () => expect(maxTier(0)).toBe(1))
  it('unlocks a tier per REP_PER_TIER', () => expect(maxTier(4)).toBe(2))
  it('caps at 5', () => expect(maxTier(999)).toBe(5))
})

describe('generateMerc', () => {
  it('derives hp and price from rank and assigns unique ids', () => {
    const state = stubState(999) // all ranks possible
    const rng = createRng(1)
    for (let i = 0; i < 50; i++) {
      const m = generateMerc(state, rng)
      expect(m.rank).toBeGreaterThanOrEqual(1)
      expect(m.rank).toBeLessThanOrEqual(5)
      expect(m.maxHp).toBe(HP_BASE + HP_PER_RANK * m.rank)
      expect(m.hp).toBe(m.maxHp)
      expect(m.hirePrice).toBe(m.rank * m.rank * HIRE_COST_PER_RANK_SQ)
      expect(m.name.length).toBeGreaterThan(0)
    }
    expect(state.nextId).toBe(51)
  })

  it('respects the reputation tier cap', () => {
    const state = stubState(0)
    const rng = createRng(2)
    for (let i = 0; i < 30; i++) expect(generateMerc(state, rng).rank).toBe(1)
  })
})

describe('generateOffer', () => {
  it('produces jobs with spec-anchored payout/work and a TTL in range', () => {
    const state = stubState(999)
    const rng = createRng(3)
    let sawJob = false, sawCandidate = false
    for (let i = 0; i < 100; i++) {
      const o = generateOffer(state, rng)
      expect(o.expiresAt - state.tick).toBeGreaterThanOrEqual(OFFER_TTL_MIN)
      expect(o.expiresAt - state.tick).toBeLessThanOrEqual(OFFER_TTL_MAX)
      if (o.kind === 'job') {
        sawJob = true
        expect(o.job!.payout).toBe(o.job!.rating ** 2 * PAYOUT_PER_RATING_SQ)
        expect(o.job!.work).toBe(o.job!.rating * WORK_PER_RATING)
      } else {
        sawCandidate = true
        expect(o.candidate).toBeDefined()
      }
    }
    expect(sawJob && sawCandidate).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/content.test.ts`
Expected: FAIL — cannot resolve `src/sim/content`.

- [ ] **Step 3: Implement**

Create `src/sim/types.ts` and `src/sim/balance.ts` exactly as shown in **Interfaces** above. Then create `src/sim/content.ts`:

```ts
import type { GameState, Merc, MercClass, Environment, Offer } from './types'
import type { Rng } from './rng'
import {
  HP_BASE, HP_PER_RANK, HIRE_COST_PER_RANK_SQ, PAYOUT_PER_RATING_SQ,
  WORK_PER_RATING, OFFER_TTL_MIN, OFFER_TTL_MAX, CANDIDATE_CHANCE, REP_PER_TIER,
} from './balance'

const FIRST = ['Vera', 'Dax', 'Imani', 'Rook', 'Sana', 'Bruno', 'Kestrel', 'Ozzy', 'Mara', 'Tunde', 'Lena', 'Cassius', 'Piotr', 'Yuki', 'Salome', 'Grif', 'Nadia', 'Emeka', 'Wren', 'Halvor']
const LAST = ['Okafor', 'Vasquez', 'Crane', 'Ferro', 'Adeyemi', 'Strand', 'Kovac', 'Bellamy', 'Ash', 'Duran', 'Mbeki', 'Voss', 'Iwu', 'Reyes', 'Okonkwo', 'Lindqvist', 'Baptiste', 'Ngata', 'Sorel', 'Krupin']
const CLASSES: MercClass[] = ['Breacher', 'Scout', 'Medic', 'Gunner', 'Fixer', 'Sniper']
const ENVIRONMENTS: Environment[] = ['urban', 'rural', 'forest']

export function maxTier(reputation: number): number {
  return Math.max(1, Math.min(5, 1 + Math.floor(reputation / REP_PER_TIER)))
}

export function generateMerc(state: GameState, rng: Rng): Merc {
  const rank = rng.int(1, maxTier(state.reputation))
  const maxHp = HP_BASE + HP_PER_RANK * rank
  return {
    id: state.nextId++,
    name: `${FIRST[rng.int(0, FIRST.length - 1)]} ${LAST[rng.int(0, LAST.length - 1)]}`,
    klass: CLASSES[rng.int(0, CLASSES.length - 1)],
    rank,
    hp: maxHp,
    maxHp,
    affinity: ENVIRONMENTS[rng.int(0, ENVIRONMENTS.length - 1)],
    hirePrice: rank * rank * HIRE_COST_PER_RANK_SQ,
  }
}

export function generateOffer(state: GameState, rng: Rng): Offer {
  const expiresAt = state.tick + rng.int(OFFER_TTL_MIN, OFFER_TTL_MAX)
  if (rng.next() < CANDIDATE_CHANCE) {
    return { id: state.nextId++, kind: 'candidate', expiresAt, candidate: generateMerc(state, rng) }
  }
  const rating = rng.int(1, maxTier(state.reputation))
  return {
    id: state.nextId++,
    kind: 'job',
    expiresAt,
    job: {
      rating,
      environment: ENVIRONMENTS[rng.int(0, ENVIRONMENTS.length - 1)],
      payout: rating * rating * PAYOUT_PER_RATING_SQ,
      work: rating * WORK_PER_RATING,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/sim/content.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/types.ts src/sim/balance.ts src/sim/content.ts tests/sim/content.test.ts
git commit -m "feat: game types, balance constants, merc/offer generation"
```

---

### Task 4: Bonds and squad power

**Files:**
- Create: `src/sim/bonds.ts`
- Test: `tests/sim/bonds.test.ts`

**Interfaces:**
- Consumes: `GameState`, `Merc`, `Environment` from Task 3; `BOND_THRESHOLDS` from balance.
- Produces:
  - `pairKey(a: number, b: number): string` — `"<lowId>-<highId>"`, order-independent.
  - `bondLevel(points: number): number` — 0–3 from `BOND_THRESHOLDS`.
  - `recordMissionTogether(state: GameState, mercIds: number[]): void` — +1 point to every pair in the list.
  - `squadPower(state: GameState, mercIds: number[], environment: Environment): number` — Σ rank (×2 on affinity match) + Σ bondLevel over every pair both present. This one function is the single source of truth for both completion contribution and threat reduction (and Task 9's projection).

- [ ] **Step 1: Write the failing test**

Create `tests/sim/bonds.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/bonds.test.ts`
Expected: FAIL — cannot resolve `src/sim/bonds`.

- [ ] **Step 3: Implement**

Create `src/sim/bonds.ts`:

```ts
import type { GameState, Environment } from './types'
import { BOND_THRESHOLDS } from './balance'

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

export function bondLevel(points: number): number {
  let level = 0
  for (const t of BOND_THRESHOLDS) if (points >= t) level++
  return level
}

export function recordMissionTogether(state: GameState, mercIds: number[]): void {
  for (let i = 0; i < mercIds.length; i++) {
    for (let j = i + 1; j < mercIds.length; j++) {
      const key = pairKey(mercIds[i], mercIds[j])
      state.bonds[key] = (state.bonds[key] ?? 0) + 1
    }
  }
}

export function squadPower(state: GameState, mercIds: number[], environment: Environment): number {
  let power = 0
  for (const id of mercIds) {
    const m = state.mercs.find(x => x.id === id)
    if (!m) continue
    power += m.rank * (m.affinity === environment ? 2 : 1)
  }
  for (let i = 0; i < mercIds.length; i++) {
    for (let j = i + 1; j < mercIds.length; j++) {
      power += bondLevel(state.bonds[pairKey(mercIds[i], mercIds[j])] ?? 0)
    }
  }
  return power
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/sim/bonds.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add src/sim/bonds.ts tests/sim/bonds.test.ts
git commit -m "feat: bond tracking and squadPower (single source of squad maths)"
```

---

### Task 5: newRun and the mission tick (completion, threat, consequences)

**Files:**
- Create: `src/sim/tick.ts`
- Test: `tests/sim/tick.test.ts`

**Interfaces:**
- Consumes: `createRng`, `squadPower`, `recordMissionTogether`, `generateMerc`, all balance constants.
- Produces:
  - `newRun(seed: number): GameState` — fresh state: 2 starter mercs, `STARTING_CASH`, `LOAN`, rep 0, slots/seats from balance, `nextOfferAt = rng.int(OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX)`, `status: 'running'`.
  - `tick(state: GameState): void` — advances one tick in this order: (1) bail unless `status === 'running'`; (2) `state.tick++`; (3) per-mission update (below); (4) homebound arrivals (remove entries whose `arriveAt <= tick`); (5) idle healing (+1 hp every `HEAL_INTERVAL` ticks to hurt idle mercs). Offer arrivals join in Task 6, supply/reinforcement arrivals in Task 8, deadline evaluation in Task 10 — leave a `// deadline: task 10` comment at the end.
  - Per-mission update order (single source of truth for the maths):
    1. `power = squadPower(state, mission.squad, mission.environment)`, `× STIM.multiplier` if `state.tick <= mission.stimUntil`.
    2. `mission.workDone += power`. If `workDone >= workRequired`: mission completes — `cash += payout`, `reputation += rating`, `stats.jobsDone++`, `recordMissionTogether(squad)`, squad → `homebound` with `arriveAt = tick + REINFORCE_TRAVEL`, remove mission, **skip threat this tick**.
    3. Threat roll: `shortfall = rating × THREAT_BASE_PER_RATING − power`; `threatBar += rating + rng.int(0, 2 × max(0, shortfall))`.
    4. While `threatBar >= THREAT_CAP`: `threatBar −= THREAT_CAP`, `threatLevel++`, consequence fires: victim = random squad member; `dmg = max(1, rating × threatLevel + rng.int(−CONSEQUENCE_SPREAD, CONSEQUENCE_SPREAD))`; victim hp − dmg; at ≤0 the merc is removed from `state.mercs` and the squad, `stats.mercsLost++`.
    5. If squad and inbound are both empty and the mission isn't complete: mission fails — remove it, `reputation = max(0, reputation − rating)`, `stats.jobsFailed++`.

- [ ] **Step 1: Write the failing test**

Create `tests/sim/tick.test.ts`:

```ts
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
  // Work 300 → completes in exactly 20 ticks. Shortfall = 15−15 = 0 → threat
  // is exactly the minimum (3/tick): deterministic despite the rng.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/tick.test.ts`
Expected: FAIL — cannot resolve `src/sim/tick`.

- [ ] **Step 3: Implement**

Create `src/sim/tick.ts`:

```ts
import type { GameState, Mission } from './types'
import { createRng, type Rng } from './rng'
import { squadPower, recordMissionTogether } from './bonds'
import { generateMerc } from './content'
import {
  SCHEMA_VERSION, CYCLE_LENGTH, LOAN, STARTING_CASH, STARTING_ROSTER_SLOTS,
  STARTING_SEATS, OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX, THREAT_BASE_PER_RATING,
  THREAT_CAP, CONSEQUENCE_SPREAD, REINFORCE_TRAVEL, HEAL_INTERVAL, STIM,
} from './balance'

export function newRun(seed: number): GameState {
  const rng = createRng(seed)
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    seed,
    rngState: 0,
    tick: 0,
    status: 'running',
    cash: STARTING_CASH,
    loan: LOAN,
    reputation: 0,
    rosterSlots: STARTING_ROSTER_SLOTS,
    waitingSeats: STARTING_SEATS,
    mercs: [],
    offers: [],
    seated: [],
    missions: [],
    homebound: [],
    bonds: {},
    nextOfferAt: 0,
    nextId: 1,
    stats: { jobsDone: 0, jobsFailed: 0, mercsLost: 0 },
  }
  state.mercs.push(generateMerc(state, rng), generateMerc(state, rng))
  state.nextOfferAt = rng.int(OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX)
  state.rngState = rng.getState()
  return state
}

export function tick(state: GameState): void {
  if (state.status !== 'running') return
  const rng = createRng(state.rngState)
  state.tick++

  for (const mission of [...state.missions]) updateMission(state, mission, rng)

  state.homebound = state.homebound.filter(h => h.arriveAt > state.tick)

  if (state.tick % HEAL_INTERVAL === 0) {
    const away = new Set<number>([
      ...state.missions.flatMap(m => [...m.squad, ...m.inbound.map(i => i.mercId)]),
      ...state.homebound.map(h => h.mercId),
    ])
    for (const merc of state.mercs) {
      if (!away.has(merc.id) && merc.hp < merc.maxHp) merc.hp++
    }
  }

  // offers: task 6 · supply/reinforcement arrivals: task 8 · deadline: task 10
  state.rngState = rng.getState()
}

function updateMission(state: GameState, mission: Mission, rng: Rng): void {
  let power = squadPower(state, mission.squad, mission.environment)
  if (state.tick <= mission.stimUntil) power = Math.floor(power * STIM.multiplier)

  mission.workDone += power
  if (mission.workDone >= mission.workRequired) {
    state.cash += mission.payout
    state.reputation += mission.rating
    state.stats.jobsDone++
    recordMissionTogether(state, mission.squad)
    for (const id of mission.squad) {
      state.homebound.push({ mercId: id, arriveAt: state.tick + REINFORCE_TRAVEL })
    }
    state.missions = state.missions.filter(m => m.id !== mission.id)
    return // no threat on the completing tick
  }

  const shortfall = mission.rating * THREAT_BASE_PER_RATING - power
  mission.threatBar += mission.rating + rng.int(0, 2 * Math.max(0, shortfall))

  while (mission.threatBar >= THREAT_CAP && mission.squad.length > 0) {
    mission.threatBar -= THREAT_CAP
    mission.threatLevel++
    const victimId = mission.squad[rng.int(0, mission.squad.length - 1)]
    const victim = state.mercs.find(m => m.id === victimId)!
    const dmg = Math.max(1, mission.rating * mission.threatLevel + rng.int(-CONSEQUENCE_SPREAD, CONSEQUENCE_SPREAD))
    victim.hp -= dmg
    if (victim.hp <= 0) {
      state.mercs = state.mercs.filter(m => m.id !== victimId)
      mission.squad = mission.squad.filter(id => id !== victimId)
      state.stats.mercsLost++
    }
  }

  if (mission.squad.length === 0 && mission.inbound.length === 0) {
    state.missions = state.missions.filter(m => m.id !== mission.id)
    state.reputation = Math.max(0, state.reputation - mission.rating)
    state.stats.jobsFailed++
  }
}
```

Note `CYCLE_LENGTH` is imported now but only used from Task 10 — if the linter complains, add the deadline check in Task 10 rather than removing the import; or drop it and re-add later. Either is fine.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/sim/tick.test.ts`
Expected: all passed (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/tick.ts tests/sim/tick.test.ts
git commit -m "feat: newRun + mission tick (completion, rolled threat, consequences)"
```

---

### Task 6: Offer stream, waiting room, accept/seat/reject/hire/dispatch

**Files:**
- Create: `src/sim/actions.ts`
- Modify: `src/sim/tick.ts` (offer arrival + expiry, replacing the `// offers: task 6` comment)
- Test: `tests/sim/offers.test.ts`

**Interfaces:**
- Consumes: `generateOffer` (Task 3), `GameState`/`Offer`/`Mission` types.
- Produces (all throw `Error` with a readable message on invalid input; UI disables invalid buttons, so throws indicate bugs):
  - `seatOffer(state, offerId: number): void` — moves offer from `offers` to `seated`; throws if no free seat. Seated offers never expire.
  - `unseatReject(state, offerId: number): void` — exported as `rejectOffer(state, offerId)`: removes the offer from whichever list holds it.
  - `hire(state, offerId: number): void` — candidate offer from either list; throws if roster full or cash < hirePrice; deducts cash, pushes `candidate` into `mercs`.
  - `dispatch(state, offerId: number, mercIds: number[]): number` — job offer from either list; throws if any merc is not idle or list empty; removes offer, creates a Mission (`squad = mercIds`), returns mission id.
  - `idleMercIds(state): number[]` — helper (exported; the UI and harness both need it): mercs not in any squad/inbound/homebound.
  - In `tick()`: when `state.tick >= state.nextOfferAt`, push `generateOffer(...)` and schedule the next (`nextOfferAt = tick + rng.int(OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX)`); then drop every unseated offer with `expiresAt <= tick`.

- [ ] **Step 1: Write the failing test**

Create `tests/sim/offers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { newRun, tick } from '../../src/sim/tick'
import { seatOffer, rejectOffer, hire, dispatch, idleMercIds } from '../../src/sim/actions'
import type { GameState, Offer } from '../../src/sim/types'
import { OFFER_TTL_MAX, STARTING_SEATS } from '../../src/sim/balance'

function jobOffer(state: GameState, rating = 1): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'job', expiresAt: state.tick + 60,
    job: { rating, environment: 'urban', payout: rating * rating * 150, work: rating * 100 },
  }
  state.offers.push(o)
  return o
}

function candidateOffer(state: GameState): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'candidate', expiresAt: state.tick + 60,
    candidate: { id: state.nextId++, name: 'Rook Ash', klass: 'Scout', rank: 1, hp: 20, maxHp: 20, affinity: 'urban', hirePrice: 100 },
  }
  state.offers.push(o)
  return o
}

describe('offer stream in tick', () => {
  it('spawns offers over time and expires unseated ones', () => {
    const s = newRun(10)
    for (let i = 0; i < OFFER_TTL_MAX + 100; i++) tick(s)
    // offers arrived (some may have expired, but the stream is alive)
    expect(s.nextOfferAt).toBeGreaterThan(0)
    for (const o of s.offers) expect(o.expiresAt).toBeGreaterThan(s.tick)
  })

  it('never expires seated offers', () => {
    const s = newRun(11)
    const o = jobOffer(s)
    seatOffer(s, o.id)
    for (let i = 0; i < OFFER_TTL_MAX + 50; i++) tick(s)
    expect(s.seated.some(x => x.id === o.id)).toBe(true)
  })
})

describe('seat/reject', () => {
  it('seats up to capacity then throws', () => {
    const s = newRun(12)
    const offers = [jobOffer(s), jobOffer(s), jobOffer(s)]
    seatOffer(s, offers[0].id)
    seatOffer(s, offers[1].id)
    expect(s.seated).toHaveLength(STARTING_SEATS)
    expect(() => seatOffer(s, offers[2].id)).toThrow(/seat/i)
  })

  it('rejects from either list', () => {
    const s = newRun(13)
    const a = jobOffer(s), b = jobOffer(s)
    seatOffer(s, a.id)
    rejectOffer(s, a.id)
    rejectOffer(s, b.id)
    expect(s.seated).toHaveLength(0)
    expect(s.offers).toHaveLength(0)
  })
})

describe('hire', () => {
  it('moves the candidate into the roster and charges cash', () => {
    const s = newRun(14)
    const o = candidateOffer(s)
    const cash = s.cash
    hire(s, o.id)
    expect(s.mercs).toHaveLength(3)
    expect(s.cash).toBe(cash - 100)
  })

  it('throws when the roster is full', () => {
    const s = newRun(15)
    s.rosterSlots = 2 // roster already has 2 starters
    const o = candidateOffer(s)
    expect(() => hire(s, o.id)).toThrow(/roster/i)
  })

  it('throws when cash is short', () => {
    const s = newRun(16)
    s.cash = 50
    const o = candidateOffer(s)
    expect(() => hire(s, o.id)).toThrow(/cash|afford/i)
  })
})

describe('dispatch', () => {
  it('creates a mission from a job offer with the chosen squad', () => {
    const s = newRun(17)
    const o = jobOffer(s, 2)
    const squad = idleMercIds(s)
    const missionId = dispatch(s, o.id, squad)
    expect(s.offers).toHaveLength(0)
    const m = s.missions.find(x => x.id === missionId)!
    expect(m.squad).toEqual(squad)
    expect(m.workRequired).toBe(200)
    expect(m.threatBar).toBe(0)
  })

  it('refuses mercs that are already deployed', () => {
    const s = newRun(18)
    const a = jobOffer(s, 1), b = jobOffer(s, 1)
    const squad = idleMercIds(s)
    dispatch(s, a.id, squad)
    expect(() => dispatch(s, b.id, squad)).toThrow(/idle/i)
  })

  it('refuses an empty squad', () => {
    const s = newRun(19)
    const o = jobOffer(s, 1)
    expect(() => dispatch(s, o.id, [])).toThrow(/empty/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/offers.test.ts`
Expected: FAIL — cannot resolve `src/sim/actions`.

- [ ] **Step 3: Implement**

Create `src/sim/actions.ts`:

```ts
import type { GameState, Offer } from './types'

export function idleMercIds(state: GameState): number[] {
  const away = new Set<number>([
    ...state.missions.flatMap(m => [...m.squad, ...m.inbound.map(i => i.mercId)]),
    ...state.homebound.map(h => h.mercId),
  ])
  return state.mercs.filter(m => !away.has(m.id)).map(m => m.id)
}

function takeOffer(state: GameState, offerId: number): Offer {
  const fromOffers = state.offers.find(o => o.id === offerId)
  const fromSeated = state.seated.find(o => o.id === offerId)
  const offer = fromOffers ?? fromSeated
  if (!offer) throw new Error(`no offer ${offerId}`)
  state.offers = state.offers.filter(o => o.id !== offerId)
  state.seated = state.seated.filter(o => o.id !== offerId)
  return offer
}

export function seatOffer(state: GameState, offerId: number): void {
  if (state.seated.length >= state.waitingSeats) throw new Error('no free seat')
  const offer = state.offers.find(o => o.id === offerId)
  if (!offer) throw new Error(`no unseated offer ${offerId}`)
  state.offers = state.offers.filter(o => o.id !== offerId)
  state.seated.push(offer)
}

export function rejectOffer(state: GameState, offerId: number): void {
  takeOffer(state, offerId)
}

export function hire(state: GameState, offerId: number): void {
  const offer = state.offers.find(o => o.id === offerId) ?? state.seated.find(o => o.id === offerId)
  if (!offer || offer.kind !== 'candidate') throw new Error(`no candidate offer ${offerId}`)
  const merc = offer.candidate!
  if (state.mercs.length >= state.rosterSlots) throw new Error('roster is full')
  if (state.cash < merc.hirePrice) throw new Error('cannot afford hire')
  takeOffer(state, offerId)
  state.cash -= merc.hirePrice
  state.mercs.push(merc)
}

export function dispatch(state: GameState, offerId: number, mercIds: number[]): number {
  const offer = state.offers.find(o => o.id === offerId) ?? state.seated.find(o => o.id === offerId)
  if (!offer || offer.kind !== 'job') throw new Error(`no job offer ${offerId}`)
  if (mercIds.length === 0) throw new Error('squad is empty')
  const idle = new Set(idleMercIds(state))
  for (const id of mercIds) {
    if (!idle.has(id)) throw new Error(`merc ${id} is not idle`)
  }
  takeOffer(state, offerId)
  const job = offer.job!
  const mission = {
    id: state.nextId++,
    rating: job.rating,
    environment: job.environment,
    payout: job.payout,
    workRequired: job.work,
    workDone: 0,
    threatBar: 0,
    threatLevel: 0,
    squad: [...mercIds],
    inbound: [],
    supplies: [],
    stimUntil: 0,
  }
  state.missions.push(mission)
  return mission.id
}
```

In `src/sim/tick.ts`, replace the `// offers: task 6 ...` comment line with (keep the task-8/task-10 markers):

```ts
  if (state.tick >= state.nextOfferAt) {
    state.offers.push(generateOffer(state, rng))
    state.nextOfferAt = state.tick + rng.int(OFFER_ARRIVAL_MIN, OFFER_ARRIVAL_MAX)
  }
  state.offers = state.offers.filter(o => o.expiresAt > state.tick)
  // supply/reinforcement arrivals: task 8 · deadline: task 10
```

and add `generateOffer` to the import from `./content`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all suites pass (rng, content, bonds, tick, offers).

- [ ] **Step 5: Commit**

```bash
git add src/sim/actions.ts src/sim/tick.ts tests/sim/offers.test.ts
git commit -m "feat: offer stream, waiting room, hire and dispatch actions"
```

---

### Task 7: Dismiss, purchases, medbay

**Files:**
- Modify: `src/sim/actions.ts`
- Test: `tests/sim/roster.test.ts`

**Interfaces:**
- Consumes: `idleMercIds` (Task 6), balance constants.
- Produces:
  - `dismiss(state, mercId: number): void` — idle mercs only; removes from roster (bond records remain in `state.bonds`, harmlessly orphaned — this is the spec's "the bonus simply ceases to exist").
  - `buySlot(state): void` — price `SLOT_PRICES[rosterSlots − STARTING_ROSTER_SLOTS]`; throws at `MAX_ROSTER_SLOTS` or short cash.
  - `buySeat(state): void` — `SEAT_PRICE`; throws at `MAX_SEATS` or short cash.
  - `medbayHeal(state, mercId: number): number` — idle mercs only; charges `(maxHp − hp) × MEDBAY_PER_HP`, sets hp to max, returns the price paid; throws if already at full hp or short cash.

- [ ] **Step 1: Write the failing test**

Create `tests/sim/roster.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { newRun } from '../../src/sim/tick'
import { dismiss, buySlot, buySeat, medbayHeal, dispatch, idleMercIds } from '../../src/sim/actions'
import type { GameState, Offer } from '../../src/sim/types'
import { SLOT_PRICES, SEAT_PRICE, MAX_ROSTER_SLOTS, MAX_SEATS, MEDBAY_PER_HP, STARTING_ROSTER_SLOTS } from '../../src/sim/balance'

function jobOffer(state: GameState): Offer {
  const o: Offer = {
    id: state.nextId++, kind: 'job', expiresAt: state.tick + 60,
    job: { rating: 1, environment: 'urban', payout: 150, work: 100 },
  }
  state.offers.push(o)
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

  it('sells the third seat once', () => {
    const s = newRun(23)
    s.cash = 10000
    buySeat(s)
    expect(s.waitingSeats).toBe(MAX_SEATS)
    expect(s.cash).toBe(10000 - SEAT_PRICE)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/roster.test.ts`
Expected: FAIL — `dismiss` is not exported.

- [ ] **Step 3: Implement**

Append to `src/sim/actions.ts` (add the balance imports it needs):

```ts
import {
  SLOT_PRICES, SEAT_PRICE, MAX_ROSTER_SLOTS, MAX_SEATS,
  MEDBAY_PER_HP, STARTING_ROSTER_SLOTS,
} from './balance'

export function dismiss(state: GameState, mercId: number): void {
  if (!idleMercIds(state).includes(mercId)) throw new Error('merc is not idle')
  state.mercs = state.mercs.filter(m => m.id !== mercId)
}

export function buySlot(state: GameState): void {
  if (state.rosterSlots >= MAX_ROSTER_SLOTS) throw new Error('roster slots at max')
  const price = SLOT_PRICES[state.rosterSlots - STARTING_ROSTER_SLOTS]
  if (state.cash < price) throw new Error('cannot afford slot')
  state.cash -= price
  state.rosterSlots++
}

export function buySeat(state: GameState): void {
  if (state.waitingSeats >= MAX_SEATS) throw new Error('seats at max')
  if (state.cash < SEAT_PRICE) throw new Error('cannot afford seat')
  state.cash -= SEAT_PRICE
  state.waitingSeats++
}

export function medbayHeal(state: GameState, mercId: number): number {
  if (!idleMercIds(state).includes(mercId)) throw new Error('merc is not idle')
  const merc = state.mercs.find(m => m.id === mercId)!
  const missing = merc.maxHp - merc.hp
  if (missing <= 0) throw new Error('already at full hp')
  const price = missing * MEDBAY_PER_HP
  if (state.cash < price) throw new Error('cannot afford heal')
  state.cash -= price
  merc.hp = merc.maxHp
  return price
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/actions.ts tests/sim/roster.test.ts
git commit -m "feat: dismiss, slot/seat purchases, medbay healing"
```

---

### Task 8: Reinforce, withdraw, supplies (mid-mission intervention)

**Files:**
- Modify: `src/sim/actions.ts`, `src/sim/tick.ts`
- Test: `tests/sim/intervention.test.ts`

**Interfaces:**
- Consumes: mission/inbound/supply types, `MEDKIT`/`SUPPRESSOR`/`STIM`/`REINFORCE_TRAVEL`/`SUPPLY_TRAVEL`.
- Produces:
  - `reinforce(state, missionId, mercId): void` — idle merc → `mission.inbound` with `arriveAt = tick + REINFORCE_TRAVEL`.
  - `withdraw(state, missionId, mercId): void` — merc in `squad` → removed, pushed to `state.homebound` with `arriveAt = tick + REINFORCE_TRAVEL`. Withdrawing the last member (with nothing inbound) lets the mission fail on the next tick — the spec's soft abandon.
  - `sendSupply(state, missionId, type: SupplyType): void` — charges the type's price, pushes to `mission.supplies` with `arriveAt = tick + SUPPLY_TRAVEL`.
  - In `tick.ts` `updateMission`, **arrivals process first**, before completion/threat: inbound with `arriveAt <= tick` join `squad`; supplies with `arriveAt <= tick` apply — medkit heals the lowest-hp squad member by `MEDKIT.heal` (capped at max), suppressor sets `threatBar = max(0, threatBar − SUPPRESSOR.reduce)`, stim sets `stimUntil = tick + STIM.duration`.

- [ ] **Step 1: Write the failing test**

Create `tests/sim/intervention.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/intervention.test.ts`
Expected: FAIL — `reinforce` is not exported.

- [ ] **Step 3: Implement**

Append to `src/sim/actions.ts`:

```ts
import type { SupplyType } from './types'
import { MEDKIT, SUPPRESSOR, STIM, REINFORCE_TRAVEL, SUPPLY_TRAVEL } from './balance'

const SUPPLY_PRICES: Record<SupplyType, number> = {
  medkit: MEDKIT.price,
  suppressor: SUPPRESSOR.price,
  stim: STIM.price,
}

function findMission(state: GameState, missionId: number) {
  const mission = state.missions.find(m => m.id === missionId)
  if (!mission) throw new Error(`no mission ${missionId}`)
  return mission
}

export function reinforce(state: GameState, missionId: number, mercId: number): void {
  const mission = findMission(state, missionId)
  if (!idleMercIds(state).includes(mercId)) throw new Error('merc is not idle')
  mission.inbound.push({ mercId, arriveAt: state.tick + REINFORCE_TRAVEL })
}

export function withdraw(state: GameState, missionId: number, mercId: number): void {
  const mission = findMission(state, missionId)
  if (!mission.squad.includes(mercId)) throw new Error('merc is not on this mission')
  mission.squad = mission.squad.filter(id => id !== mercId)
  state.homebound.push({ mercId, arriveAt: state.tick + REINFORCE_TRAVEL })
}

export function sendSupply(state: GameState, missionId: number, type: SupplyType): void {
  const mission = findMission(state, missionId)
  const price = SUPPLY_PRICES[type]
  if (state.cash < price) throw new Error('cannot afford supply')
  state.cash -= price
  mission.supplies.push({ type, arriveAt: state.tick + SUPPLY_TRAVEL })
}
```

In `src/sim/tick.ts` `updateMission`, insert at the **top** (before the power calculation), and add `MEDKIT`/`SUPPRESSOR` to the balance import (STIM is already imported):

```ts
  // arrivals first: reinforcements join, supplies land
  const arrived = mission.inbound.filter(i => i.arriveAt <= state.tick)
  mission.inbound = mission.inbound.filter(i => i.arriveAt > state.tick)
  mission.squad.push(...arrived.map(i => i.mercId))

  const landed = mission.supplies.filter(su => su.arriveAt <= state.tick)
  mission.supplies = mission.supplies.filter(su => su.arriveAt > state.tick)
  for (const supply of landed) {
    if (supply.type === 'medkit') {
      const squadMercs = state.mercs.filter(m => mission.squad.includes(m.id))
      const target = squadMercs.sort((a, b) => a.hp - b.hp)[0]
      if (target) target.hp = Math.min(target.maxHp, target.hp + MEDKIT.heal)
    } else if (supply.type === 'suppressor') {
      mission.threatBar = Math.max(0, mission.threatBar - SUPPRESSOR.reduce)
    } else {
      mission.stimUntil = state.tick + STIM.duration
    }
  }
```

Also remove the now-obsolete `// supply/reinforcement arrivals: task 8` marker in `tick()`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/actions.ts src/sim/tick.ts tests/sim/intervention.test.ts
git commit -m "feat: reinforce, withdraw, and supply drops with travel delays"
```

---

### Task 9: Dispatch projection

**Files:**
- Create: `src/sim/projection.ts`
- Test: `tests/sim/projection.test.ts`

**Interfaces:**
- Consumes: `squadPower` (Task 4), balance anchors.
- Produces:

```ts
export interface Projection {
  power: number
  shortfall: number          // BTI − power (can be negative)
  durationTicks: number      // Infinity when power is 0
  minConsequences: number
  expectedConsequences: number
  maxConsequences: number
}
export function project(state: GameState, mercIds: number[], rating: number, environment: Environment): Projection
```

The UI (Task 14) renders this as "~20 ticks · 2–4 consequences likely". Formulas (must mirror `tick.ts` exactly — this is why both import `squadPower` and the same constants):
- `power = squadPower(state, mercIds, environment)` (no stim — projections are pre-launch)
- `durationTicks = ceil(rating × WORK_PER_RATING / power)`
- `shortfall = rating × THREAT_BASE_PER_RATING − power`
- min/expected/max threat per tick = `rating`, `rating + max(0,shortfall)`, `rating + 2 × max(0,shortfall)`
- consequences = `floor(durationTicks × threatPerTick / THREAT_CAP)` for each of the three rates.

- [ ] **Step 1: Write the failing test**

Create `tests/sim/projection.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/projection.test.ts`
Expected: FAIL — cannot resolve `src/sim/projection`.

- [ ] **Step 3: Implement**

Create `src/sim/projection.ts`:

```ts
import type { GameState, Environment } from './types'
import { squadPower } from './bonds'
import { WORK_PER_RATING, THREAT_BASE_PER_RATING, THREAT_CAP } from './balance'

export interface Projection {
  power: number
  shortfall: number
  durationTicks: number
  minConsequences: number
  expectedConsequences: number
  maxConsequences: number
}

export function project(
  state: GameState, mercIds: number[], rating: number, environment: Environment,
): Projection {
  const power = squadPower(state, mercIds, environment)
  const durationTicks = power > 0 ? Math.ceil((rating * WORK_PER_RATING) / power) : Infinity
  const shortfall = rating * THREAT_BASE_PER_RATING - power
  const over = Math.max(0, shortfall)
  const consequencesAt = (perTick: number) =>
    Number.isFinite(durationTicks) ? Math.floor((durationTicks * perTick) / THREAT_CAP) : Infinity
  return {
    power,
    shortfall,
    durationTicks,
    minConsequences: consequencesAt(rating),
    expectedConsequences: consequencesAt(rating + over),
    maxConsequences: consequencesAt(rating + 2 * over),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/projection.ts tests/sim/projection.test.ts
git commit -m "feat: dispatch projection sharing squadPower with the tick"
```

---

### Task 10: Deadline, determinism, and save round-trip

**Files:**
- Modify: `src/sim/tick.ts` (deadline evaluation)
- Test: `tests/sim/run.test.ts`

**Interfaces:**
- Produces: at the end of `tick()` (replacing the `// deadline: task 10` marker): when `state.tick >= CYCLE_LENGTH`, set `status = cash >= loan ? 'won' : 'lost'`. Nothing else in the sim needs to change — the UI (Task 12) reacts to `status`.
- Also locks in two properties later tasks rely on: **same seed → byte-identical run**, and **`JSON.parse(JSON.stringify(state))` is a complete save** (no classes, Maps, or functions anywhere in `GameState`).

- [ ] **Step 1: Write the failing test**

Create `tests/sim/run.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/run.test.ts`
Expected: the deadline tests FAIL (status stays `running`); determinism tests may already pass.

- [ ] **Step 3: Implement**

In `src/sim/tick.ts`, replace the `// deadline: task 10` marker (immediately before `state.rngState = rng.getState()`) with:

```ts
  if (state.tick >= CYCLE_LENGTH) {
    state.status = state.cash >= state.loan ? 'won' : 'lost'
  }
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/sim/tick.ts tests/sim/run.test.ts
git commit -m "feat: deadline win/lose + determinism and save round-trip guarantees"
```

---

### Task 11: Headless balance harness

**Files:**
- Create: `scripts/simulate.ts`
- Test: `tests/sim/harness.test.ts`

**Interfaces:**
- Consumes: the whole sim API (`newRun`, `tick`, actions, `project`).
- Produces:
  - `botAct(state: GameState): void` — one decision pass (exported for tests).
  - `runOne(seed: number): GameState` — plays a full run: `botAct` then `tick` until the run ends.
  - CLI: `npm run sim -- 500` plays 500 seeded runs and prints win rate, mean final cash, mercs lost, jobs done/failed, and the 5 worst seeds for reproduction.
- Bot policy (deliberately simple — it's a balance yardstick, not an AI):
  1. Hire any candidate (unseated or seated) if a roster slot is free and `cash − hirePrice ≥ 200`.
  2. For the highest-rated available job: if `project(...)` over all idle mercs gives `shortfall ≤ rating` (near-fully staffed), dispatch all idle mercs.
  3. Seat the best job it can't staff yet if a seat is free.
  4. For each mission with `threatBar ≥ 14`, send a suppressor if `cash ≥ price + 200`.

- [ ] **Step 1: Write the failing test**

Create `tests/sim/harness.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runOne } from '../../scripts/simulate'

describe('balance harness', () => {
  it('plays a full run to a terminal state, deterministically', () => {
    const a = runOne(1), b = runOne(1)
    expect(['won', 'lost']).toContain(a.status)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('the bot actually plays (some jobs get done across seeds)', () => {
    let jobs = 0
    for (let seed = 1; seed <= 5; seed++) jobs += runOne(seed).stats.jobsDone
    expect(jobs).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sim/harness.test.ts`
Expected: FAIL — cannot resolve `scripts/simulate`.

- [ ] **Step 3: Implement**

Create `scripts/simulate.ts`:

```ts
import { pathToFileURL } from 'node:url'
import type { GameState } from '../src/sim/types'
import { newRun, tick } from '../src/sim/tick'
import { hire, dispatch, seatOffer, sendSupply, idleMercIds } from '../src/sim/actions'
import { project } from '../src/sim/projection'
import { SUPPRESSOR } from '../src/sim/balance'

const RESERVE = 200

export function botAct(state: GameState): void {
  // 1. hire affordable candidates when a slot is free
  for (const offer of [...state.offers, ...state.seated]) {
    if (offer.kind !== 'candidate') continue
    if (state.mercs.length >= state.rosterSlots) break
    if (state.cash - offer.candidate!.hirePrice >= RESERVE) hire(state, offer.id)
  }

  // 2. dispatch all idle mercs to the best job they can nearly fully staff
  const idle = idleMercIds(state)
  if (idle.length > 0) {
    const jobs = [...state.offers, ...state.seated]
      .filter(o => o.kind === 'job')
      .sort((a, b) => b.job!.rating - a.job!.rating)
    for (const offer of jobs) {
      const p = project(state, idle, offer.job!.rating, offer.job!.environment)
      if (p.shortfall <= offer.job!.rating) {
        dispatch(state, offer.id, idle)
        break
      }
    }
  }

  // 3. seat the best unstaffable job if there's room
  if (state.seated.length < state.waitingSeats) {
    const best = state.offers
      .filter(o => o.kind === 'job')
      .sort((a, b) => b.job!.rating - a.job!.rating)[0]
    if (best) seatOffer(state, best.id)
  }

  // 4. suppress missions about to tick over
  for (const mission of state.missions) {
    if (mission.threatBar >= 14 && state.cash >= SUPPRESSOR.price + RESERVE) {
      sendSupply(state, mission.id, 'suppressor')
    }
  }
}

export function runOne(seed: number): GameState {
  const state = newRun(seed)
  while (state.status === 'running') {
    botAct(state)
    tick(state)
  }
  return state
}

function main(): void {
  const n = Number(process.argv[2] ?? 500)
  let wins = 0, cash = 0, lost = 0, done = 0, failed = 0
  const worst: { seed: number; cash: number }[] = []
  for (let seed = 1; seed <= n; seed++) {
    const s = runOne(seed)
    if (s.status === 'won') wins++
    cash += s.cash
    lost += s.stats.mercsLost
    done += s.stats.jobsDone
    failed += s.stats.jobsFailed
    worst.push({ seed, cash: s.cash })
  }
  worst.sort((a, b) => a.cash - b.cash)
  console.log(`runs: ${n}`)
  console.log(`win rate: ${((wins / n) * 100).toFixed(1)}%`)
  console.log(`mean final cash: ${(cash / n).toFixed(0)}cr (loan is the bar)`)
  console.log(`mean jobs done/failed: ${(done / n).toFixed(1)} / ${(failed / n).toFixed(1)}`)
  console.log(`mean mercs lost: ${(lost / n).toFixed(2)}`)
  console.log(`worst seeds: ${worst.slice(0, 5).map(w => `${w.seed} (${w.cash}cr)`).join(', ')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
```

- [ ] **Step 4: Run tests and the harness itself**

Run: `npm test`
Expected: all pass.

Run: `npm run sim -- 200`
Expected: a summary block prints. **Record the win rate in the commit message.** If it is under 20% or over 95%, file that fact in the final report — Task 17 (balance pass) will tune `balance.ts`; do not tune it in this task.

- [ ] **Step 5: Commit**

```bash
git add scripts/simulate.ts tests/sim/harness.test.ts
git commit -m "feat: headless balance harness (bot win rate: <X>% over 200 seeds)"
```

---

### Task 12: Game store, loop driver, header shell

**Files:**
- Create: `src/ui/store.svelte.ts` (the `.svelte.ts` extension is required for Svelte 5 runes in a TS module)
- Modify: `src/App.svelte`, `src/app.css` (replace Vite template content), delete template cruft (`src/lib/Counter.svelte`, `src/assets`)
- Test: `npm run build` + manual/Playwright smoke (UI tasks are covered by the sim tests underneath plus the Task 16 e2e; don't write DOM unit tests)

**Interfaces:**
- Consumes: `newRun`, `tick`, `SCHEMA_VERSION`, `CYCLE_LENGTH`.
- Produces (used by every tab component):
  - `game` — a `$state` object: `{ state: GameState, paused: boolean }`. Components mutate nothing directly; they call sim actions then `saveNow()`.
  - `startLoop(): void` — 1 tick/sec while unpaused and running; auto-saves; pauses on `visibilitychange` hidden.
  - `togglePause(): void`, `restart(): void` (new seed, clears save), `saveNow(): void`
  - `act(fn: () => void): void` — runs a sim action, swallows nothing (rethrows), saves on success. All button handlers go through it.
  - URL params for testing: `?seed=N` (deterministic new run when no save exists) and `?speed=N` (tick interval `1000/N` ms — e2e uses `speed=20`).

- [ ] **Step 1: Implement the store**

Create `src/ui/store.svelte.ts`:

```ts
import { newRun, tick } from '../sim/tick'
import type { GameState } from '../sim/types'
import { SCHEMA_VERSION } from '../sim/balance'

const SAVE_KEY = 'merc-company-save-v1'

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search)
}

function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const state = JSON.parse(raw) as GameState
    if (state.schemaVersion !== SCHEMA_VERSION) return null
    return state
  } catch {
    return null
  }
}

function freshState(): GameState {
  const seedParam = params().get('seed')
  return newRun(seedParam ? Number(seedParam) : Date.now() % 0xffffffff)
}

export const game = $state({
  state: load() ?? freshState(),
  paused: false,
})

export function saveNow(): void {
  localStorage.setItem(SAVE_KEY, JSON.stringify(game.state))
}

export function act(fn: () => void): void {
  fn()
  saveNow()
}

export function togglePause(): void {
  game.paused = !game.paused
}

export function restart(): void {
  localStorage.removeItem(SAVE_KEY)
  game.state = freshState()
  game.paused = false
}

let started = false
export function startLoop(): void {
  if (started) return
  started = true
  const speed = Number(params().get('speed') ?? 1)
  setInterval(() => {
    if (!game.paused && game.state.status === 'running') {
      tick(game.state)
      saveNow()
    }
  }, 1000 / Math.max(speed, 0.001))
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.paused = true
      saveNow()
    }
  })
  // e2e hook: lets Playwright assert on raw state
  ;(window as any).__game = game
}
```

- [ ] **Step 2: Replace App.svelte with the header + tab shell**

Replace `src/App.svelte`:

```svelte
<script lang="ts">
  import { game, startLoop, togglePause } from './ui/store.svelte'
  import { CYCLE_LENGTH } from './sim/balance'
  import RosterTab from './ui/RosterTab.svelte'
  import JobsTab from './ui/JobsTab.svelte'
  import MissionsTab from './ui/MissionsTab.svelte'
  import EndScreen from './ui/EndScreen.svelte'

  let tab: 'roster' | 'jobs' | 'missions' = $state('jobs')
  startLoop()

  const ticksLeft = $derived(Math.max(0, CYCLE_LENGTH - game.state.tick))
  const clock = $derived(
    `${Math.floor(ticksLeft / 60)}:${String(ticksLeft % 60).padStart(2, '0')}`,
  )
  const dangerCount = $derived(game.state.missions.filter(m => m.threatBar >= 12).length)
</script>

<header>
  <span class="cash">{game.state.cash}cr</span>
  <span class="loan">loan {game.state.loan}cr · {clock}</span>
  <span class="rep">rep {game.state.reputation}</span>
  <button class="pause" onclick={togglePause}>{game.paused ? '▶' : '⏸'}</button>
</header>

<main>
  {#if tab === 'roster'}<RosterTab />{/if}
  {#if tab === 'jobs'}<JobsTab />{/if}
  {#if tab === 'missions'}<MissionsTab />{/if}
</main>

<nav>
  <button class:active={tab === 'roster'} onclick={() => (tab = 'roster')}>
    Roster ({game.state.mercs.length}/{game.state.rosterSlots})
  </button>
  <button class:active={tab === 'jobs'} onclick={() => (tab = 'jobs')}>
    Jobs ({game.state.offers.length + game.state.seated.length})
  </button>
  <button class:active={tab === 'missions'} onclick={() => (tab = 'missions')}>
    Missions ({game.state.missions.length}){#if dangerCount > 0}<span class="danger-badge">{dangerCount}</span>{/if}
  </button>
</nav>

{#if game.state.status !== 'running'}
  <EndScreen />
{/if}
```

For this task, create placeholder tab components so the app builds — each will be fully implemented in Tasks 13–15. Example `src/ui/RosterTab.svelte` (same shape for `JobsTab.svelte`, `MissionsTab.svelte`, `EndScreen.svelte`):

```svelte
<p>roster tab — task 13</p>
```

- [ ] **Step 3: Replace `src/app.css` with the base theme**

```css
:root {
  color-scheme: dark;
  font-family: system-ui, sans-serif;
  --bg: #16181d;
  --panel: #22252d;
  --line: #363b47;
  --text: #e8e6e3;
  --dim: #9a9689;
  --accent: #d4a24e;
  --danger: #c0504d;
  --ok: #6a9955;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
#app { display: flex; flex-direction: column; height: 100dvh; max-width: 480px; margin: 0 auto; }
header { display: flex; gap: 0.75rem; align-items: center; padding: 0.6rem 0.8rem; background: var(--panel); border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
header .cash { color: var(--accent); font-weight: 700; }
header .loan { color: var(--dim); flex: 1; }
header .pause { background: none; border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 0.2rem 0.6rem; }
main { flex: 1; overflow-y: auto; padding: 0.8rem; }
nav { display: flex; border-top: 1px solid var(--line); background: var(--panel); }
nav button { flex: 1; padding: 0.8rem 0.2rem; background: none; border: none; color: var(--dim); font-size: 0.85rem; position: relative; }
nav button.active { color: var(--accent); font-weight: 700; }
.danger-badge { position: absolute; top: 6px; right: 12%; background: var(--danger); color: #fff; border-radius: 999px; font-size: 0.65rem; padding: 0 5px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 0.7rem; margin-bottom: 0.7rem; }
.bar { height: 8px; background: var(--bg); border-radius: 4px; overflow: hidden; margin: 0.3rem 0; }
.bar > div { height: 100%; }
button.action { background: var(--accent); border: none; color: #1a1a1a; font-weight: 700; border-radius: 6px; padding: 0.45rem 0.8rem; }
button.ghost { background: none; border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 0.45rem 0.8rem; }
button:disabled { opacity: 0.4; }
.dim { color: var(--dim); font-size: 0.85rem; }
```

Ensure `src/main.ts` imports `./app.css` and mounts `App` (the Vite template already does; adjust if it references removed files).

- [ ] **Step 4: Verify**

Run: `npm test` — sim tests still pass.
Run: `npm run build` — builds clean.
Run: `npm run dev`, open `http://localhost:5173/?seed=1` in a 390×844 viewport (Playwright MCP `browser_resize` or devtools). Expected: header shows 500cr, loan 5000cr, a ticking clock; three tabs switch between placeholders; pause button freezes the clock.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: game store, tick loop, header + tab shell"
```

---

### Task 13: Roster tab

**Files:**
- Create: `src/ui/RosterTab.svelte` (replace placeholder)

**Interfaces:**
- Consumes: `game`, `act` from store; `dismiss`, `medbayHeal`, `buySlot`, `idleMercIds` from `src/sim/actions`; `pairKey`, `bondLevel` from `src/sim/bonds`; `SLOT_PRICES`, `STARTING_ROSTER_SLOTS`, `MAX_ROSTER_SLOTS`, `MEDBAY_PER_HP` from balance.
- Produces: the roster grid per the spec — merc cards, bond badges with partner highlight, dismiss with confirm, medbay heal, slot purchase.

- [ ] **Step 1: Implement**

Replace `src/ui/RosterTab.svelte`:

```svelte
<script lang="ts">
  import { game, act } from './store.svelte'
  import { dismiss, medbayHeal, buySlot, idleMercIds } from '../sim/actions'
  import { pairKey, bondLevel } from '../sim/bonds'
  import { SLOT_PRICES, STARTING_ROSTER_SLOTS, MAX_ROSTER_SLOTS, MEDBAY_PER_HP } from '../sim/balance'

  let confirmingDismiss: number | null = $state(null)
  let highlighted: number | null = $state(null)

  const idle = $derived(new Set(idleMercIds(game.state)))
  const traveling = $derived(new Set(game.state.homebound.map(h => h.mercId)))

  function status(id: number): string {
    if (idle.has(id)) return 'idle'
    if (traveling.has(id)) return 'traveling'
    return 'on mission'
  }

  function bondsFor(id: number): { partnerId: number; name: string; level: number }[] {
    return game.state.mercs
      .filter(other => other.id !== id)
      .map(other => ({ partnerId: other.id, name: other.name, level: bondLevel(game.state.bonds[pairKey(id, other.id)] ?? 0) }))
      .filter(b => b.level > 0)
  }

  const nextSlotPrice = $derived(
    game.state.rosterSlots < MAX_ROSTER_SLOTS
      ? SLOT_PRICES[game.state.rosterSlots - STARTING_ROSTER_SLOTS]
      : null,
  )
</script>

{#each game.state.mercs as merc (merc.id)}
  <div class="card" class:highlight={highlighted === merc.id}>
    <div class="row">
      <strong>{merc.name}</strong>
      <span class="dim">{merc.klass} · {'★'.repeat(merc.rank)} · {merc.affinity}</span>
    </div>
    <div class="bar"><div style="width:{(merc.hp / merc.maxHp) * 100}%; background:var(--ok)"></div></div>
    <div class="row dim">
      <span>{merc.hp}/{merc.maxHp} hp · {status(merc.id)}</span>
    </div>
    {#each bondsFor(merc.id) as bond (bond.partnerId)}
      <button class="bond" onclick={() => (highlighted = highlighted === bond.partnerId ? null : bond.partnerId)}>
        🔗 {bond.name} {'★'.repeat(bond.level)}
      </button>
    {/each}
    <div class="row">
      {#if merc.hp < merc.maxHp && idle.has(merc.id)}
        <button
          class="ghost"
          disabled={game.state.cash < (merc.maxHp - merc.hp) * MEDBAY_PER_HP}
          onclick={() => act(() => medbayHeal(game.state, merc.id))}
        >
          heal {(merc.maxHp - merc.hp) * MEDBAY_PER_HP}cr
        </button>
      {/if}
      {#if confirmingDismiss === merc.id}
        <button class="ghost danger" onclick={() => act(() => dismiss(game.state, merc.id))}>confirm dismissal</button>
        <button class="ghost" onclick={() => (confirmingDismiss = null)}>keep</button>
      {:else}
        <button class="ghost" disabled={!idle.has(merc.id)} onclick={() => (confirmingDismiss = merc.id)}>dismiss</button>
      {/if}
    </div>
  </div>
{/each}

{#each Array(Math.max(0, game.state.rosterSlots - game.state.mercs.length)) as _, i (i)}
  <div class="card empty dim">empty slot</div>
{/each}

{#if nextSlotPrice !== null}
  <button class="card locked dim" disabled={game.state.cash < nextSlotPrice} onclick={() => act(() => buySlot(game.state))}>
    🔒 unlock slot — {nextSlotPrice}cr
  </button>
{/if}

<style>
  .row { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .card.highlight { border-color: var(--accent); }
  .card.empty, .card.locked { text-align: center; width: 100%; }
  .bond { background: none; border: none; color: var(--accent); padding: 0.15rem 0; display: block; font-size: 0.85rem; }
  .danger { border-color: var(--danger); color: var(--danger); }
</style>
```

- [ ] **Step 2: Verify**

Run: `npm run build` — clean. Then `npm run dev` with `?seed=1`: two starter mercs render with hp bars and idle status; dismiss asks for confirmation; the locked-slot card is disabled at 500cr (first slot costs 300 — enabled; buying it drops cash to 200 in the header).

- [ ] **Step 3: Commit**

```bash
git add src/ui/RosterTab.svelte
git commit -m "feat: roster tab with bond badges, dismiss confirm, medbay, slot purchase"
```

---

### Task 14: Jobs tab + dispatch sheet

**Files:**
- Create: `src/ui/JobsTab.svelte`, `src/ui/DispatchSheet.svelte` (replace placeholder)

**Interfaces:**
- Consumes: store; `seatOffer`, `rejectOffer`, `hire`, `dispatch`, `buySeat`, `idleMercIds` from actions; `project` from projection; `SEAT_PRICE`, `MAX_SEATS` from balance.
- Produces: the offer stream + waiting room UI, and the dispatch modal with the live projection. `DispatchSheet` takes props `{ offer: Offer, onclose: () => void }`.

- [ ] **Step 1: Implement JobsTab**

Replace `src/ui/JobsTab.svelte`:

```svelte
<script lang="ts">
  import { game, act } from './store.svelte'
  import { seatOffer, rejectOffer, hire, buySeat } from '../sim/actions'
  import { SEAT_PRICE, MAX_SEATS } from '../sim/balance'
  import type { Offer } from '../sim/types'
  import DispatchSheet from './DispatchSheet.svelte'

  let dispatching: Offer | null = $state(null)

  function ttl(offer: Offer): number {
    return Math.max(0, offer.expiresAt - game.state.tick)
  }
</script>

<section>
  <h3 class="dim">waiting room ({game.state.seated.length}/{game.state.waitingSeats})</h3>
  {#each game.state.seated as offer (offer.id)}
    {@render offerCard(offer, true)}
  {/each}
  {#if game.state.seated.length === 0}
    <p class="dim">empty seats</p>
  {/if}
  {#if game.state.waitingSeats < MAX_SEATS}
    <button class="ghost" disabled={game.state.cash < SEAT_PRICE} onclick={() => act(() => buySeat(game.state))}>
      add a seat — {SEAT_PRICE}cr
    </button>
  {/if}
</section>

<section>
  <h3 class="dim">at the door</h3>
  {#each game.state.offers as offer (offer.id)}
    {@render offerCard(offer, false)}
  {/each}
  {#if game.state.offers.length === 0}
    <p class="dim">nobody at the door — they'll come</p>
  {/if}
</section>

{#if dispatching}
  <DispatchSheet offer={dispatching} onclose={() => (dispatching = null)} />
{/if}

{#snippet offerCard(offer: Offer, seated: boolean)}
  <div class="card">
    {#if offer.kind === 'job'}
      <div class="row">
        <strong>{'★'.repeat(offer.job!.rating)} job · {offer.job!.environment}</strong>
        <span class="payout">{offer.job!.payout}cr</span>
      </div>
    {:else}
      <div class="row">
        <strong>{offer.candidate!.name}</strong>
        <span class="dim">{offer.candidate!.klass} · {'★'.repeat(offer.candidate!.rank)} · {offer.candidate!.affinity}</span>
      </div>
      <div class="row dim"><span>hire for {offer.candidate!.hirePrice}cr</span></div>
    {/if}
    {#if !seated}
      <div class="bar"><div style="width:{Math.min(100, ttl(offer))}%; background:var(--danger)"></div></div>
      <div class="dim">{ttl(offer)}s before they walk</div>
    {/if}
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
      {#if !seated}
        <button class="ghost" disabled={game.state.seated.length >= game.state.waitingSeats} onclick={() => act(() => seatOffer(game.state, offer.id))}>
          take a seat
        </button>
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

- [ ] **Step 2: Implement DispatchSheet**

Replace `src/ui/DispatchSheet.svelte`:

```svelte
<script lang="ts">
  import { game, act } from './store.svelte'
  import { dispatch, idleMercIds } from '../sim/actions'
  import { project } from '../sim/projection'
  import type { Offer } from '../sim/types'

  let { offer, onclose }: { offer: Offer; onclose: () => void } = $props()

  let selected: number[] = $state([])
  const idle = $derived(idleMercIds(game.state))
  const idleMercs = $derived(game.state.mercs.filter(m => idle.includes(m.id)))
  const forecast = $derived(project(game.state, selected, offer.job!.rating, offer.job!.environment))

  function toggle(id: number): void {
    selected = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
  }

  function launch(): void {
    act(() => dispatch(game.state, offer.id, selected))
    onclose()
  }
</script>

<div class="overlay">
  <div class="sheet">
    <h3>{'★'.repeat(offer.job!.rating)} {offer.job!.environment} job · {offer.job!.payout}cr</h3>

    {#each idleMercs as merc (merc.id)}
      <button class="pick" class:on={selected.includes(merc.id)} onclick={() => toggle(merc.id)}>
        {merc.name} · {'★'.repeat(merc.rank)}
        {#if merc.affinity === offer.job!.environment}<span class="match">home turf ×2</span>{/if}
        <span class="dim">{merc.hp}/{merc.maxHp} hp</span>
      </button>
    {/each}
    {#if idleMercs.length === 0}
      <p class="dim">nobody is idle</p>
    {/if}

    <div class="forecast">
      {#if selected.length === 0}
        <span class="dim">pick a squad</span>
      {:else}
        <div>duration: ~{forecast.durationTicks}s</div>
        <div class:hot={forecast.maxConsequences > forecast.minConsequences + 2}>
          risk: {forecast.minConsequences === forecast.maxConsequences
            ? `${forecast.minConsequences} consequences`
            : `${forecast.minConsequences}–${forecast.maxConsequences} consequences (likely ${forecast.expectedConsequences})`}
        </div>
      {/if}
    </div>

    <div class="row">
      <button class="action" disabled={selected.length === 0} onclick={launch}>send them</button>
      <button class="ghost" onclick={onclose}>back</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: flex-end; z-index: 10; }
  .sheet { background: var(--panel); width: 100%; max-width: 480px; margin: 0 auto; border-radius: 14px 14px 0 0; padding: 1rem; max-height: 80dvh; overflow-y: auto; }
  .pick { display: flex; gap: 0.5rem; justify-content: space-between; width: 100%; text-align: left; background: var(--bg); border: 1px solid var(--line); color: var(--text); border-radius: 8px; padding: 0.6rem; margin-bottom: 0.4rem; }
  .pick.on { border-color: var(--accent); }
  .match { color: var(--ok); font-size: 0.8rem; }
  .forecast { margin: 0.8rem 0; font-variant-numeric: tabular-nums; }
  .hot { color: var(--danger); }
  .row { display: flex; gap: 0.5rem; }
</style>
```

- [ ] **Step 3: Verify**

`npm run build` clean. `npm run dev` with `?seed=1&speed=10`: offers arrive within seconds; a job card's timer bar drains; "take a seat" moves it to the waiting room and the timer note disappears; accepting opens the sheet; tapping mercs updates duration/risk live (affinity matches show "home turf ×2"); "send them" creates a mission (Missions tab count increments); hiring a candidate at full roster is disabled.

- [ ] **Step 4: Commit**

```bash
git add src/ui/JobsTab.svelte src/ui/DispatchSheet.svelte
git commit -m "feat: jobs tab, waiting room, dispatch sheet with live projection"
```

---

### Task 15: Missions tab + end screen

**Files:**
- Create: `src/ui/MissionsTab.svelte`, `src/ui/EndScreen.svelte` (replace placeholders)

**Interfaces:**
- Consumes: store; `reinforce`, `withdraw`, `sendSupply`, `idleMercIds` from actions; `MEDKIT`, `SUPPRESSOR`, `STIM`, `THREAT_CAP` from balance; `restart` from store.
- Produces: live mission cards with the two bars, squad chips, reinforce picker, supply buttons with prices, in-transit countdowns; the win/lose ledger overlay.

- [ ] **Step 1: Implement MissionsTab**

Replace `src/ui/MissionsTab.svelte`:

```svelte
<script lang="ts">
  import { game, act } from './store.svelte'
  import { reinforce, withdraw, sendSupply, idleMercIds } from '../sim/actions'
  import { MEDKIT, SUPPRESSOR, STIM, THREAT_CAP } from '../sim/balance'
  import type { Mission } from '../sim/types'

  let pickingFor: number | null = $state(null) // mission id whose reinforce picker is open

  const idle = $derived(idleMercIds(game.state))
  const idleMercs = $derived(game.state.mercs.filter(m => idle.includes(m.id)))

  function squadMercs(mission: Mission) {
    return game.state.mercs.filter(m => mission.squad.includes(m.id))
  }

  const supplies = [
    { type: 'medkit', label: `medkit ${MEDKIT.price}cr` },
    { type: 'suppressor', label: `suppressor ${SUPPRESSOR.price}cr` },
    { type: 'stim', label: `stim ${STIM.price}cr` },
  ] as const
</script>

{#each game.state.missions as mission (mission.id)}
  <div class="card" class:hot={mission.threatBar >= 12}>
    <div class="row">
      <strong>{'★'.repeat(mission.rating)} {mission.environment}</strong>
      <span class="dim">{mission.payout}cr · threat lv {mission.threatLevel}</span>
    </div>

    <div class="dim">completion {Math.floor((mission.workDone / mission.workRequired) * 100)}%</div>
    <div class="bar"><div style="width:{(mission.workDone / mission.workRequired) * 100}%; background:var(--accent)"></div></div>

    <div class="dim">threat {mission.threatBar}/{THREAT_CAP}</div>
    <div class="bar"><div style="width:{(mission.threatBar / THREAT_CAP) * 100}%; background:var(--danger)"></div></div>

    {#each squadMercs(mission) as merc (merc.id)}
      <div class="row chip">
        <span>{merc.name} {merc.hp}/{merc.maxHp}hp</span>
        <button class="ghost small" onclick={() => act(() => withdraw(game.state, mission.id, merc.id))}>pull out</button>
      </div>
    {/each}
    {#each mission.inbound as inb (inb.mercId)}
      <div class="chip dim">↳ reinforcement arrives in {inb.arriveAt - game.state.tick}s</div>
    {/each}
    {#each mission.supplies as sup, i (i)}
      <div class="chip dim">📦 {sup.type} lands in {sup.arriveAt - game.state.tick}s</div>
    {/each}
    {#if game.state.tick <= mission.stimUntil}
      <div class="chip" style="color:var(--ok)">stim active ({mission.stimUntil - game.state.tick}s)</div>
    {/if}

    <div class="row">
      <button class="ghost" disabled={idleMercs.length === 0} onclick={() => (pickingFor = pickingFor === mission.id ? null : mission.id)}>
        reinforce
      </button>
      {#each supplies as s (s.type)}
        <button class="ghost small" disabled={game.state.cash < (s.type === 'medkit' ? MEDKIT.price : s.type === 'suppressor' ? SUPPRESSOR.price : STIM.price)}
          onclick={() => act(() => sendSupply(game.state, mission.id, s.type))}>
          {s.label}
        </button>
      {/each}
    </div>
    {#if pickingFor === mission.id}
      {#each idleMercs as merc (merc.id)}
        <button class="ghost small" onclick={() => { act(() => reinforce(game.state, mission.id, merc.id)); pickingFor = null }}>
          send {merc.name}
        </button>
      {/each}
    {/if}
  </div>
{/each}

{#if game.state.missions.length === 0}
  <p class="dim">no missions running — the loan clock doesn't care</p>
{/if}

<style>
  .row { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .card.hot { border-color: var(--danger); }
  .chip { font-size: 0.85rem; margin: 0.2rem 0; }
  .small { font-size: 0.75rem; padding: 0.25rem 0.5rem; }
</style>
```

- [ ] **Step 2: Implement EndScreen**

Replace `src/ui/EndScreen.svelte`:

```svelte
<script lang="ts">
  import { game, restart } from './store.svelte'
  const won = $derived(game.state.status === 'won')
</script>

<div class="overlay">
  <div class="panel">
    <h2>{won ? 'Paid in full.' : 'They broke your legs.'}</h2>
    <p class="dim">
      {won
        ? `You cleared the ${game.state.loan}cr loan with ${game.state.cash - game.state.loan}cr to spare.`
        : `You were ${game.state.loan - game.state.cash}cr short.`}
    </p>
    <ul class="dim">
      <li>jobs completed: {game.state.stats.jobsDone}</li>
      <li>jobs failed: {game.state.stats.jobsFailed}</li>
      <li>mercs lost: {game.state.stats.mercsLost}</li>
      <li>mercs standing: {game.state.mercs.length}</li>
      <li>reputation: {game.state.reputation}</li>
    </ul>
    <button class="action" onclick={restart}>{won ? 'run it back' : 'new company, new name'}</button>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); display: flex; align-items: center; justify-content: center; z-index: 20; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 1.5rem; width: min(90vw, 380px); }
  ul { list-style: none; padding: 0; }
</style>
```

- [ ] **Step 3: Verify**

`npm run build` clean. `npm run dev` with `?seed=1&speed=20`: dispatch a squad, watch both bars move; threat bar flashes past the cap and the threat level increments; "pull out" sends a merc homebound; sending a suppressor shows the 📦 countdown then knocks the bar down. Let the clock run out (75s real time at speed 20): the end screen shows the ledger; restart begins a fresh run.

- [ ] **Step 4: Commit**

```bash
git add src/ui/MissionsTab.svelte src/ui/EndScreen.svelte
git commit -m "feat: missions tab with intervention controls + end screen"
```

---

### Task 16: End-to-end verification with Playwright (MCP)

**Files:**
- Create: `docs/superpowers/e2e-checklist.md` (the record of what was verified)

**Interfaces:**
- Consumes: the running app (`npm run dev`, background) and the Playwright MCP browser tools (`browser_navigate`, `browser_resize`, `browser_snapshot`, `browser_click`, `browser_evaluate`, `browser_take_screenshot`).
- Produces: a committed checklist with pass/fail per flow and a final screenshot. This task writes no app code unless a flow fails — if one does, fix the bug, add a regression note, and re-run.

- [ ] **Step 1: Start the app and open it at test speed**

```bash
npm run dev &
```

Playwright: `browser_resize` to 390×844, then `browser_navigate` to `http://localhost:5173/?seed=1&speed=20`. (Clear the save first if a previous session left one: `browser_evaluate` → `localStorage.clear()`, then reload.)

- [ ] **Step 2: Walk the flows, recording each in the checklist**

1. **Header/clock:** snapshot shows `500cr`, `loan 5000cr`, a clock counting down, pause toggles it.
2. **Offer stream:** within ~5 real seconds an offer card appears with a draining timer; use `browser_evaluate` on `window.__game.state.offers` to confirm.
3. **Waiting room:** click "take a seat" — the offer moves to the waiting room section and survives past its original TTL.
4. **Dispatch:** click "accept" on a job, select both starter mercs in the sheet, confirm the projection shows a finite duration and a risk line, click "send them". Missions tab badge shows 1.
5. **Mission life:** on the Missions tab, both bars advance; wait for a threat overflow (`threatLevel ≥ 1` via `__game`) and confirm a squad chip's hp dropped.
6. **Intervention:** click a supply button; the 📦 in-transit line appears and the effect lands (threat bar drops for a suppressor / hp rises for a medkit).
7. **Reinforce/withdraw:** hire or use an idle merc → "reinforce" → arrival joins the squad chips. "pull out" removes one and homebound status shows on the Roster tab.
8. **Run end:** let the clock expire (75 real seconds at speed 20) — end screen appears with the ledger; "restart" starts a fresh run with full cash.
9. **Save/resume:** mid-run, reload the page (same URL) — the run resumes from the save, not from tick 0.
10. **Mobile fit:** `browser_take_screenshot` at 390×844 — no horizontal scroll, tap targets comfortably sized.

- [ ] **Step 3: Write and commit the checklist**

Record each flow as pass/fail with one line of evidence (e.g. observed values from `__game`). Save the final screenshot alongside if useful.

```bash
git add docs/superpowers/e2e-checklist.md
git commit -m "test: e2e verification checklist (playwright mcp, mobile viewport)"
```

---

### Task 17: Balance pass

**Files:**
- Modify: `src/sim/balance.ts` (values only — never formulas)
- Modify: `docs/superpowers/specs/2026-07-09-merc-company-design.md` (numbers table, if values change)

**Interfaces:**
- Consumes: `npm run sim -- 1000`.
- Produces: a tuned `balance.ts` where the bot's win rate lands in **40–70%**, and a spec numbers table that matches reality.

- [ ] **Step 1: Measure**

Run: `npm run sim -- 1000`. Record win rate, mean final cash, mean mercs lost.

- [ ] **Step 2: Tune toward 40–70% bot win rate**

One knob at a time, re-measuring after each change (never touch the four design anchors):
- Win rate too low → lower `LOAN`, raise `PAYOUT_PER_RATING_SQ`, or lower `REP_PER_TIER` (better jobs sooner).
- Win rate too high → the reverse.
- Mercs dying constantly (mean lost > 2) → raise `HP_BASE` or lower `CONSEQUENCE_SPREAD`.
- Bot idle too much (jobs done < 8/run) → shorten `OFFER_ARRIVAL_MIN/MAX`.

The bot is mediocre by design — a human should beat it, so a 40–70% bot win rate targets the spec's "decent player wins ~60%".

- [ ] **Step 3: Sync the spec's numbers table with any changed values**

- [ ] **Step 4: Verify the full suite still passes**

Run: `npm test`
Expected: all pass (tests intentionally reference constants, not literals — except the threat-cap example test in `tick.test.ts`, which is anchored to design constants that must not have moved).

- [ ] **Step 5: Commit**

```bash
git add src/sim/balance.ts docs/superpowers/specs/2026-07-09-merc-company-design.md
git commit -m "feat: balance pass — bot win rate <X>% over 1000 runs"
```

---

## Done means

- `npm test` — all sim suites green.
- `npm run sim -- 1000` — win rate 40–70%, printed in the Task 17 commit.
- `npm run build` — clean.
- The Task 16 checklist committed with all ten flows passing.
