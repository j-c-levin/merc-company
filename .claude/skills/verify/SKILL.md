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

- `tick`, `cash`, `reputation`, `status`
- `mercs[].hp` (and `maxHp`, `rank`, `affinity`)
- `door` (current offer or null), `queue`, `seated`
- `missions[]` (`workDone`, `workRequired`, `threatBar`, `threatLevel`, `squad`)
- `stats.{jobsDone,jobsFailed,mercsLost}`

Pause before interacting with short-TTL door offers:

```js
window.__game.paused = true
```

## Gotchas

- Door offers expire in ~2 s real time at speed 10 (TTL is 18–24 ticks) —
  pause first, or they're gone before the next tool call.
- A surviving localStorage save overrides `?seed`:
  `localStorage.removeItem('merc-company-save-v1')` (or the header restart
  button) for a truly fresh run.
- Svelte flushes renders asynchronously — after a programmatic `.click()`,
  wait ~100 ms before reading the DOM.
- The dispatch sheet is a full-screen overlay: it blocks nav clicks while
  open (close it or dispatch first).
- `visibilitychange` auto-pauses the sim when the tab is hidden; unpause via
  `__game.paused = false` after tab switches/screenshots.
