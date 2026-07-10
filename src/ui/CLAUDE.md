# src/ui — thin Svelte 5 (runes) layer

Renders sim state and calls sim actions; computes no game logic. Rule: every
throw path of a sim action must be covered by a disabled/hidden button — the
actions throw on invalid input and the UI has no try/catch.

## Component map

| Component | Role |
|---|---|
| `../App.svelte` | shell: header (cash, loan+clock, rep, restart, pause), tab switch, nav with danger badge, mounts `EndScreen` on run end |
| `JobsTab.svelte` | waiting room + the door offer (TTL bar), seat/reject/hire, opens `DispatchSheet` |
| `DispatchSheet.svelte` | bottom-sheet squad picker with live `project()` forecast and bond preview; full-screen overlay (blocks nav while open) |
| `MissionsTab.svelte` | mission cards: work/threat bars, threat-level flash, reinforce/withdraw/supplies |
| `RosterTab.svelte` | merc cards (hp, status, bonds), medbay heal, two-step dismiss, slot purchase |
| `EndScreen.svelte` | win/lose overlay with run stats and restart |

Shared styles (`.card`, `.bar`, `button.action`/`.ghost`/`.danger`, flash
animation, `--tick`-synced bar transitions) live in `../app.css`. Note the
specificity comment on `button.danger` there: a bare `.danger` loses to
`button.ghost` and silently does nothing.

## store.svelte.ts — state, loop, persistence

- `game` is a `$state({ state, paused })`. `act(fn)` runs a sim action then
  `saveNow()`; the tick loop also saves every tick.
- Persistence: `SAVE_KEY = 'merc-company-save-v1'`; `load()` discards any
  save whose `schemaVersion !== SCHEMA_VERSION` (from `balance.ts`) — bump
  the version instead of migrating.
- `startLoop()` (once, from App): reads `?seed` (fresh runs only — a loaded
  save wins) and `?speed` (ticks/second, also sets the `--tick` CSS var so
  bar animations track sim speed), drives `setInterval` ticks, auto-pauses on
  `visibilitychange` when the tab hides, and exposes `window.__game` for
  Playwright.
- `restart()` wipes the save and swaps `game.state` in place with a fresh run
  (unpauses too). Used by `EndScreen` and the header restart button.

## Header restart: two-step confirm pattern

First click arms (`confirmingRestart`, button gains `.danger` and reads
"confirm wipe"); a 4 s timeout disarms; a second click within the window
clears the timeout and calls `restart()`. `RosterTab`'s dismiss uses the same
arm/confirm idea (state-based, without the timeout).

## Why the UI has no vitest coverage

Adding the svelte plugin to vitest drags in Vite 8.1 dependency optimization,
which crashes on rolldown's virtual runtime module (tsconfig resolution bug —
see the header comments in `vitest.config.ts` and `vite.config.ts`). The
suite is therefore pure sim code in node; the UI is verified end-to-end with
Playwright instead — recipe in `.claude/skills/verify/SKILL.md`.
