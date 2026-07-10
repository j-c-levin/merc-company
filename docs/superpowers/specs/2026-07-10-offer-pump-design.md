# Offer pump, pacing, and bar animations

Replaces the single random offer stream with six credit-limited timers feeding a
one-slot door, speeds up the opening, and makes the progress and threat bars
animate continuously instead of stepping once per tick.

## Motivation

Three problems, one root cause.

The first job takes about 71 seconds to appear. Offers arrive on a single timer
every 40–60 ticks (`OFFER_ARRIVAL_MIN`/`MAX`), and each arrival is a candidate
30% of the time (`CANDIDATE_CHANCE`). Expected wait for the first *job* is
therefore `50 / 0.7 ≈ 71` ticks, and one tick is one second at default speed.

Because that one timer feeds both streams, merc rarity and job rarity cannot be
tuned independently. Lowering `CANDIDATE_CHANCE` to make mercs scarce
automatically makes jobs *more* frequent, since both draw from the same slot.

And the bars step once per tick, because nothing tweens `width`.

## Design

### Credit-based offer pump

Six timers, each owning exactly one slot in a hidden queue:

| Timer | Emits |
|---|---|
| `job1` … `job5` | a job of that star rating |
| `candidate` | a merc for hire |

A timer holds **one credit**. Firing spends it. The credit returns only when
that timer's offer leaves the door. A timer that has spent its credit cannot
fire again, so a fast timer cannot outpace itself.

This makes starvation impossible by construction. Under the old single stream,
raising job rates would crowd candidates out of the shared slot. Here the
candidate timer always has its credit available, because job timers can hold at
most one pending offer each.

Credit-held is **derived, never stored**: a timer holds a credit if and only if
an offer with its `source` sits in `door` or `queue`. There is no `pending`
flag to desynchronise from a loaded save.

### The door

The player sees exactly one offer. Resolving it — accept, seat, reject, or let
it expire — frees the door, returns that offer's credit, and promotes the front
of the queue.

Seating an offer both banks it indefinitely and returns the credit immediately.
Seats therefore raise throughput, not just storage. That is the reason to buy
one.

### Per-tick order

1. **Expire** the door offer if `expiresAt <= tick`.
2. **Schedule** every unlocked timer that holds its credit and has no `nextAt`:
   set `nextAt = tick + interval(key, reputation)`.
3. **Fire** every unlocked timer whose `nextAt` has arrived, pushing onto
   `queue` and clearing `nextAt`.
4. **Promote** the front of `queue` if `door` is empty, stamping `postedAt` and
   `expiresAt`.

Expiry precedes promotion so a door slot freed this tick is refilled this tick.
Scheduling precedes firing, so a timer scheduled this tick fires no earlier than
`tick + interval`.

An absent `nextAt` means "reschedule me". Resolving an offer does not compute a
new `nextAt`; it merely deletes the entry, and the next pump schedules it.

This matters for determinism. Jitter needs the RNG, and the RNG lives in
`tick()`. If `actions.ts` computed `nextAt` on resolve, a player *clicking*
would advance `state.rngState`, and a run would no longer replay from its seed.
Keeping all RNG consumption inside the pump preserves `?seed=` reproducibility,
which the test suite depends on.

Lazy tier-unlock needs no special case: a tier that has just crossed its
`unlockRep` has no `nextAt`, so step 2 schedules it like any other.

### TTL

Offers in the queue are frozen; `postedAt` and `expiresAt` are `0` until
promotion. The TTL bar therefore always means "time left to decide about this
card", and nothing is lost to a backlog the player cannot see.

TTL is 18–24 ticks. Seated offers ignore TTL entirely, which is already the
existing behaviour: `tick.ts` filters only the unseated stream.

Shortening TTL from 60–90 to 18–24 compounds with the credit rule. Expiry
returns a credit, so an ignored offer recycles its timer in ~21 ticks rather
than ~75. The offer stream gains roughly 3× the churn without any timer
interval changing. This is the largest single pace lever in the change.

### Rates

```ts
JOB_TIERS = [
  { rating: 1, unlockRep: 0,  slow: 40,  fast: 26  },
  { rating: 2, unlockRep: 4,  slow: 65,  fast: 40  },
  { rating: 3, unlockRep: 8,  slow: 95,  fast: 58  },
  { rating: 4, unlockRep: 12, slow: 130, fast: 80  },
  { rating: 5, unlockRep: 16, slow: 170, fast: 105 },
]
CANDIDATE_ARRIVAL = { slow: 60, fast: 45 }
REP_RAMP = 16
ARRIVAL_JITTER = 0.15
```

```
interval = lerp(slow, fast, clamp((rep - unlockRep) / REP_RAMP, 0, 1))
           × (1 ± ARRIVAL_JITTER)
```

Unlock thresholds reuse the existing `REP_PER_TIER = 4` ladder, so tier `n`
unlocks at reputation `(n - 1) × 4` — identical to today's `maxTier()`.

Reputation now does two legible things: it unlocks higher tiers, and it speeds
up the tiers already held, down to a floor. It never speeds a timer without
bound.

At reputation 0 only tier 1 (~40t) and candidates (~60t) are live, roughly one
offer per 24 ticks. At reputation 20 all six are live and would collectively
produce an offer every ~8 ticks if the player cleared instantly — but credits
and the single door bound the real rate to the player's decision speed.

Job rating is now determined by **which timer fired**. The job path stops
calling `maxTier()` entirely; it survives only to set candidate rank.

Reputation loss can re-lock a tier. An already-queued offer of that tier is
kept; the timer simply stops firing until reputation recovers.

### Opening

`newRun` places a 1★ job directly in `door` at tick 0, with its TTL already
running. The tier-1 credit is spent, so `job1` will not fire until that offer
is resolved. The candidate timer schedules normally.

### Animations

One tick is one second at default speed, so a `linear` width transition lasting
exactly one tick produces continuous motion: each bar reaches its target as the
next tick lands.

```css
#app { --tick: 1000ms; }
.bar > div { transition: width var(--tick) linear; }
```

`startLoop()` sets `--tick` from the `?speed=` parameter so animation and
simulation share a clock. Hardcoding `1s` would make `?speed=4` crawl a quarter
of the way and jump.

The threat bar wraps: on reaching `THREAT_CAP` it subtracts the cap, increments
`threatLevel`, and damages a merc — a jump from ~100% back to ~10%. Tweening
that reads as relief, when a merc just took a hit. Wrapping the bar in
`{#key mission.threatLevel}` remounts the element on level-up; a freshly mounted
node has no prior computed style, so it snaps with no transition and no
`requestAnimationFrame` dance. A `flash` keyframe on `.card` fires on the same
key change.

`prefers-reduced-motion: reduce` disables both the transition and the flash.

## Data model

```ts
type TimerKey = 'job1' | 'job2' | 'job3' | 'job4' | 'job5' | 'candidate'
```

`Offer` gains `source: TimerKey`. `postedAt` and `expiresAt` are `0` until
promotion.

`GameState` replaces `offers: Offer[]` and `nextOfferAt: number` with:

```ts
door: Offer | null
queue: Offer[]
timers: Partial<Record<TimerKey, number>>   // key -> tick it next fires;
                                            // absent = "reschedule me"
```

`SCHEMA_VERSION` 2 → 3. `store.svelte.ts` already returns `null` on a version
mismatch, so old saves reset to a fresh run rather than crashing on a missing
field. No migration code is needed.

## Components

- **`balance.ts`** — drop `OFFER_ARRIVAL_MIN`/`MAX` and `CANDIDATE_CHANCE`; add
  `JOB_TIERS`, `CANDIDATE_ARRIVAL`, `REP_RAMP`, `ARRIVAL_JITTER`; retune
  `OFFER_TTL_MIN`/`MAX` to 18/24.
- **`offers.ts`** *(new)* — the pump. `arrivalInterval(key, rep)`,
  `unlockedTimers(rep)`, `creditHeld(state, key)`, `pumpOffers(state, rng)`.
  Isolating it keeps `tick.ts` at its current size and makes the pump testable
  without running a mission.
- **`content.ts`** — `generateJob(state, rng, rating)` and
  `generateCandidate(state, rng)` replace `generateOffer`. Neither stamps TTL.
- **`tick.ts`** — calls `pumpOffers`; drops the inline arrival block.
- **`actions.ts`** — `takeOffer`, `seatOffer`, `hire`, `dispatch` read
  `door`/`seated` rather than `offers`. Resolving the door offer deletes its
  timer's `nextAt` entry so the next pump reschedules it. `actions.ts` consumes
  no RNG.
- **`JobsTab.svelte`** — renders `door` as a single card; `{#if}` not `{#each}`.
- **`App.svelte`** — tab badge counts `(door ? 1 : 0) + seated.length`. The
  queue stays hidden.
- **`DispatchSheet.svelte`** — existence check against `door`/`seated`.
- **`app.css`** — `--tick`, the `.bar > div` transition, the `flash` keyframe,
  and the reduced-motion block.

## Testing

Unit tests for the pump, in `tests/sim/offers.test.ts`:

- A timer that has fired does not fire again while its offer sits in `queue` or
  `door`.
- Resolving the door offer returns its credit and schedules `nextAt`.
- Expiry returns the credit just as accept/seat/reject do.
- Seating returns the credit while the offer persists in `seated`.
- Promotion is FIFO by fire order.
- A queued offer's TTL does not run; `expiresAt` is stamped on promotion.
- A locked tier never fires; crossing its `unlockRep` initialises its timer.
- `newRun` puts a 1★ job at the door with TTL running.
- Reputation raises arrival rates monotonically and never below `fast`.
- Player actions consume no RNG: resolving the door offer leaves `rngState`
  unchanged, so two runs on the same seed with the same actions at the same
  ticks produce identical states.

Existing `roster`, `run`, and `content` tests need porting to the new fields.

## Out of scope

`scripts/simulate.ts` and the bot's win-rate balance. The script reads
`state.offers` in three places and will not compile against the new state, so it
receives the minimum mechanical edit to keep `tsc` and `vitest` green
(`state.offers` → the door offer, if any). No bot heuristics change and the
52.5% win-rate target is not re-tuned; it will drift, and that is accepted.
Balance testing is the author's.
