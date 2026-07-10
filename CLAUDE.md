# Merc Company — orientation index

Phone-first web game: run a mercenary company, pay back a 5000cr loan before a
~25-minute cycle (1500 ticks) ends. Svelte 5 (runes) + TypeScript + Vite 8,
fully static, saves in localStorage. The whole game is a pure, deterministic,
JSON-serializable state machine in `src/sim/` (seeded RNG, no DOM, no
`Math.random`/`Date.now`); `src/ui/` is a thin Svelte layer that renders state
and calls sim actions, computing no game logic itself.

This file is a router. For balancing work read `src/sim/CLAUDE.md` first; for
UI work read `src/ui/CLAUDE.md`.

## Where things live

| Area | Pointer |
|---|---|
| All tuning constants (the only file balancing edits touch) | `src/sim/balance.ts` |
| Sim core: tick pipeline, missions, offer pump, actions, projection | `src/sim/` — see `src/sim/CLAUDE.md` |
| Balance regression gates (exact, deterministic) | `tests/sim/harness.test.ts` |
| Balance harness bot + scenario/offer-mix measurement | `scripts/simulate.ts` (exports `runMissionScenario`, `measureOfferMix`) |
| Sim unit tests (vitest, pure node — UI deliberately excluded) | `tests/sim/`, exclusion rationale in `vitest.config.ts` |
| UI components, store, persistence, restart | `src/ui/` — see `src/ui/CLAUDE.md` |
| Shared CSS (cards, bars, buttons, tick-synced animations) | `src/app.css` |
| End-to-end verification recipe (build, drive with Playwright) | `.claude/skills/verify/SKILL.md` |
| Deploy: GitHub Pages under `/merc-company/` subpath | `.github/workflows/deploy.yml`, `base` in `vite.config.ts` |
| Design docs (spec + plans) | `docs/superpowers/` — **historical**: worked balance numbers there (work = rating×100, threat = rating×5) predate the current retune; `src/sim/balance.ts` is the source of truth |
| README | commands, invariants, planned-feature designs — same caveat: its literal balance numbers and the "bot 40–70% win band" predate the retune |

## Commands

| Command | What |
|---|---|
| `npm run dev` | dev server (append `?seed=1&speed=20` for deterministic fast runs) |
| `npm run build` / `npm run preview` | production build / serve it at `http://localhost:4173/merc-company/` |
| `npm test` | vitest suite (82 tests, sim only) |
| `npm run check` | svelte-check + tsc over app and scripts |
| `npm run sim` | full bot runs: win rate, cash curve (`npm run sim -- 1000` for N runs) |
| `npm run sim -- scenario` | mission outcome distributions (fresh 1★ mercs on a 1★ job) |
| `npm run sim -- offers` | offer-mix-by-reputation table |
