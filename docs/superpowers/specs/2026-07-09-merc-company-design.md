# Merc Company — Game Design Spec

**Date:** 2026-07-09
**Status:** Approved design, pre-implementation
**Working title:** `merc-company`

## Concept

A phone-first web game. You run a small mercenary company and must pay back a
loan before the cycle ends — or they break your legs. Part schedule management
(which mercs are out when), part risk management (squad size trades mission
throughput against catastrophe risk). One loan cycle is one run: short,
tense, arcade-replayable.

## Core loop

**Accept job → dispatch squad → watch the boards → send supplies/reinforcements
to missions trending toward harm you can't accept → collect payout → repeat
until the deadline.**

Mid-mission intervention is core, not optional garnish. Cash is tactical
ammunition during the run and the loan payment at the end of it — every
medkit is mortgaged against your legs.

## Run structure

- One run = one loan cycle. Loan principal **L** due at cycle end.
- Simulated time: **1 tick/second** while the app is open and unpaused.
  Cycle length ≈ **1,500 ticks (~25 min)** of active play.
- Sim auto-pauses when the tab is hidden; manual pause always available.
- At the deadline: cash ≥ L → win (score = surplus + reputation + surviving
  mercs); cash < L → legs broken, run over.
- No mid-cycle interest payments in v1.

### Economy

- **Money in:** mission payouts only. Payouts scale steeply with mission
  rating — high-rated jobs are where the loan gets paid.
- **Money out:** one-time hire fees, roster slot purchases, medbay healing,
  supplies. **No recurring wages** — a merc's cost is their hire price,
  weighed against the mission difficulty you expect to run with them.
- Dismissal pressure comes from finite roster slots and sunk cost, not upkeep.

### Starting kit

- 3 roster slots (expandable to 6 with cash)
- 2 waiting-room seats (a 3rd purchasable)
- 2 starter mercs, small cash float
- Offers arrive stochastically throughout the cycle

## Mission system

Each mission is two bars.

### Completion (deterministic)

- Mission requires `MR × 100` work units (MR = mission rating, 1–5).
- Per tick, each deployed merc contributes their **rank**, doubled if their
  environment affinity matches the mission environment.
- Bond bonuses add effective rank (see Bonds).
- Bar reaches 100% → mission complete, mercs travel home, payout lands.
- Deterministic on purpose: predictable durations enable the scheduling game.

### Threat (rolled)

- Squad shortfall: `P = BTI − ΣTRC`, where `BTI = MR × 5` and each merc's
  TRC = rank (doubled on affinity match, plus bond effective rank).
- Per tick: `threat += MR + random(0 … 2 × max(0, P))`
  - Overstaffed (P ≤ 0): always exactly the minimum `MR`. Money buys certainty.
  - Understaffed (P > 0): expected value `MR + P`, arriving in lumpy blocks —
    variance is the cost of thin staffing.
- Threat bar caps at **18**. Overflow → threat level +1, a consequence fires
  at the new level, and the bar keeps the remainder.
- Threat level starts at 0 each mission, so the first consequence lands at
  level 1.
- **Consequence:** damage to one random on-site merc, scaled by
  `MR × threatLevel` ± spread. 0 HP = dead, permanently, this run.
- A mission fails outright only if the entire squad is downed: no payout,
  reputation loss.
- Tuning anchor (from design notes): with min threat = MR, a maxed squad on a
  3★ / 20-tick mission still eats ~3 consequences — every mission generates
  intervention decisions.

### Mid-mission intervention (core)

- **Reinforce:** dispatch any idle merc to an in-flight mission; they arrive
  after ~5 ticks travel, then count fully (rank, affinity, bonds).
- **Withdraw:** mirror action with the same travel delay. Bleeding a mission
  to zero squad is a soft abandon.
- **Supplies** (purchased, arrive after ~3 ticks travel):
  - **Medkit** — heals the most-injured merc on site.
  - **Suppressor** — knocks the threat bar down a chunk (−9, half the bar).
  - **Stim** — boosts completion rate for a fixed duration (10 ticks).
- Travel delay is deliberate: a suppressor sent at threat 16/18 is a gamble
  on whether the next tick lands first.

### Dispatch projection

The dispatch sheet shows a live forecast as mercs are added to the squad:

- **Duration: exact** (completion is deterministic).
- **Risk: a forecast range** (e.g. "2–4 consequences likely"), widening with
  understaffing.
- Affinity matches and active bonds highlighted as they join.

`projection.ts` is shared between UI and sim so the forecast is
definitionally consistent with the maths that runs.

## Mercenaries

**Stat block (all visible):** name, class, rank (1–5), HP, environment
affinity (urban / rural / forest), hire price.

- **Personalization in v1 is a random name + class, full stop.** No traits,
  no barks, no generated avatars (all stretch).
- Class is identity/flavor in v1; it does not touch the formulas.
- Rank and affinity drive all mission maths.
- **Healing:** injured mercs heal slowly for free while idle, or pay a medbay
  fee for instant patching — downtime or cash, player's choice.
- Candidates are generated with rank weighted by current reputation.

### Bonds

- Every pair that **completes** a mission together gains bond points;
  thresholds give bond levels 1–3.
- A bonded pair deployed together adds **+1 effective rank per bond level**
  to the squad (feeds both completion and threat reduction; stacks with
  affinity).
- Losing or dismissing a bonded merc carries **no debuff** — the bonus simply
  ceases to exist.
- **UI requirement:** when bonded mercs are both in the roster, show a clear
  link badge on each card (partner name + bond level); tapping one highlights
  the other.

## Offers & the waiting room

- **Job offers and hire candidates arrive in the same stream** and compete
  for the same seats.
- Each offer has a countdown timer; expiry auto-rejects it.
- **Seat** moves an offer to the waiting room, freezing (or heavily slowing)
  its timer. Seats are limited (2, +1 purchasable).
- Three actions per offer: Accept / Seat / Reject.

## Reputation

- Successful missions raise reputation; outright mission failures lower it.
- Reputation gates the **quality** (rating range) of arriving job offers and
  hire candidates. Arrival frequency stays steady.

## UI

Portrait phone, single-page app. Three tabs under a persistent header.

- **Header (always visible):** cash · loan + cycle countdown · reputation ·
  pause. The loan countdown never scrolls away.
- **Tab 1 — Roster:** merc cards (name, class, rank stars, HP bar, affinity
  icon, status: idle / on mission / healing), bond badges, empty + locked
  (purchasable) slots in the same grid. Dismiss behind tap-and-confirm.
- **Tab 2 — Jobs:** offer cards (rating, environment, payout, est. duration,
  draining timer bar) with Accept / Seat / Reject; waiting-room row pinned at
  top; candidates in the same stream.
- **Dispatch sheet (modal):** tap mercs to build the squad; live projection
  updates per tap; confirm launches.
- **Tab 3 — Missions:** per-mission card — completion bar, threat bar (0–18,
  overflow flash) with threat-level pips, squad chips with live HP,
  **Reinforce** and **Send supplies** buttons, travel-time countdowns for
  anything in transit. Tab badge counts missions in a danger state.
- **Run end:** win/lose ledger (jobs done, mercs lost, cash vs loan), restart.

## Architecture

One Vite + Svelte + TypeScript app. Hard boundary between sim and UI.

```
src/
  sim/          # pure TS, zero Svelte imports — the whole game
    types.ts        # GameState, Merc, Mission, Offer, action types
    balance.ts      # every tuning constant in ONE file
    rng.ts          # mulberry32, seedable, state serializes with the save
    tick.ts         # tick(state) → state: threat rolls, completion, timers, arrivals
    actions.ts      # hire, dismiss, accept, seat, dispatch, reinforce, sendSupply…
    projection.ts   # dispatch forecast (shared by UI and tests)
    content.ts      # name pools, classes, mission templates
  ui/           # Svelte: header, 3 tabs, dispatch sheet, end screen
    store.ts        # wraps sim state; setInterval drives 1 tick/sec; pauses on tab-hide
scripts/
  simulate.ts   # headless balance harness
```

- The sim is a deterministic state machine: `newState = tick(oldState)` with
  a seeded RNG. Same seed = same run.
- The sim never touches the DOM; the UI never computes game logic.
- **Saves:** full `GameState` (RNG state included) → localStorage every few
  ticks and on tab-hide, with a `schemaVersion` field. Version mismatch or
  corrupt JSON → discard, offer a fresh run. No save migration in prototype.
- Static hosting; installable as a PWA later if wanted.

## Verification & feedback loops

Three layers — these are the official ways agents and humans check progress:

1. **Vitest unit tests** on the sim: threat floor/cap, overflow → consequence
   → level-up, affinity doubling, bond accrual/loss, offer expiry, travel
   delays, deadline win/lose evaluation.
2. **Headless balance harness** (`scripts/simulate.ts`): a simple bot policy
   plays N thousand seeded runs; prints win rate, cause-of-death distribution,
   cash-over-time curves. Used to solve for L and validate tuning constants
   empirically. Pathological runs are reproducible by seed.
   *Task-17 balance pass (2026-07-10):* left every `balance.ts` value at its
   starting guess (no economy tuning needed) and fixed the bot policy instead —
   it now dispatches at `shortfall <= 1` (a fixed 1-point staffing allowance, vs
   the old rating-scaled one that under-staffed the most dangerous jobs and let a
   single death cascade into a total wipe), grows the roster by buying slots,
   heals wounded idle mercs at the medbay, and skips re-buying a suppressor that
   is already in transit. Validated bot win rate: **52.5% over 1,000 seeds**
   (mean 17.1 jobs done, 1.65 mercs lost). The four design anchors are untouched.
3. **Playwright** (MCP available): drives the real UI in a mobile viewport —
   start run, accept job, dispatch, reinforce, reach end screen — to verify
   flows end-to-end.

## Initial numbers (placeholders — tune via harness)

All live in `balance.ts`. Every value below is a starting guess to be
validated by the balance harness, except where marked (design anchor).

| Constant | Value | Notes |
|---|---|---|
| Cycle length | 1,500 ticks | ~25 min active play |
| Loan principal L | 5,000 | solve empirically for ~60% win rate |
| Starting cash | 500 | |
| Tick rate | 1/sec | |
| Mission work | MR × 100 | design anchor |
| Base threat | MR × 5 | design anchor |
| Min threat/tick | MR | design anchor |
| Threat cap | 18 | design anchor |
| Consequence damage | MR × threatLevel ± 2 | random on-site target |
| Merc HP | 15 + 5 × rank | |
| Hire cost | rank² × 100 | |
| Mission payout | MR² × 150 | |
| Roster slots | 3 start; 4th/5th/6th at 300/600/1,000 | |
| Waiting seats | 2 start; 3rd at 250 | |
| Offer arrival | every 40–60 ticks | |
| Offer timer | 60–90 ticks unseated | |
| Medkit | 100cr, heals 10 | |
| Suppressor | 150cr, −9 threat | |
| Stim | 150cr, +50% completion for 10 ticks | |
| Reinforce travel | 5 ticks | |
| Supply travel | 3 ticks | |
| Bond levels | 2 / 5 / 9 missions together | +1 eff. rank per level |
| Reputation | +MR per success, −MR per squad wipe | gates offer rating range |

## Stretch (explicitly out of v1)

- Abandon-mission action (formal; soft-abandon via withdrawal exists in v1)
- Traits & bark system (personality lines on dispatch/hit/return/dismissal)
- Generated avatars
- Class perks (e.g. Medic softens consequences)
- Legacy/veteran mercs recurring across runs
- Cloud saves (Firebase available if ever wanted)

## Decision log

- **Time model:** simulated ticks, active play only (not real-time idle).
- **Run shape:** one cycle = one run; ~25 min; arcade-replayable.
- **Character depth:** procedural mercs, per-run drama; no persistent cast.
- **Bonds:** mechanical bonus when deployed together; no debuff on loss —
  the bonus just disappears.
- **Wages:** rejected. Hire fee only.
- **Mid-mission intervention:** promoted from stretch to core loop.
- **Threat randomness:** completion deterministic, threat rolled per tick
  with variance scaling on understaffing (restores original notes' intent).
- **Presentation:** clean abstract manager UI; personality = name + class in v1.
- **Stack:** Svelte + TS SPA, pure sim core, localStorage, static hosting.
