# src/sim — the simulation core (read before balancing)

Pure, deterministic, JSON-serializable. No DOM, no `Math.random()`, no
`Date.now()`; all randomness flows through the seeded mulberry32 RNG
(`rng.ts`), whose uint32 state persists as `state.rngState`. Same seed → same
run. `GameState` holds no classes/Maps/functions; bump `SCHEMA_VERSION` in
`balance.ts` on any shape change (old saves are discarded by design, in
`src/ui/store.svelte.ts`).

## Tick pipeline (`tick.ts`)

`newRun(seed)` creates state (2 starter mercs + a 1★ job already seated in
the waiting room with its TTL running). `tick(state)` advances one second, in
this order:

1. **Missions update** (each, via `updateMission`): reinforcement arrivals
   join the squad and supplies land (medkit heals lowest-hp, suppressor
   −9 threatBar, stim ×1.5 power for 10 ticks) → `workDone += squadPower`
   → if `workDone ≥ workRequired`: payout, +rating reputation, bond credit,
   squad goes homebound, **no threat on the completing tick** → otherwise
   the threat roll and cap overflow (below) → a squad emptied with nothing
   inbound = mission fails (−rating reputation, jobsFailed++).
2. Homebound travelers arrive (become idle).
3. Every `HEAL_INTERVAL` ticks, idle mercs heal 1 hp.
4. `pumpOffers` (below).
5. At `tick ≥ CYCLE_LENGTH`: `cash ≥ loan` → won, else lost.

## Mission resolution: squad power vs threat

- **`squadPower`** (`bonds.ts`) is the single source of squad maths: sum of
  each merc's rank (×2 on environment-affinity match) plus the bond level of
  every pair. `projection.ts` (the dispatch forecast) must mirror any change.
- **Work**: a job needs `rating × WORK_PER_RATING` work; the squad adds
  `power` per tick.
- **Threat roll**: `shortfall = rating × THREAT_BASE_PER_RATING − power`;
  each non-completing tick, `threatBar += rating + rng.int(0, 2×max(0, shortfall))`.
  Power ≥ `rating × THREAT_BASE_PER_RATING` is *threat-neutral*: only the
  guaranteed minimum (`rating`/tick) accrues.
- **Cap overflow → escalating consequences**: while `threatBar ≥ THREAT_CAP`,
  subtract the cap, `threatLevel++`, and a random squad member takes
  `rating × threatLevel ± CONSEQUENCE_SPREAD` damage (min 1). Damage scales
  with threatLevel, so lingering missions get progressively lethal. Deaths
  remove the merc permanently (`mercsLost++`).

## Offer pump (`offers.ts`): seat-gated waiting room

There is no door, queue, or per-tier timer/credit bookkeeping. Instead there's
a single scheduler, `state.nextOfferAt` (0 = unscheduled), and a waiting room
`state.seated: Offer[]` capped at `state.waitingSeats`. Each seated offer
carries its own TTL (`expiresAt`); a seat is free again the instant its offer
expires or is taken/rejected/hired.

Per-tick order in `pumpOffers` (order is load-bearing, see the comment there):

1. **Expire** any seated offer whose `expiresAt ≤ tick` (frees its seat).
2. **Schedule**: if `nextOfferAt` is unset, roll `tick + arrivalInterval(...)`.
3. **Arrive**: if `nextOfferAt` is due *and* a seat is free, generate an offer
   via `pickSource`, stamp its TTL, push it into `seated`, and reschedule
   (`nextOfferAt = 0`) so the next roll happens next tick. If due but no seat
   is free, the arrival simply stays pending — seats gate throughput, not
   generation.

Intervals: `baseInterval` runs linearly from `atUnlock` (at that tier's
`unlockRep`) to `ramped` over `REP_RAMP` reputation, then clamps.
`combinedInterval` is the harmonic sum across all unlocked sources (how often
*some* offer would be due); `arrivalInterval` adds ±`ARRIVAL_JITTER` on top.
`pickSource` then draws which source actually fires, weighted by each
unlocked source's `1/baseInterval` rate — this is what preserves the
rank-shifted mix (tier 1 ramps **up**, 14 → 130, fading out; tiers 2–5 ramp
**down**, more frequent) without any separate per-tier credit mechanism.

## `balance.ts` — the single source of tuning constants

Balancing work changes numbers here and nowhere else. Groups:

| Group | Constants | Controls |
|---|---|---|
| Run economy | `CYCLE_LENGTH` 1500, `LOAN` 5000, `STARTING_CASH` 500 | run length and the win bar |
| Design anchors | `WORK_PER_RATING` 30, `THREAT_BASE_PER_RATING` 3, `THREAT_CAP` 18, `CONSEQUENCE_SPREAD` 2 | mission duration, threat-neutral power, consequence cadence/variance |
| Mercs | `HP_BASE`, `HP_PER_RANK`, `HIRE_COST_PER_RANK_SQ` | durability and hire pricing (rank²) |
| Payouts | `PAYOUT_PER_RATING_SQ` | job payout (rating²) — why high-star jobs pay the loan |
| Capacity | `STARTING_ROSTER_SLOTS`/`MAX_ROSTER_SLOTS`/`SLOT_PRICES`, `STARTING_SEATS`/`MAX_SEATS`/`SEAT_PRICES` | roster growth and waiting-room size |
| Offer pump | `OFFER_TTL_MIN`/`MAX` (18–24), `JOB_TIERS` (unlockRep/atUnlock/ramped per tier), `CANDIDATE_ARRIVAL`, `REP_RAMP` 16, `ARRIVAL_JITTER` | offer pacing and the rank-shifted mix |
| Progression | `REP_PER_TIER` | candidate rank ceiling as reputation grows (`maxTier` in `content.ts`) |
| Interventions | `MEDKIT`, `SUPPRESSOR`, `STIM`, `REINFORCE_TRAVEL`, `SUPPLY_TRAVEL`, `MEDBAY_PER_HP`, `HEAL_INTERVAL` | mid-mission tools, travel delays, healing economy |
| Bonds | `BOND_THRESHOLDS` | missions-together needed per bond level |
| UI thresholds | `DANGER_THREAT` | when a mission reads as "hot" |

**Current design intents** (locked as regression bands in
`tests/sim/harness.test.ts` — deterministic seeded runs, so exact gates, not
flaky statistics):

- A 1★ job is threat-neutral at power 3 (`1 × THREAT_BASE_PER_RATING`).
- Two starter 1★ mercs must win a 1★ job easily: gate ≥90% success, ≤2%
  any-death (currently 100% / 0%).
- A solo 1★ merc is a real challenge but rarely fatal: gate 55–75% success,
  ≤10% any-death (currently ≈74% / ≈1%).
- Offer mix: at rep 0, only 1★ jobs and ≥5 job offers per 100 ticks (this
  floor reflects the seat-gated arrival rate — seats throttle throughput by
  design, so it's lower than a free-pump model would allow); at rep 24, 1★
  share < 15% and 4★+5★ share exceeds the 1★ share.

## The balancing workflow

1. Change constants in `src/sim/balance.ts`.
2. `npm run sim -- scenario` (1★-mission outcome distributions, 2000 runs)
   and `npm run sim -- offers` (offer-mix-by-rep table).
3. Check the numbers against the bands locked in
   `tests/sim/harness.test.ts` (which imports `runMissionScenario` /
   `measureOfferMix` straight from `scripts/simulate.ts`).
4. `npm test` — all 77 tests must pass. Widen a band only when the *intent*
   changes, not to make a number fit.
5. Optionally `npm run sim` (or `-- 1000`) for full bot runs: win rate, loss
   breakdown, cash-over-time curve. Post-retune the heuristic bot wins ~100%
   with a huge surplus, so treat it as a smoke test and lower bound — the
   binding gates are the scenario/offer ones.

## In-browser harness hooks

- `?seed=N` — deterministic fresh run. A surviving localStorage save takes
  precedence; wipe it first (`localStorage.removeItem('merc-company-save-v1')`
  or the header restart button).
- `?speed=N` — tick rate (N ticks/second; also scales bar animations via the
  `--tick` CSS var). At high speed the 18–24-tick seat TTL is humanly
  unclickable, but bots can read state and pause.
- `window.__game` — the reactive store `{ state, paused }`, exposed for
  Playwright. Set `__game.paused = true` to freeze the sim between
  interactions. The tab auto-pauses on `visibilitychange` when hidden.
