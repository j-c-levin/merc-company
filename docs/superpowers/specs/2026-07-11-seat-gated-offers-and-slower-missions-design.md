# Seat-gated offer arrivals + 30% slower missions

Two independent changes to Merc Company, sharing one spec because both touch
`balance.ts` and the sim's regression bands.

1. **Slower missions, same lethality** — missions take 30% longer without the
   per-tick threat cadence changing.
2. **Seat-gated arrivals** — the waiting room becomes the whole offer system:
   you start with one seat, new offers arrive only when a seat is free, and
   each offer occupies a seat while it waits (or times out and frees it).

Source of truth for balance is `src/sim/balance.ts`; the sim is a pure,
deterministic, JSON-serializable state machine (see `src/sim/CLAUDE.md`).

---

## Change 2 — slower missions, same lethality

### Intent

Missions currently resolve too fast. Stretch every mission's duration by 30%
without altering the per-tick threat maths, and hold survivability where it is
today (the `harness.test.ts` scenario bands must still pass unchanged).

### Why scaling the cap holds survivability

A mission lasts `workRequired / power` ticks, where
`workRequired = rating × WORK_PER_RATING`. Each non-completing tick adds
`rating + rng.int(0, 2·max(0, shortfall))` to `threatBar`; that increment is
independent of both `WORK_PER_RATING` and `THREAT_CAP`. A consequence fires
each time `threatBar` crosses `THREAT_CAP`, and its damage scales with
`threatLevel` (the running count of crossings).

So the number of consequence events per mission is roughly

```
(threat accrued per tick) × (ticks per mission) / THREAT_CAP
```

Scaling `WORK_PER_RATING` up 30% multiplies ticks-per-mission by 1.3. Scaling
`THREAT_CAP` up 30% divides crossings by 1.3. The two cancel: the same number
of consequences fire, at the same `threatLevel` progression, for the same total
damage — so survivability % is preserved while the mission takes 30% longer.

### Changes (all in `src/sim/balance.ts`)

| Constant | Now | New | Rationale |
|---|---|---|---|
| `WORK_PER_RATING` | 30 | **39** | +30% work bar → +30% mission duration (power/tick unchanged) |
| `THREAT_CAP` | 18 | **23 or 24** | ≈×1.3 so consequence count per mission is unchanged; exact integer chosen to best reproduce today's scenario bands |
| `DANGER_THREAT` | 12 | **15** | keep the UI "hot" marker at the same fraction (~⅔) of the cap |

No logic changes. `content.ts` (`work = rating × WORK_PER_RATING`) and
`projection.ts` (`durationTicks × perTick / THREAT_CAP`) read the constants, so
the dispatch forecast stays self-consistent — the 1.3 scaling cancels in the
consequence forecast exactly as it does in the sim.

### Verification

- `npm run sim -- scenario` (2000 runs) must reproduce today's numbers within
  the existing bands: 2 starter 1★ mercs ≥90% success / ≤2% any-death; solo 1★
  55–75% success / ≤10% any-death. Pick `THREAT_CAP` 23 vs 24 by whichever
  holds these best.
- `harness.test.ts` scenario gates stay **unchanged** — that is the success
  criterion for this change.
- The `durationTicks` shown in `DispatchSheet` should rise ~30% (a 1★ solo run
  goes from ~30s to ~39s); consequence risk text should read the same.

---

## Change 1 — seat-gated offer arrivals

### Intent

Replace the current "door + hidden queue + six per-tier credit timers" arrival
system with a single seat-gated waiting room:

- You start with **one** seat.
- A new offer arrives only when a seat is free.
- An arriving offer takes a seat and waits there with its own countdown; it
  leaves when you act on it (dispatch/hire), reject it, or its TTL runs out.
- Because occupied seats block new arrivals, seats are now the throttle on your
  whole offer flow — and buying seats widens the pipeline.

The reputation-driven **rank-shift** (1★ jobs fade out, high-★ jobs ramp up as
you rank up) is preserved. Candidates share the same waiting room and stream as
jobs (a candidate in your only seat blocks a job until you clear it — an
intended tradeoff).

### State model (`src/sim/types.ts`)

`SCHEMA_VERSION` bumps (shape change → old saves discarded, per existing
policy).

- **Remove** `door: Offer | null`, `queue: Offer[]`, and
  `timers: Partial<Record<TimerKey, number>>`.
- **Add** `nextOfferAt: number` — tick the next offer is scheduled to arrive.
- **Keep** `seated: Offer[]` as the entire waiting room, length-capped at
  `waitingSeats`. Each seated offer carries its own `postedAt`/`expiresAt`, so
  the TTL countdown now runs in the seat (previously only the door had a live
  TTL).

`Offer.source: TimerKey` stays — it still records which tier emitted the offer
(used by the offer-mix harness), even though timers no longer drive arrival.

### Balance constants (`src/sim/balance.ts`)

| Constant | Now | New | Note |
|---|---|---|---|
| `STARTING_SEATS` | 2 | **1** | start with one seat |
| `MAX_SEATS` | 3 | **5** | can grow to five over a run |
| `SEAT_PRICE` (scalar) | 250 | **`SEAT_PRICES` array** | escalating cost for seats 2–5, mirroring `SLOT_PRICES`; starting proposal `[250, 400, 600, 900]`, tuned against bot runs |

`JOB_TIERS`, `CANDIDATE_ARRIVAL`, `REP_RAMP`, `ARRIVAL_JITTER`,
`OFFER_TTL_MIN/MAX` are **unchanged** — the rank-shift curve reuses them.

### Arrival pump (`src/sim/offers.ts`)

`pumpOffers(state, rng)`, per tick, order load-bearing for determinism:

1. **Expire** — remove any seated offer with `expiresAt ≤ tick` (frees a seat).
2. **Schedule** — if `nextOfferAt` is unset (undefined/0), set
   `nextOfferAt = tick + arrivalInterval(rep, rng)`.
3. **Arrive** — if `nextOfferAt ≤ tick` **and** `seated.length < waitingSeats`:
   - pick a source by weighted rank-shift (below),
   - generate the offer (`generateJob` / `generateCandidate`),
   - stamp `postedAt = tick`, `expiresAt = tick + rng.int(TTL_MIN, TTL_MAX)`,
   - push to `seated`, clear `nextOfferAt` (reschedule next tick).
   - If due but **all seats full**, leave `nextOfferAt` as-is so an offer
     arrives the instant a seat frees.

All offer RNG is consumed here and only here (as today).

**Weighted rank-shift tier selection** — preserves the existing curve with no
new tuning constants:

- For each unlocked source `key` (jobs whose `unlockRep ≤ rep`, plus
  `candidate`), weight `w(key) = 1 / baseInterval(key, rep)` — the source's
  instantaneous arrival rate under today's ramp.
- Draw a source proportional to weights via `rng`.
- The combined arrival interval is `arrivalInterval(rep, rng) =
  round( (1 / Σ w(key)) × jitter )`, i.e. today's *aggregate* cadence across all
  timers, jittered by ±`ARRIVAL_JITTER`. When a seat is free, offers therefore
  arrive at roughly today's overall pace; the seat cap does the throttling.

`baseInterval`, `unlockedTimers`, `ratesFor` are reused as-is. `creditHeld`,
the per-source credit concept, and the FIFO promotion step are deleted.

### Actions (`src/sim/actions.ts`)

- **Delete** `seatOffer` — seating is automatic on arrival.
- `takeOffer` simplifies to seated-only lookup/removal (no door branch).
- `dispatch`, `hire`, `rejectOffer` operate on `seated` only. `rejectOffer`
  now means "free this seat early so the next offer can arrive sooner."
- `buySeat` reads the escalating `SEAT_PRICES[state.waitingSeats - STARTING_SEATS]`
  and caps at `MAX_SEATS`.

### `newRun` (`src/sim/tick.ts`)

Opening offer: one 1★ job placed directly into the single starting seat with
its TTL running (`postedAt = 0`, `expiresAt = rng.int(TTL_MIN, TTL_MAX)`);
schedule `nextOfferAt`. Seat is 1/1 full, so nothing new arrives until the
player clears it. `door`/`queue`/`timers` initialisation is removed.

### UI (`src/ui/`)

- **`JobsTab.svelte`** — collapse the separate "at the door" and "waiting room"
  sections into one seat list titled by `seated.length / waitingSeats`. Every
  offer card shows the TTL bar + "Ns before they walk" (previously door-only).
  Remove the "take a seat" button. Keep accept (job) / hire (candidate) /
  reject, and the "add a seat" purchase (now priced from `SEAT_PRICES`, shown
  while `waitingSeats < MAX_SEATS`).
- **`DispatchSheet.svelte`** — `offerAlive` becomes
  `seated.some(o => o.id === offer.id)` (drop the `door` branch).
- **`App.svelte`** — no change (the "INCOMING" header carries no count).

### Harness + bot (`scripts/simulate.ts`)

- `botAct` — remove the door snapshot and the seat-the-best step (step 5). Hire
  and dispatch loops iterate `state.seated` only.
- `runMissionScenario` — silence the pump via the new shape (no `door`/`queue`;
  set `nextOfferAt` far in the future) and place the test job directly into a
  seat before dispatching.
- `measureOfferMix` — count arrivals into `seated` (reject each the tick it
  seats) instead of reading `door`. It still reports `bySource` from
  `Offer.source`, so the mix table stays meaningful.

### Tests (`tests/sim/`)

- Rewrite offer/pump/action unit tests for the seat model (TDD: write the new
  behavioural tests first, watch them fail, then implement).
- `harness.test.ts`:
  - **Offer-mix intent bands stay**: at rep 0, jobs are 100% 1★; at rep 24,
    1★ share < 15% and 4★+5★ share exceeds the 1★ share.
  - **The `jobsPer100` rate gate changes**: seat-gating is *designed* to
    throttle offers, so the "≥5 job offers per 100 ticks" figure will drop.
    Re-derive it from `measureOfferMix` under the new model and update the gate,
    with a comment noting this is an intentional intent change, not a fudge.
  - Scenario survivability bands unchanged (Change 2 goal).

---

## Blast radius summary

| File | Change |
|---|---|
| `src/sim/balance.ts` | `WORK_PER_RATING`, `THREAT_CAP`, `DANGER_THREAT`, `STARTING_SEATS`, `MAX_SEATS`, `SEAT_PRICE`→`SEAT_PRICES`, `SCHEMA_VERSION` |
| `src/sim/types.ts` | drop `door`/`queue`/`timers`; add `nextOfferAt` |
| `src/sim/offers.ts` | rewrite pump: expire → schedule → seat-gated arrive; weighted rank-shift picker; delete credit/queue/promotion |
| `src/sim/actions.ts` | delete `seatOffer`; seated-only `takeOffer`/`dispatch`/`hire`/`rejectOffer`; `buySeat` from `SEAT_PRICES` |
| `src/sim/tick.ts` | `newRun` seats the opening offer; remove door/queue/timers init |
| `src/sim/content.ts` | none (reads `WORK_PER_RATING`) |
| `src/sim/projection.ts` | none (reads the constants) |
| `src/ui/JobsTab.svelte` | one seat list, TTL on every card, drop "take a seat", `SEAT_PRICES` |
| `src/ui/DispatchSheet.svelte` | `offerAlive` seated-only |
| `scripts/simulate.ts` | `botAct`, `runMissionScenario`, `measureOfferMix` to the seat model |
| `tests/sim/*` | rewrite offer/pump/action tests; update offer-mix rate gate |

## Open tuning knobs (decide by measurement)

- `THREAT_CAP` 23 vs 24 — by the scenario bands.
- `SEAT_PRICES` values — by the bot runs (seats shouldn't be trivially cheap
  nor unaffordable).
- Combined arrival interval — if flow feels too tight/loose with 1 seat, this
  is the dial (derived from existing rates by default; a dedicated constant is
  the fallback).
