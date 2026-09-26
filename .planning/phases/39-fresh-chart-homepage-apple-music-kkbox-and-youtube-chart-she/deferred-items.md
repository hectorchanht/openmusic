# Phase 39 deferred items

## From 39-08 (found during the placeholder E2E, out of scope)

- **Chart pools are persisted only when the whole refresh settles.** `refresh()` calls `saveCache()`
  after the classic fan-out (22 tags + 7 countries at FANOUT_CAP 4), which on a cold load lands about
  5.5 s after navigation (measured in headless Chromium against :5173). A full reload or app close
  inside that window throws away chart pools that already landed on screen, so the next open is cold
  again and shows placeholders again. In-app navigation is not affected (the refresh keeps running
  and saves). Possible fix: `saveCache()` once the chart runner settles, before the classic fetch.
  Pre-existing since 39-07.
