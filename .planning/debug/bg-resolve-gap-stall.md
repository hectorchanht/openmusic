---
gsd_debug_version: 1.0
slug: bg-resolve-gap-stall
status: fix-applied-pending-device-verify
trigger: "Android lock screen, current song playing. Sometimes it stops at the beginning of the NEXT song with 0:00 and empty duration. The same song plays fine when the user switches next then prev. Sometimes the next song does auto-play on lock screen. User theory: songs played before are CF-worker-cached so they load fast/seamless and Android does not kill them; never-played songs load slower, stall, and get frozen by Android."
created: 2026-07-08
updated: 2026-07-08
---

# Debug: background auto-advance freezes at 0:00 when the next track needs a cold network resolve

## Symptoms
- Android Chrome, screen locked / app backgrounded.
- On track-end (or an error-skip), the next track becomes current but shows **0:00, empty duration**, never auto-plays.
- Foreground / next→prev makes it play (it is genuinely playable).
- Intermittent: warm (previously-played) tracks advance seamlessly; cold (never-played) ones freeze. Matches user theory.

## Root cause (confirmed by log + code trace)
The freeze is the **resolve gap**: the window between the OLD `<audio>` src stopping and a NEW src being
attached + `play()` succeeding. During that gap NO media is actively decoding, so Android is free to
**freeze the WebView** — timers throttle, in-flight `fetch` never settles. `play()` does
`await ensureTrackDetails(track)` (network) BEFORE `audio.src = …`. If the resolve has not returned before
Android freezes the page, it never returns → no src, no `loadedmetadata` (**0:00 / no duration**), no
`playing`, and the initial-load stall watchdog (`armStall`, a `setTimeout`) is throttled → nothing escapes.
Warm tracks survive because `ensureTrackDetails` short-circuits when `detailsLoaded && audioUrl`
(`catalog.ts:216`) → src attaches instantly → playback resumes before any freeze.

Two concrete freeze signatures in the supplied action log:

- **Freeze 1 (cold track after a bg-error-skip).** `netease:2724714495`: play → resolve.ok → audio.error(n:2)
  → reresolve.cap → `bg-error-skip` → advance → `play netease:2724711904` → **no `resolve.ok` ever** →
  `pause(deliberate:false)` → dead until the user wakes the screen 11s later and manually picks a track.
  `2724711904` was never prefetched (the skip landed on it) so its cold resolve hung.
- **Freeze 2 (in-place reresolveCurrent).** `netease:2724711893`: play → resolve.ok → `audio.error(hasPlayed,
  reresolve:true)` → (single in-place `reresolveCurrent()`, reresolveBurst≤1) → **nothing** for 44 min until
  foreground. `reresolveCurrent` re-resolves + re-attaches src but deliberately does NOT arm the watchdog
  (`player.svelte.ts:476`); its background resolve/attach hung.

Common thread: **any advance/recovery path that must run a fresh async resolve while `document.hidden` can
hang with no background-safe escape.** Prior fixes (`bg-error-skip`, single-reresolve-then-skip, stale-flag
fix) all addressed `audio.error` *routing* — none removed the cold-resolve gap itself.

## Eliminated / not the cause
- Not the `audio.error` routing (bg-error-skip works — log shows long clean bg chains where every advance
  hit a warm/short resolve).
- Not a permanently-dead track (plays fine on foreground / next→prev).
- Not the autoplay-gesture block alone (warm tracks auto-play backgrounded in the same log).

## Prior related sessions (heavily iterated — do NOT re-tread)
- `background-autoadvance-stall.md` (same 0:00 symptom; fix = foreground resume, later REMOVED by quick 260703-i7e)
- `bg-no-pill-split-play-stop.md` (bg-error-skip Option B)
- `midplay-stall-background.md` (single re-resolve then skip)
- `autoadvance-pauses-after-1s.md`, `reresolve-loop-stops-playback.md`, `android-pwa-no-refresh-resume.md`

## Verification constraint
Device-only. Cannot reproduce in dev preview (no Android lock/background-freeze). Any fix ships
"awaiting_human_verify" and must be confirmed on-device via Settings → Activity log.

## Fix applied (safe core — no second audio element)
`src/lib/stores/player.svelte.ts`:
1. **Freeze 2 — BG-SKIP-FIRST.** In the `error` handler, when `hasPlayedSinceSrc && document.hidden`, SKIP the
   in-place `reresolveCurrent()` entirely and advance forward immediately (`this.next()`). The in-place
   re-resolve re-attaches src + awaits events that never fire on a frozen page → the 44-min 0:00 hang.
   Foreground keeps the richer reresolve → cap → cross-source `runFallback`. Subsumes the old post-cap
   bg-error-skip (skipping on the FIRST error is strictly safer than one hang-prone in-place attempt).
2. **Freeze 1 — DEPTH-2 prefetch (`warmAfter`).** After `prefetchNext()` lands the immediate-next, best-effort
   pre-resolve the FOLLOWING entry (no probe) so a region-lock 403 on the landed track skips into an
   already-`detailsLoaded` track whose `play()` short-circuits `ensureTrackDetails` — no cold background
   resolve in the src-swap gap. Fire-and-forget, reuses the walk's AbortSignal + seedUid guard.

Tests: updated the HIDDEN bg-error test to the new first-error-skip contract; added 2 `warmAfter` tests.
`pnpm check` clean; `pnpm test` 1062 passed.

## Held (opt-in, only if device test still freezes)
- **Option 2 (silent-audio keep-alive bridge):** would hold the page awake during an unavoidable cold resolve,
  but a second Audio element is exactly what `autoadvance-pauses-after-1s` blamed for the "plays 1s then
  pauses" audio-focus steal — untestable off-device, so held. If needed, do a SAME-element silent bridge.
- **Option 3 (bg-resolve timeout → skip):** a `setTimeout` is throttled in a frozen WebView so it can't beat
  a truly frozen page (only fires on foreground). Low value once Freeze 1/2 are closed; skipped.

## Current Focus
- hypothesis: Fixes 1+2 close both observed freeze signatures without touching audio-focus. Warm-track behavior
  now extends to the post-skip cold track via depth-2 prefetch.
- next_action: DEVICE VERIFY on Android (locked, let a netease-heavy queue auto-advance). Watch Settings →
  Activity log: a `bg-error-skip` should now appear on the FIRST error while hidden, and advances should show
  `resolve.ok` fire fast (short-circuit) with no `play`-without-`resolve.ok` dead ends. If it still freezes,
  escalate to the held same-element silent bridge (Option 2).
