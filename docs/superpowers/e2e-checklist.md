# E2E Verification Checklist — Merc Company

End-to-end walkthrough driven with Playwright (MCP) against the running dev
server (`npm run dev`, `http://localhost:5173/?seed=1&speed=20`), mobile viewport
**390×844**, deterministic seed 1. Numeric assertions read from
`window.__game.state`; actions performed through the UI. Time was controlled by
toggling the store's pause flag between steps (equivalent to the pause button) so
the speed-20 sim did not outrun tool-call latency.

Result: **10 / 10 flows PASS. No app bugs found — no code changes required.**

| # | Flow | Result | Evidence |
|---|------|--------|----------|
| 1 | Header / clock | PASS | Header rendered `500cr`, `loan 5000cr · 13:44` (clock counting down), `rep 0`; clicking the pause button froze the tick counter (stayed at 957 across a 0.8 s read → `paused:true, frozeDelta:0`). |
| 2 | Offer stream | PASS | Offer cards appeared at the door with draining timers ("25s / 81s before they walk"); `__game.state.offers` held entries with `expiresAt` (e.g. candidate id 3 `expiresAt:124`, job id 7 `{r:1,env:forest,work:100}`). |
| 3 | Waiting room | PASS | Clicked "take a seat" on Sana Ferro (`expiresAt:124`); she moved to `state.seated` and was still seated at tick 163 — 39 ticks past her original TTL. |
| 4 | Dispatch | PASS | Accepted a ★ forest job, selected both starters in the sheet; projection showed finite `duration: ~25s` and a risk line `risk: 1–4 consequences (likely 2)`; "send them" created mission id 8 (`squad:[1,2]`, `workRequired:100`) and the Missions tab badge read `Missions (1)`. |
| 5 | Mission life | PASS | Over 18 ticks both bars advanced (`workDone 0→72`), threat overflowed (`threatLevel 0→2`), and squad hp dropped (Vera Mbeki 20→19, Piotr Okonkwo 20→18). |
| 6 | Intervention | PASS | Clicked "medkit 100cr"; the `📦 medkit lands in 3s` in-transit chip appeared and cash fell 400→300; after it landed, lowest-hp squad member Piotr healed 18→20. |
| 7 | Reinforce / withdraw | PASS | "reinforce" → "send Vera Ash" added an inbound that arrived and joined the squad chips (`squad:[6]`). "pull out" made mercs homebound; the Roster tab showed Vera Ash `4/20 hp · traveling` while the returned starters read `idle`. |
| 8 | Run end | PASS | Let the clock run out naturally (tick 296→1500 at 20 ticks/s, no state injection); status became `lost`, the end screen showed the ledger ("They broke your legs. You were 4700cr short.", jobs failed 1, mercs standing 3); "new company, new name" started a fresh run at `cash:500`, `mercs:2`, stats reset, `status:running`. |
| 9 | Save / resume | PASS | Mid-run (`save.tick:191`) set a non-app `window.__sentinel`, then `location.reload()`; after reload the sentinel was gone (genuinely fresh JS context) yet the run resumed at tick 296 — not 0 — with cash 300 and all 3 mercs intact. |
| 10 | Mobile fit | PASS | Viewport 390×844; `documentElement.scrollWidth === clientWidth === 390` (no horizontal overflow); tap targets (nav tabs, action/ghost buttons) comfortably sized. Final screenshot: `docs/superpowers/e2e-final.png`. |

## Notes / environment observations (not app bugs)

- **`browser_navigate` did not re-execute the app** in this MCP session — the page
  context persisted (in-memory-only injected values survived navigation to a fresh
  nonce URL). `window.location.reload()` *does* perform a real reload (verified via
  the sentinel in flow 9), so it was used to reset/resume. Clean fresh runs were
  obtained via the in-app restart button.
- **Console errors seen are unrelated to this app**: a WebSocket failure to
  `ws://localhost:5183` (a second, unrelated dev server's HMR) and Google ad
  resources from a leftover browser tab. No errors originated from the app on 5173.
- The store auto-pauses on `visibilitychange`; the tab stayed visible
  (`document.hidden:false`) throughout, so the sim advanced normally when unpaused
  (measured a steady 20 ticks/s).
