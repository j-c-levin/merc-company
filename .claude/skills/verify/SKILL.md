---
name: verify-merc-company
description: how to launch and drive merc-company to verify changes end-to-end
---

# Verify merc-company end-to-end

## Build and launch

```sh
npm run build && npm run preview   # serves dist/ on port 4173
```

Open **`http://localhost:4173/merc-company/`** — note the `/merc-company/`
subpath (vite `base` for GitHub Pages); the domain root 404s.

## Drive with Playwright

Navigate to `http://localhost:4173/merc-company/?seed=42&speed=10`
(deterministic seed, 10 ticks/second). Assert on `window.__game.state`:

- `tick`, `cash`, `reputation`, `status` (`'running'` while live)
- `mercs[].hp` (and `maxHp`, `rank`, `affinity`)
- `seated` (the waiting-room offers array, capped at `waitingSeats`), `nextOfferAt`
- `missions[]` (`workDone`, `workRequired`, `threatBar`, `threatLevel`, `squad`)
- `stats.{jobsDone,jobsFailed,mercsLost}`

Pause before interacting with short-TTL seated offers:

```js
window.__game.paused = true
```

## Gotchas

- Seated offers expire in ~2 s real time at speed 10 (TTL is 18–24 ticks) —
  pause first, or they're gone before the next tool call.
- A surviving localStorage save overrides `?seed` — and the app autosaves on
  unload, so `localStorage.removeItem(...)`/`.clear()` then `page.goto()` is
  **not enough**: navigating away from a page re-triggers its own unload
  autosave, which rewrites the very key you just cleared with whatever that
  page's in-memory state was, and the next load reads that back. This can
  make every "fresh" reload look identical no matter how many times you clear
  storage or open new tabs. Use the in-app header restart button (⟲, or the
  "new company, new name" button on the game-over screen) to get a
  guaranteed-clean run instead of fighting localStorage from outside the page.
- To hold real-time state changes to a tight, reproducible window without
  inter-tool-call latency skewing tick counts, do the pause/mutate/unpause/
  wait/re-pause sequence inside a single `browser_evaluate` call (an async
  function with an in-page `await new Promise(r => setTimeout(r, N))`),
  rather than spanning it across separate tool calls — the gap between two
  separate tool calls is real wall-clock time the sim keeps ticking through,
  which can blow past `CYCLE_LENGTH` before your next call even runs.
- Svelte flushes renders asynchronously — after a programmatic `.click()`,
  wait ~100 ms before reading the DOM.
- The dispatch sheet is a full-screen overlay: it blocks nav clicks while
  open (close it or dispatch first).
- `visibilitychange` auto-pauses the sim when the tab is hidden; unpause via
  `__game.paused = false` after tab switches/screenshots.
