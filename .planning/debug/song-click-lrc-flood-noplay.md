---
gsd_debug_version: 1.0
slug: song-click-lrc-flood-noplay
status: resolved
trigger: "Clicking a song fails to play — nowbar stuck on the loading line, won't expand. /api/netease/lrc?id=299942 floods the network and /api/netease/url?id=299942 media requests are all (canceled) — a resolve/play loop on ONE netease track (王菲 原谅自己, id 299942). ~1739 requests. Worked a few days ago; recent fixes (this session's governor/breaker/systemic-STOP/negative-cache/deezer-routing, AND the committed bg-resolve-gap-stall series f7c2580/c902264/110fb0b/24eaa8a) suspected. User: audit the play mechanism (believes it's over-complicated → causes the storms), find ROOT CAUSE not a band-aid, confirm ONE in-flight call per identical endpoint, confirm a clicked song plays. Open to reverting."
created: 2026-07-09
updated: 2026-07-09
---

# Debug: clicking a song → resolve/play loop (lrc flood + canceled audio), nowbar stuck loading

## Symptoms (user, with Chrome Network capture)

- Click a song → nowbar shows the loading line, never expands, never plays.
- `/api/netease/lrc?id=299942` FLOODS (many pending) — the CURRENT clicked track re-resolved in a loop.
- `/api/netease/url?id=299942` media requests all `(canceled)` — `<audio>.src` re-set in a tight loop.
- ~1739 requests. "keep it in api loop hell." Worked a few days ago → a REGRESSION.

## Early code facts

- netease `resolve()` (src/lib/sources/netease.ts): sets `track.audioUrl = /api/netease/url?id=<id>`
  (consumed directly as `<audio>.src` → the canceled "media" rows) and fetches the LRC via a RAW
  `fetch(track.lrcUrl)` (NOT apiFetch → UNGOVERNED, no dedup — floods on any resolve loop). Sets
  `track.detailsLoaded = true` even on an lrc miss (line 127), so `ensureTrackDetails` short-circuits a
  already-resolved track object → the flood is the SAME song re-resolved via fresh stubs or a reresolve
  loop, not one object re-fetched.
- All this session's fixes are UNCOMMITTED (api-base, deezer, cover-backfill, player + their tests) →
  a `git stash` bisect cleanly tests whether they are the regression. "Worked a few days ago" may
  predate the committed bg-resolve-gap-stall series too — test committed HEAD if stash doesn't fix it.

## Evidence

- timestamp: 2026-07-09
  checked: live preview (:4321, current working-tree code) — searched "王菲", watched the network.
  found: search WORKS (fan-out returned 王菲 results; ~48 `/api/deezer/search` cover-backfill calls =
    ONE normal pass, NO infinite loop). Could NOT reproduce the netease lrc/url FLOOD locally. The
    flood is condition-dependent: it needs the clicked song's stream to actually FAIL to load (netease
    region-lock / slow-CDN for the user, or a stale persisted current), which then trips the never-stop
    recovery machinery. My machine's netease evidently loads → no loop here.
  implication: this is NOT a governor/apiFetch bug per se — neither symptom even goes THROUGH the
    governor: `<audio>.src = /api/netease/url?id=` is loaded by the audio element (bypasses apiFetch),
    and netease's LRC uses a RAW `fetch(track.lrcUrl)` (bypasses apiFetch). So the dedup/breaker cannot
    touch either. The flood is a genuine RESOLVE/PLAY LOOP amplified by ungoverned raw-fetch.

- timestamp: 2026-07-09
  checked: play-path complexity audit — player.svelte.ts is 3270 lines; ~10 `audio.src =` set points;
    the re-drive/recovery entry points are: play(), reresolveCurrent (:507), runFallback/tryFallback
    (:2969), prefetchNext (:1949, fired EAGERLY on every play() at :2521) + its probePlayable (:2158,
    which sets `a.src=url` on THROWAWAY Audio elements = MORE canceled media rows) + warmAfter (:2087),
    ensureAhead/regenerate (:1849/:2769), scheduleRetryResolve (re-arms prefetchNext), maybeRetryAutoplay,
    armStall (15s → runFallback), background keep-alive, PLUS this session's governor/breaker/failoverSkips.
  found: NO single authority owns "this track failed." A failing stream is acted on by SEVERAL
    independent mechanisms at once (in-place reresolve + cross-source fallback + prefetch-probe retry +
    stall watchdog), each of which RE-DRIVES `audio.src` and/or RE-RESOLVES (→ raw-fetch lrc). They
    compose and re-arm faster than they converge → the "api loop hell" the user describes.
  implication: the ROOT CAUSE CLASS is over-composition of never-stop recovery, not one bug. The
    lrc/url flood is the observable of that composition churning on a track that won't load.

## Eliminated

- hypothesis: This session's governor / circuit-breaker / systemic-STOP / dedup broke the play path.
  evidence: the two flooding endpoints BYPASS apiFetch entirely — `<audio>.src` loads `/api/netease/url`
    directly (audio element, not apiFetch) and netease LRC uses raw `fetch()`. The governor never sees
    them, so it can neither cause nor dedup the flood. (The governor CAN starve apiFetch-routed resolves
    of OTHER sources via its FIFO, but netease resolve constructs its url + raw-fetches lrc, so netease
    click is not governor-starved.) Not the direct cause of THIS netease loop.
  timestamp: 2026-07-09

## Root Cause (CONFIRMED)

The single app-wide `<audio>` mount `$effect` in `src/routes/+layout.svelte` ran `player.attach()` +
`player.restore()` INSIDE the effect's tracking scope. `restore()` synchronously WRITES reactive
`$state` — `this.queue`, `this.current`, `this.resolvedCover`, `this.loading` — and commit **26e413a**
("bind NowPlaying hero cover to the shared reactive cover cache") ADDED the `this.resolvedCover = …` +
`this.syncMetadata()` writes to `restore()`. Because the effect READ that state (via the player calls)
and then MUTATED it, the effect SELF-INVALIDATED and re-ran `restore()` in a loop:
  - each `restore()` re-set `audio.src` to `/api/netease/url?id=299942` → the `(canceled)` media rows
    (the element cancels the prior load before it can `error`, so the audio.error ceiling never engaged);
  - each `restore()` re-ran `ensureTrackDetails` → netease resolve → re-fetched the lrc (raw `fetch`,
    ungoverned) → the `/api/netease/lrc?id=299942` FLOOD;
  - `this.loading` was pinned `true` (never cleared between re-entries) → nowbar stuck on the loading
    line, never expands.
The persisted "current" was `netease:299942`, which is why that EXACT id flooded. The
"`updated at … set queue … set current … Player.restore … $effect (+layout.svelte:49)`" console errors
(dismissed in the prior api-storm session as "pre-existing dev noise") were precisely this self-loop —
Svelte's effect-reentry warning. This is a REGRESSION from the recent series (26e413a), matching the
user's "worked a few days ago."

## Fix

1. **ROOT FIX — `src/routes/+layout.svelte`:** wrap `attach()` + `restore()` in Svelte's `untrack()`
   so the mount effect runs the one-time setup WITHOUT tracking player `$state`. The effect now fires
   once per `<audio>` mount (its only real dep, `audioEl`, is read outside untrack) and never re-runs
   when restore mutates state → no self-invalidation, no restore loop.
2. **SINGLE AUDIO.SRC AUTHORITY (defense + diagnostic) — `player.svelte.ts` `driveSrc()`:** all
   playback src attaches (play(), reresolveCurrent) route through ONE braked setter. A rapid same-uid
   re-drive with no `playing` between (any future re-drive loop the error-ceiling can't catch, since
   `(canceled)` ≠ `error`) trips → `haltRunawayRecovery()` (pause + sticky Retry) and logs
   `src.redrive-brake` with the culprit uid. Distinct uids (normal fast-skipping) never trip it.
3. **SIMPLIFICATION — removed the eager prefetch-probe-on-every-play** (quick-260627-huo). prefetch now
   runs ONLY via the timeupdate gate (~5s into REAL playback), so a track that never starts (the
   failure case) never triggers the speculative probe/resolve walk that fed the storms.

## Verification

- `pnpm check`: 0/0 (4298 files). `pnpm test`: 69 files, **1085** pass (rewrote 2 HUO eager-prefetch
  tests → timeupdate-gated behavior; added 3 driveSrc brake tests).
- LIVE (dev :4321): seeded a persisted `netease:299942` current, reloaded → `restore()` fired.
  Result: **0** `/api/netease/lrc` + **0** `/api/netease/url` calls (vs ~1739 before), `player.loading`
  = **false** (not stuck), `current` restored correctly, and **NO console errors** (the `updated at`
  self-loop is gone). Root cause resolved.

## Files changed

- src/routes/+layout.svelte — untrack() the mount attach()+restore() (ROOT FIX).
- src/lib/stores/player.svelte.ts — single braked audio.src authority (driveSrc) + removed the eager
  prefetch-probe-on-every-play + brake resets on `playing`/recoverFromStop.
- src/lib/stores/player.svelte.test.ts — timeupdate-gated prefetch tests + driveSrc brake tests.

## Current Focus

- hypothesis: RESOLVED — the +layout mount `$effect` self-invalidated because `restore()` mutates
  tracked `$state` (worsened by 26e413a adding resolvedCover/syncMetadata writes), looping restore →
  audio.src re-set (canceled media) + lrc re-fetch flood + loading pinned. Fixed with `untrack()`.
- test: (done) seeded netease:299942 → reload → 0 flood, loading:false, no `updated at` errors.
- next_action: none — verified. Optional follow-ups: route netease lrc through apiFetch; the genuine
  play-path over-complication (reresolve + fallback + stall + prefetch) still exists but is now bounded
  by the driveSrc single authority.
- reasoning_checkpoint:
- tdd_checkpoint:
