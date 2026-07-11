# "Take a seat" — lock an offer open

**Date:** 2026-07-11
**Status:** approved, ready for planning

## Summary

Re-introduce a per-offer **"take a seat"** button in the waiting room. Pressing it
**permanently pins** that seated offer so it never times out. The seat it occupies
never frees, which throttles incoming offers by one — that reduced offer flow is the
whole cost.

An earlier "take a seat" button existed under the old two-collection model
(`state.offers` door stream → `state.seated` waiting room) and moved an offer from
the door into a seat. The seat-gated rewrite (commit `c307ceb`) deleted `state.offers`
— offers now arrive directly into free seats — so that button lost its purpose and was
removed. This feature reuses the name for a **different, cleaner mechanic** built on
the current model: pinning an already-seated offer against its TTL.

## Motivation

Every seated offer carries a TTL (`expiresAt`) and walks when it runs out. A player who
likes a job but isn't ready for it (mercs on missions, crew hurt, cash short) currently
has no way to hold it. "Take a seat" lets them reserve it — paid for by that seat staying
occupied, since the pump only spawns a new offer when
`state.seated.length < state.waitingSeats`.

## Decisions (locked)

- **Permanent.** No un-lock. A locked offer stays until the player hires / accepts /
  rejects it. There is no "release" action.
- **No seat floor.** The player may lock every seat and stop new offers entirely. A
  self-inflicted stall is allowed.
- **Free.** No credit cost. The held seat (reduced offer throughput) is the entire price.

## Design

### Data model — `src/sim/types.ts`

Add an optional flag to `Offer`:

```ts
export interface Offer {
  // ...existing fields...
  locked?: boolean // pinned via "take a seat"; never expires, holds its seat until resolved
}
```

Absent = `false`. This is **purely additive and backward-compatible**: old saves have
no `locked` field, so their offers read as unlocked and keep the current expiry behaviour.
**No `SCHEMA_VERSION` bump** — in-progress games survive the update.

### Action — `src/sim/actions.ts`

```ts
export function takeSeat(state: GameState, offerId: number): void {
  const offer = state.seated.find(o => o.id === offerId)
  if (!offer) throw new Error(`no offer ${offerId}`)
  offer.locked = true // idempotent: no-op if already locked
}
```

Follows the existing action idiom (find in `seated`, throw if missing, mutate in place).

### Pump — `src/sim/offers.ts`

One-line change to the expire step so locked offers are never swept:

```ts
// 1. expire seated offers whose TTL ran out (frees seats) — locked offers are held
state.seated = state.seated.filter(o => o.locked || o.expiresAt > state.tick)
```

Steps 2 (schedule) and 3 (arrive, gated on `state.seated.length < state.waitingSeats`)
are **untouched**. A locked offer keeps counting against the seat cap, so the throughput
throttle is automatic — no new gating logic.

### Exits need no change

`hire`, `dispatch`, and `rejectOffer` all call `takeOffer`, which filters the offer out of
`state.seated` regardless of `locked`. That is exactly the "held until resolved" exit —
no special-casing required.

### UI — `src/ui/JobsTab.svelte`

On each offer card (the `offerCard` snippet):

- Add a **"take a seat"** button (ghost style, alongside "reject"). Hidden when
  `offer.locked` is already true.
- When `offer.locked`:
  - Replace the red TTL bar and the "`Ns before they walk`" line with a
    **"held — occupying a seat"** badge, so the player sees the throughput cost they've
    taken on.
- Wire the button to `act(() => takeSeat(game.state, offer.id))`.

The existing **"add a seat"** button (`buySeat`, which grows `waitingSeats`) stays as-is.
"add a seat" (grow the room) vs "take a seat" (pin this offer) read distinctly and sit
side by side.

## Testing — `tests/sim/`

New unit tests:

1. `takeSeat` sets `locked` on the target seated offer; throws for an unknown id;
   is idempotent when called twice.
2. A locked offer survives past its original `expiresAt` (still in `seated` after the
   pump runs beyond that tick).
3. A locked seat reduces effective arrivals: with all seats locked, no new offer
   arrives even when `nextOfferAt` is due.
4. `rejectOffer` / `hire` still remove a locked offer (frees the seat).

The offer-mix harness (`measureOfferMix` in `scripts/simulate.ts`) rejects every offer
each tick, so it never locks anything — its regression bands are unaffected. Full
`npm test` and `npm run sim` will confirm no balance regressions.

## Out of scope (YAGNI)

- Un-locking / releasing a seat.
- Any seat floor / minimum free seats.
- Credit cost or other economic gate for locking.
- Locked-offer indicators anywhere outside the waiting room card.
