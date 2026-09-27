---
phase: quick-260926-vur
plan: 01
status: complete
subsystem: now-playing lyrics + comments
tags: [cache-control, lyrics, touch, slider, i18n]
requires: []
provides:
  - "src/lib/services/lyric-hold.ts (holdStep, pointerHoldEvent, HOLD_IDLE)"
  - "Timing slider in the NpLyrics .sync row"
  - "Client-facing no-cache on GET /api/comments and GET /api/lyric-offset"
affects: [NpLyrics.svelte, /api/comments, /api/lyric-offset, 15 locale files]
tech-stack:
  added: []
  patterns: ["pure decision machine (.ts) + thin component dispatch", "native <input type=range>"]
key-files:
  created:
    - src/lib/services/lyric-hold.ts
    - src/lib/services/lyric-hold.test.ts
  modified:
    - src/routes/api/comments/+server.ts
    - src/routes/api/lyric-offset/+server.ts
    - src/routes/api/comments/comments-endpoint.test.ts
    - src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts
    - src/lib/stores/comments.svelte.test.ts
    - src/lib/components/NpLyrics.svelte
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - "GET replies answer Cache-Control no-cache to the browser; the cache.put copy keeps public, max-age=N for the edge"
  - "Touch/pen hold tracked with touch events (survive native scroll takeover); pointer path is mouse-only"
  - "Scroll dispatch listens on the parent .panel (the real scroller), not .lyrics"
metrics:
  duration: "~8 min"
  completed: 2026-09-26
  tasks: 3
  files: 23
---

# Quick 260926-vur: Fresh comment survives song change, lyrics timing slider, hold never snaps back

GET /api/comments and /api/lyric-offset now tell the browser `no-cache`, while the edge copy keeps its TTL. The lyrics pane tracks a touch hold with touch events through a pure `holdStep` machine. A native range slider replaces the long-press sync gesture.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | 74159c4b | test: client GET replies expect no-cache; stored edge copy keeps its TTL |
| 1 (GREEN) | dc2c59a3 | fix: GET /api/comments and /api/lyric-offset answer no-cache to the browser |
| 2 (RED) | f73dbb01 | test: lyric-hold machine cases |
| 2 (GREEN) | 7b755e34 | feat: pure lyric-hold machine |
| 2 | de4c4f80 | fix: held lyrics never snap back; remove hold-to-sync |
| 3 | 566ceb50 | feat: lyrics timing slider; momentum re-arm listens on the real scroller |

## Verification (observed)

- Task 1 verify: RED run showed 4 failures (the no-cache expectations on hit + miss in both endpoints; the new store test passed already, as the plan expected). After the route change: 3 files, 54/54 pass. `grep -c "ttl:"` = 0 for both routes.
- Task 2 verify: lyric-hold.test.ts had no tests to run before the module existed, then 10/10 passed. All grep checks printed VERIFY-OK.
- Task 3 verify: `offsetHint` absent from src, `type="range"` present, i18n + lyric-hold tests 60/60 pass.
- Final: `pnpm check` gave 4637 files, 0 errors, 0 warnings. `pnpm test` gave 165 files and 3646/3646 tests passed.
- NOT verified here: browser E2E (left to the orchestrator) and APK/emulator touch behaviour. Slider rendering, touch-hold-through-scroll and the Cache-Control headers from a live deploy were not observed in a browser.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Scroll dispatch was on an element that never scrolls**
- **Found during:** Task 3 (tracing the momentum path)
- **Issue:** `onscroll` sat on `.lyrics`, but the scroller is the parent NowPlaying `.panel` (`overflow-y: auto`), and `scroll` does not bubble. So the momentum re-arm (Pitfall 1 / D-10) never fired, and the plan's "momentum included" must-have could not hold.
- **Fix:** an `$effect` adds a passive `scroll` listener on `lyricsEl.closest('.panel')` that dispatches `{ type: 'scroll' }`, and the dead `onscroll` attribute is removed. The anchor pass's own smooth scroll reaches this listener too, and it is a no-op while idle.
- **Files:** src/lib/components/NpLyrics.svelte. **Commit:** 566ceb50

**2. [Rule 1 - Bug] Multi-touch action vs the plan's own rule**
- The plan's rule says `touches > 0` returns 'suspend', but its behavior block wants a later touch(1) during a hold to return 'none'. `holdStep` returns 'none' when contact is already held and suspended. Nothing can be armed then, because scroll and tick both no-op while held, so this is safe. The test asserts `['suspend','none','none','arm']`.

**3. Slider CSS**
- The plan's `width: min(100%, 320px); margin: 2px auto 0` has no effect beside `flex-basis: 100%` in a wrapping flex row: flex-basis overrides width, and there is no free space for auto margins. The shipped CSS is `flex-basis: 100%; margin: 2px 0 0; accent-color; touch-action: none`, so the slider spans the full row. Add a width cap only if a wide (tablet) column looks too long.

**4. windowMouseUp ignores non-mouse pointers before removing listeners**
- A touch pointerup elsewhere returns early instead of tearing down the mouse listeners, so a mixed-input mouse press never loses its release.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/services/lyric-hold.ts, src/lib/services/lyric-hold.test.ts
- FOUND commits: 74159c4b, dc2c59a3, f73dbb01, 7b755e34, de4c4f80, 566ceb50

## Orchestrator E2E

- **Cache headers (dev server):** `GET /api/comments` and `GET /api/lyric-offset` both answer `cache-control: no-cache` (was `public, max-age=60/300` on production — the measured root cause of "posted comment disappears after a song change").
- **Slider (browser pane):** row shows −0.5s · readout · +0.5s + a ±60 s / 0.1 s range labelled "Adjust lyrics timing"; the "Hold a line" hint is gone; dragging moved the active line live (idx 5 → 15 → 21). Centring could not be measured in the pane (Now Playing's own open transform stays frozen there).
- **Slider (Android emulator, debug APK from this commit, CDP):** −15/−35/−55 s moved the active line 12 → 15 → 17 and it sat at **50%** of the visible band each time.
- **Hold (Android emulator, real touch via `adb shell input motionevent`):** before 330/50% → finger down + scroll to peek 468 → **still 468 after holding 5 s** → still 468 1 s after lift → re-centred 330/50% ~5 s after lift. The WebView's scroll-takeover `pointercancel` no longer resumes auto-centre mid-hold.
- A slider test left a debounced vote that may have posted a single `0` offset vote to production for "Gateway Drug" before the reset cancelled it — harmless (one vote can never reach the 3-vote consensus).
- Not E2E'd: an actual comment post + song change round-trip (needs a solved Turnstile + publishes publicly); covered by the store test and the header fix.
