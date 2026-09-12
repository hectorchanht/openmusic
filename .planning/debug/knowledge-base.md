# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## stall-kills-healthy-tracks — foreground `stalled` media event executes healthy-but-slow tracks (retry → skip, no ✗)
- **Date:** 2026-09-12
- **Error patterns:** stalled, media.stalled, stall.retry, stall.skip, skipped, no cross, no ✗, couldn't play, rs:0, readyState 0, HAVE_NOTHING, buf:0, first-byte, reresolveCurrent, strike.clear-all, healthy track skipped, 3.2s, 3240ms
- **Root cause:** The `stalled` listener in `Player.attach()` called `recoverLoadStall()` on the first `stalled` in the FOREGROUND; it was only ever needed as the background (throttled-timer) trigger. Chrome fires `stalled` once per load ~3s after src.set with no bytes, overlapping this device's normal 1.8–2.9s first-byte, so healthy tracks were retried (re-attach kills the in-flight load) then skipped by the retried src's own `stalled`. One strike vs STRIKE_CAP=3 → invisible skip.
- **Fix:** Gate the `stalled` listener on `document.hidden` (foreground defers to the un-throttled 15s STALL_TIMEOUT_MS watchdog + `error`); re-arm `armStall()` in the retry branch since `reresolveCurrent` arms nothing (D-14). ✗ stays reserved for STRIKE_CAP confirmed failures (31-D-16); live-skip visibility is emitSkipNotice (31-D-18).
- **Files changed:** src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts
---

