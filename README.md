# Merc Company

A phone-first web game. You run a small mercenary company and must pay back a
loan before the cycle ends — or they break your legs. One loan cycle is one
~25-minute run: part schedule management, part risk management.

Svelte 5 + TypeScript + Vite. Fully static, client-side only; saves live in
localStorage.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server (append `?seed=1&speed=20` for deterministic fast runs) |
| `npm test` | Vitest suite over the simulation core |
| `npm run build` | Production build to `dist/` |
| `npm run check` | svelte-check + tsc over app and scripts |
| `npm run sim -- 1000` | Headless balance harness: bot plays N seeded runs, prints win rate, loss breakdown, cash curve |

## Architecture

- `src/sim/` — the whole game as a pure, deterministic state machine. No DOM,
  no Svelte, no `Math.random()`/`Date.now()`; all randomness flows through a
  seeded serializable RNG (`state.rngState`). Same seed → same run.
  `newRun(seed)` creates state; `tick(state)` advances one second; player
  verbs live in `actions.ts`; every tuning constant lives in `balance.ts`.
- `src/ui/` — thin Svelte layer. Renders state, calls sim actions, computes
  no game logic. `store.svelte.ts` drives 1 tick/sec and handles saves.
- `src/sim/projection.ts` — the dispatch forecast, sharing `squadPower` with
  the tick so the forecast can't drift from reality.
- `scripts/simulate.ts` — balance harness bot (test tooling, not game code).

Design docs: `docs/superpowers/specs/` (game spec) and
`docs/superpowers/plans/` (the implementation plan it was built from).

### Invariants (do not break)

1. **Design anchors:** mission work = `rating × 100`; base threat =
   `rating × 5`; minimum threat/tick = `rating`; threat bar cap = `18`.
2. **`squadPower` is the single source of squad maths** — completion and
   threat reduction both derive from it, and `projection.ts` must mirror any
   change to it.
3. Sim purity and determinism as described above. `GameState` stays
   JSON-serializable (no classes/Maps/functions); bump `SCHEMA_VERSION` on
   any shape change (old saves are discarded by design).
4. UI buttons must be disabled/hidden for every throw path of the action they
   call — sim actions throw on invalid input and the UI has no try/catch.
5. After any balance or maths change, re-run `npm run sim -- 1000`; the bot
   win rate should stay in the 40–70% band (currently ~52%).

---

## Planned features — design notes for a future agent

Two features are designed but not yet implemented. Work them the way the rest
of the repo was built: read the spec and plan first, TDD against the sim core
(failing test → implement → full suite), one commit per coherent step, and
re-validate balance with the harness before finishing.

### 1. XP and rank-ups

Mercs currently have a fixed rank for their whole life. Add per-merc
progression within a run.

**Data:** add `xp: number` to `Merc` (`src/sim/types.ts`), initialized to 0 in
`generateMerc` (`content.ts`). Add two records to `Mission`:
`ticksOnSite: Record<number, number>` (merc id → ticks spent on site,
incremented each tick for every member of `squad`) and
`withdrawn: number[]` (ids of mercs who were pulled out alive). Bump
`SCHEMA_VERSION`.

**Earning — XP is proportional to time on the job.** The full-mission XP for
a mission is `mission.rating`. When the mission **completes** (and only
then — failures award nothing, dead mercs get nothing), award each merc who
ever served on it:

```
share   = ticksOnSite[id] / totalMissionTicks     // 0..1
penalty = withdrawn.includes(id) ? RETREAT_XP_PENALTY : 1
xp     += mission.rating × share × penalty
```

with `RETREAT_XP_PENALTY = 0.1` in `balance.ts`. This has two deliberate
anti-cheese properties: a merc reinforced in at the last moment earns almost
nothing (tiny `share`), and pulling a merc out early forfeits 90% of what
they'd banked — e.g. a merc on site until 1 tick before completion who is
withdrawn has a 0.99 share but receives `0.99 × 0.1 ≈ 10%` of the mission's
XP. Withdrawal XP is settled when the mission completes, not at the moment of
withdrawal (if the mission subsequently fails, they get nothing, like
everyone else). Keep the award in the mission-completion branch of
`updateMission` (`src/sim/tick.ts` — the same block that pays out, awards
reputation, and calls `recordMissionTogether`) so all "mission ended"
bookkeeping stays in one place. XP is fractional — store it as a plain
number and display it rounded.

**Ranking up:** define cumulative thresholds in `balance.ts`, mirroring how
`BOND_THRESHOLDS` works — e.g. `RANK_UP_XP = [6, 14, 26, 42]` meaning a merc
reaches rank 2 at 6 xp, rank 3 at 14, etc. (numbers are placeholders — tune
via the harness). On crossing a threshold: `rank++` (cap 5), `maxHp +=
HP_PER_RANK`, heal the same amount (`hp += HP_PER_RANK`), keep cumulative xp
(no reset — thresholds are cumulative). Apply the check right after the xp
award so a rank-up lands the tick the mission completes.

**Why this shape:** rank feeds `squadPower` directly, so rank-ups compound
(stronger squad → faster missions → more xp). That's the fantasy, but it's
also a balance risk — the thresholds are the brake. Tune them so a merc who
works all run ranks up roughly once or twice in a 25-minute cycle, then
confirm the harness stays in the 40–70% band; expect to need a small `LOAN`
or threshold adjustment because the bot's mid-game gets stronger.

**UI:** show xp progress on the roster card (e.g. a thin bar under the rank
stars: `xp toward next rank`), and surface the rank-up moment (card flash or
a line in the mission card). Rank-ups also raise nothing else — hire price is
paid once and does not retroactively change.

**Tests to write first:** full-duration merc earns exactly `rating` xp on
completion; a merc reinforced in for the final N ticks earns `rating × N /
total`; a withdrawn merc earns `share × 0.1` (use the 0.99-share example from
above as a literal test case); nothing awarded on mission failure, including
to earlier withdrawers; dead mercs award nothing; threshold crossing raises
rank and maxHp exactly once; rank caps at 5; determinism test still passes
(no new randomness); a JSON round-trip preserves xp and the new mission
records.

### 2. Class perks

Classes (Breacher, Scout, Medic, Gunner, Fixer, Sniper) are currently pure
flavor. Give each one a mechanical identity **without** touching the core
completion/threat formulas.

**Design rule:** do NOT make classes a second stat that feeds `squadPower` —
that would entangle the projection maths and dilute the rank/affinity system.
Instead, classes hook *discrete events* at existing, well-defined moments in
`updateMission`. Event perks are easy to explain on a card, easy to test in
isolation, and leave the dispatch forecast honest.

**Shape:** a new `src/sim/classPerks.ts` module exporting pure helper
functions, called from the existing hook points in `tick.ts`:

| Hook point (already in tick.ts) | Example perk (illustrative, pick/tune at implementation) |
|---|---|
| Consequence damage roll | **Medic:** damage to *other* squad members reduced by 1 (min 1) |
| Supply/reinforcement arrival | **Scout:** travel times to their mission reduced by 1–2 ticks |
| Squad member arrives on site | **Breacher:** one-time completion chunk on arrival ("door's open") |
| Threat roll | **Gunner:** the random spike component shrinks (e.g. `2×P → 1.5×P`) |
| Mission payout | **Fixer:** payout +10% |
| Consequence target selection | **Sniper:** never the victim while any squadmate stands |

One perk per class, each behind a named constant in `balance.ts`. Perks that
stack (two Medics) should stack linearly and be capped where degenerate.

**Consistency requirements:** any perk that changes expected duration or
threat (Breacher, Gunner, Scout) must also be reflected in
`projection.ts` — the forecast being definitionally consistent with the sim
is an invariant, not a nicety. Perks that only fire on events after dispatch
(Medic, Fixer, Sniper) need no projection change but should appear in the
dispatch sheet as a small perk line on the merc pick, so squad-building
becomes a class puzzle too.

**Tests to write first:** one focused unit test per perk at its hook point
(e.g. "with a Medic on site, consequence damage to a non-Medic is reduced by
1"), a projection-consistency test for the duration/threat-affecting perks,
and a harness re-run — class perks are a net buff, so expect to rebalance
(the bot needs no changes; it dispatches by power, and perks ride along).

---

## Verification stack

Three layers, all green at last commit: 56 Vitest unit tests on the sim, the
headless harness (52.5% bot win rate over 1,000 seeded runs), and a ten-flow
Playwright walkthrough on a 390×844 viewport
(`docs/superpowers/e2e-checklist.md`).
