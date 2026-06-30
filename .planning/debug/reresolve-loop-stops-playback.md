---
gsd_debug_version: 1.0
slug: reresolve-loop-stops-playback
status: fix-applied-pending-device-verify
trigger: "Song stopped (playback pinned, never advances). Confirmed from the on-device action log: a tight infinite audio.error → reresolveCurrent loop on one track after a long background gap."
created: 2026-06-30
updated: 2026-06-30
---

# Debug: unbounded post-playback re-resolve loop pins playback ("song stopped")

## Evidence (from the user's action-log export — the diagnostic built in quick-260630-sgw)

- The log held 1549 entries; **1495 were `audio.error`**, almost all on one uid (`netease:19292984`),
  firing **~10–17/sec for 13+ seconds with ZERO `playing` in between** — a tight loop.
- Each error: `{"ev":"audio.error","d":{"uid":"netease:19292984","hasPlayed":true,"reresolve":true}}`.
- Lead-up: the track was backgrounded ~27 min (`visibility hidden:true` 14:34 → `hidden:false` 15:02),
  then `advance`→`retry-dead`→`play`→`resolve.ok (hasUrl:true)`→`audio.error (hasPlayed:true)`. The URL
  RE-RESOLVES fine (hasUrl:true) but the `<audio>` errors on it instantly — a dead/region-locked CDN URL
  after the long gap.

## Root cause (confirmed by code trace)

`src/lib/stores/player.svelte.ts` `error` listener, the post-playback branch (quick-260625-pzs-05):
`if (this.hasPlayedSinceSrc) { void this.reresolveCurrent(); return; }`.
- `reresolveCurrent()` re-resolves the SAME song and re-attaches the src — but it is a "seek-recovery
  re-attach" (D-14): it does NOT reset `hasPlayedSinceSrc` and does NOT bump `playGen`.
- So when the re-resolved URL is PERSISTENTLY dead, the new src errors instantly → `hasPlayedSinceSrc`
  is still true → `reresolveCurrent()` again → … unbounded loop. There is NO cap and NO backoff, and
  the branch `return`s BEFORE the `errorBurst` counter (whose absolute cap is itself commented out), so
  nothing ever advances. Playback is pinned (no audio, never moves on) = "song stopped."

This is a DISTINCT root cause from the background-autoadvance-stall fix (foreground resume of a track
stalled at 0:00). The long background gap is the common precondition (it staled the URL), but the
killer here is the re-resolve loop, not the initial-load autoplay gap.

## Fix applied

`player.svelte.ts` — bound the post-playback re-resolve:
- New `reresolveBurst` counter + `RERESOLVE_CAP = 3`.
- The `hasPlayedSinceSrc` error branch now increments `reresolveBurst`; it re-resolves in place only
  while `<= RERESOLVE_CAP` (transient mid-track stalls still recover), and past the cap it STOPS
  re-resolving, logs `reresolve.cap`, and FALLS THROUGH to the existing cross-source fallback +
  loop-guard so playback advances (never an infinite loop).
- `reresolveBurst` resets to 0 on a real `playing` (recovery — so transient stalls spread across a long
  track never accumulate to the cap) and at `play()` entry (each new track gets a fresh budget;
  `reresolveCurrent` does not go through `play()`, so the loop cannot reset its own budget).

## Verification

- 2 new regression tests in `player.svelte.test.ts` ("bounded post-playback re-resolve"): a
  persistently-erroring played track re-resolves at most RERESOLVE_CAP times then calls runFallback;
  a `playing` between errors refunds the budget so transient stalls re-resolve every time without
  hitting the cap.
- Player suite 161/161, full suite 994/994 (67 files), svelte-check 0/0.
- Device verify pending: reproduce the long-background → stale-URL case; confirm the track now advances
  (≤3 quick re-resolves then moves on) instead of pinning, and check the Activity log for a
  `reresolve.cap` entry followed by `fallback`/`advance`.

## Out of scope (noted)

- The absolute `errorBurst` loop-guard cap (player.svelte.ts ~1526) is COMMENTED OUT. The cross-source
  fallback's per-episode `attempted` set still bounds the 2-source ping-pong, but a 3+-source
  resolve-but-unplayable chain has no absolute backstop. Not the cause of THIS stop; left untouched to
  avoid reintroducing whatever false-stop it was disabled for. Candidate for a separate review.
