# Single-screen layout — design

**Date:** 2026-07-11
**Status:** approved, ready for implementation plan

## Problem

The game is split across three tabs — Roster, Jobs, Missions — with a bottom
`<nav>` to switch between them. Each tab holds too little to justify the
context-switching cost of jumping around. On a phone the player is constantly
tapping between tabs to keep three loosely-coupled concerns in their head.

## Goal

Collapse the three tabs into a single vertically-scrolling screen. No tab
switching: active missions, incoming offers, and the at-base roster are all
visible in one scroll.

## Decisions (from brainstorming)

- **Layout model: one scrolling page.** Not fit-in-viewport. Existing card
  detail is preserved; the player scrolls through stacked sections. Fitting
  everything in a phone viewport without scrolling would require condensing
  cards and was explicitly rejected.
- **Danger warning: nothing extra.** The bottom `nav` currently carries a red
  "danger badge" (count of missions past `DANGER_THREAT`) visible from any tab.
  With missions pinned to the top of the page and the existing per-card red
  flash/border already marking critical missions, no additional
  always-visible indicator is added. The header is left unchanged.

## Design

### 1. Shell (`src/App.svelte`)

Remove the tab machinery:

- Delete the `tab` state and its `{#if tab === ...}` switch in `<main>`.
- Delete the entire `<nav>` element.
- Remove the now-dead `dangerCount` derived value and the `DANGER_THREAT`
  import (only used for the removed badge). `CYCLE_LENGTH` and the clock stay.

`<main>` becomes one scrolling column rendering all three components stacked in
fixed order:

1. **Active Missions** — `<MissionsTab />`
2. **Incoming** — `<JobsTab />` (door offer + waiting-room seats)
3. **At Base** — `<RosterTab />`

The header (cash · loan · clock · rep · restart · pause) is untouched.

### 2. Section headers (in `App.svelte`, wrapping each component)

Each component is wrapped in a `<section>` with an `<h2>` heading so the page
has visual rhythm and the player can orient while scrolling. The counts the
`nav` used to show are folded into these headings so no information is lost:

- `ACTIVE MISSIONS ({missions.length})`
- `INCOMING` — `JobsTab` keeps its own internal "waiting room (n/seats)" and
  "at the door" sub-headers, which nest under this heading
- `AT BASE ({mercs.length}/{rosterSlots})`

These counts come straight from `game.state` (reactive) — no new state.

Heading styling reuses the existing uppercase/dim `h3` treatment already used
inside `JobsTab` (promoted/mirrored for the section `h2`), keeping one visual
language. Section headers are non-sticky; the fixed app header is the only
sticky chrome.

### 3. Unchanged

- The three components' internal card layouts, actions, empty-states, and
  reactive derivations are untouched — they remain pure `game.state` renderers
  that compute no game logic.
- `DispatchSheet` still opens from `JobsTab` as a full-screen fixed overlay
  and covers the whole page, so squad-picking still blocks interaction as
  before.
- `store.svelte.ts`, the sim, persistence, and restart flow are untouched.

### 4. CSS (`src/app.css`)

- Remove the `nav`, `nav button`, `nav button.active`, and `.danger-badge`
  rules (dead once `<nav>` is gone).
- Add a `section` / section `h2` rule for the stacked headings.
- `main { flex: 1; overflow-y: auto }` already provides the single scroll
  region — no structural CSS change needed there.

## Out of scope (explicitly deferred)

- Condensing cards / fit-in-viewport.
- 2-column roster grid.
- Sticky section headers.
- Reordering the Incoming section (door-before-seats).

## Verification

The UI has no vitest coverage by design (see `vitest.config.ts` rationale);
it is verified end-to-end. Build and drive with Playwright per
`.claude/skills/verify/SKILL.md` to confirm:

- All three sections render stacked in one scroll, in order
  (missions → incoming → base), with correct counts in the headings.
- Scrolling reaches the roster; no tab bar remains.
- Actions still fire from each section: accept (opens DispatchSheet), hire,
  reinforce, heal, dismiss.
- `npm run check` passes (no dangling `tab`/`DANGER_THREAT`/`dangerCount`
  references).
