---
gsd_debug_version: 1.0
slug: stall-kills-healthy-tracks
status: resolved
trigger: "many songs got skipped but no cross marked on them in up next list, and a song is paused multiple times while playing. encounting many couldn't play thus skipped, i do not think those songs really fail."
created: 2026-09-12
updated: 2026-09-12
---

# Debug: a ~3.24s `stalled` timer executes HEALTHY tracks, and the skip leaves no ✗ mark

## Symptoms

- **Expected:** a track is skipped ONLY when it genuinely cannot play, and a skipped track shows the
  dimmed ✗ row in Up-Next so the user can see it and tap to retry.
- **Actual:** many playable songs are skipped; no ✗ appears on any of them; a song is paused
  repeatedly while playing. The user is confident these songs are not genuinely broken.
- **Platform:** Android Chrome / PWA, FOREGROUND (the capture is `hidden:false` throughout; the one
  `hidden:true` is at the very end).

## HARD EVIDENCE — on-device action log (2026-09-12)

### The kill threshold is a FIXED TIMER, not ten network failures

Every `media.stalled` in the capture, in order:

```
3243  3241  3242  3239  3246  3234  3239  3247  3258  3242   (ms since src.set)
```

Ten stalls spanning **24 ms**, across **five different sources** (qq, joox, jamendo, audius,
ytmusic). Independent upstream failures do not land inside a 24 ms band. Every one fires with
`rs:0 ns:2 buf:0` — readyState HAVE_NOTHING, networkState LOADING, zero bytes buffered.

### The threshold sits ~400 ms above normal first-byte on this device

The one track that survived, in the SAME capture:

| event | ms |
|---|---|
| `src.set` audius:j445o | 0 |
| `media.progress` | 2153 |
| `media.loadedmetadata` | 2768 |
| `media.canplay` | 2778 |
| **`playing`** | **2781** |

It beat the ~3,240 ms executioner by **459 ms**. Device first-byte was measured earlier in this
project at **1,791–2,904 ms** (see `resolved/slow-cold-start-first-playing.md` ROUND 3/4), while the
CDN itself answers in ~0.3 s — most of that is the phone's own network path. So the kill threshold
overlaps the NORMAL distribution: any track a few hundred ms slower than average is executed.

### The mechanism

`recoverLoadStall` (`src/lib/stores/player.svelte.ts:1350`) is bound to Chrome's NATIVE `stalled`
event (listeners ~:1331 and ~:1739). `stalled` means only "no data for ~3 s" — routine on a slow
link, NOT a track fault. The handler treats it as one:

1. first `stalled` → `stall.retry` → `reresolveCurrent()` (fresh url + re-attach)
2. second `stalled` → `stall.skip` → `strikeUnplayable` → `emitSkipNotice` → advance

Observed cascade, verbatim: `stall.retry` → `stall.skip` → `advance` → next track → `stall.retry` →
`stall.skip` → `advance` → … burning six tracks in ~60 s, several of which had `resolve.ok
hasUrl:true` moments earlier.

### Why NO ✗ appears

`stall.skip` calls `strikeUnplayable(uid)` ONCE. `STRIKE_CAP = 3` is required to promote a uid into
`unplayableUids`, and `unplayableUids` is what draws the dimmed ✗ row. So a stall-skipped track gets
1 strike, never reaches the cap, and is dropped **invisibly**. The capture ends with:

```
strike.clear-all  {reason: "foreground", n: 1}
```

ONE strike total across ~6 skips — then wiped on foreground. The user cannot see what was dropped or
retry it.

## Initial reading (to confirm/falsify — NOT yet a conclusion)

1. **The `stalled` path is a second, more aggressive recovery that undercuts the first.** A 15 s
   `STALL_TIMEOUT_MS` watchdog already exists for genuine load stalls. The `stalled` handler fires at
   ~3.2 s and pre-empts it. Question: should a FIRST `stalled` act at all, or require corroboration
   (no `media.progress` after a longer window, or a real `error` event)?
2. **`buf:0` + no prior `media.progress` is not proof of death** — on this device it is the normal
   pre-roll state for the first ~2–3 s.
3. **The skip/strike accounting is inconsistent with its own UI contract.** Either a stall-skip
   should strike hard enough to render the ✗, or it should not strike at all and should not skip.
   Currently it does the damaging half (drop the track) without the visible half (mark it).
4. **`pause deliberate:true` at t=250257667** — the user reports repeated pauses mid-playback. Check
   whether that is a real user pause or something asserting `deliberatePause` incorrectly.

## Prior art — read before hypothesizing

- `resolved/bg-lockscreen-stall-noskip.md` added the `document.hidden && !audibleThisHide` PARK guard
  to this exact function for the backgrounded case. That guard does NOT apply here (foreground), so
  the aggressive retry/skip path runs unguarded. The lesson from that session — that `stalled` is a
  platform state, not a fault — is the same lesson, now in a different context.
- `resolved/slow-cold-start-first-playing.md` holds the measured latency budget this bug collides
  with, plus the eight-commit cause chain already fixed.
- `resolved/playback-skip-and-autoplay.md` is the original "skipped too easily" session; STRIKE_CAP
  exists BECAUSE of it. Do not simply lower the cap without re-reading why it was raised.

## Constraints

- Sandbox CANNOT run Android. netease + qq Meting proxies are BLOCKED in-sandbox; **kuwo is currently
  DEAD upstream (526, broken TLS cert)**; Deezer works. Dev server 4321 (launch.json) or 5173 (bare
  `pnpm dev`) — probe, don't assume.
- Browser pane rAF is frozen — verify timing in vitest, never via animations.
- **Do NOT push.** main auto-deploys to production (openmusic.lol). Commit locally and ask.
- Gates: `pnpm check` + `pnpm test` (no linter). Baseline 2021 tests green.
- **Never weaken never-stop:** playback must still advance past genuinely dead tracks. Never STOP,
  always SKIP — but skip only REAL failures.
- CLAUDE.md now has a "Shared Primitives" table — import existing helpers, never re-inline a guard.

## Current Focus

- hypothesis: The `stalled`-driven `recoverLoadStall` path treats a routine ~3.2 s no-data window as a
  track fault, and on this device that window overlaps normal first-byte (1.8–2.9 s), so healthy
  tracks are retried then skipped. Separately, `stall.skip` strikes once against a `STRIKE_CAP` of 3,
  so the drop is invisible in Up-Next.
- next_action: Write the failing vitest (foreground `stalled` at rs:0 must NOT retry/skip), apply the
  two-line fix (gate the `stalled` listener on `document.hidden`; re-arm `armStall()` after a
  stall.retry), run `pnpm check` + `pnpm test`, commit locally.
- reasoning_checkpoint:
    hypothesis: "The `stalled` media-event listener (player.svelte.ts ~:1878) calls recoverLoadStall on
      the FIRST `stalled` in the FOREGROUND, where it was never needed — it was added as the
      BACKGROUND-reliable trigger because setTimeout is throttled in a hidden tab. Chrome fires
      `stalled` ONCE per load, ~3s after the last progress (none yet → ~3s after src.set), and on this
      device normal first-byte is 1.8–2.9s, so any healthy track a few hundred ms slow is retried
      (reresolveCurrent re-attaches src, DESTROYING the in-flight load) then skipped."
    confirming_evidence:
      - "Ten media.stalled in a 24ms band at ~3,240ms across five sources, all rs:0 ns:2 buf:0 —
        a fixed timer, not ten failures."
      - "Survivor hit `playing` at 2,781ms; device first-byte measured 1,791–2,904ms (slow-cold-start
        ROUND 3/4). Threshold overlaps the healthy distribution."
      - "Code read: listener is `if (!hasPlayedSinceSrc) recoverLoadStall()` with no hidden check;
        the round-2 PARK guard only covers hidden&&!audible; stallRetried is NOT reset by
        reresolveCurrent, so the re-attached src's own `stalled` at +3s is the skip."
      - "resolve.ok hasUrl:true logged moments before several of the stall-skipped tracks."
    falsification_test: "If the tracks were genuinely dead, `audio.error` would fire (dead URL → 4xx →
      error) and stall timings would scatter, not cluster in 24ms. If the 15s watchdog were the driver,
      stall.retry would land at ~15s, not ~3.2s."
    fix_rationale: "Foreground has an un-throttled 15s STALL_TIMEOUT_MS watchdog armed at every
      play() src-set — it already covers 'never gets bytes'. Gate the `stalled` listener on
      `document.hidden` so it is ONLY the bg trigger it was built to be (PARK guard and hidden+audible
      retry→skip untouched). Because reresolveCurrent deliberately arms no watchdog (D-14), re-arm
      armStall() in the retry branch so a foreground silent hang still completes retry→skip (never-
      stop intact) without depending on `stalled`."
    blind_spots: "Hidden+audible path still acts on the ~3s `stalled` (bounded to one hop by
      audibleThisHide); if bg first-byte is also ~3s that path can still execute a healthy track —
      device-only to observe, out of this capture's scope (foreground). Whether a foreground dead URL
      that neither errors nor loads within 15s+15s exists on device is untestable here."

- known_pattern_candidate: same class as `bg-lockscreen-stall-noskip` (platform state read as fault),
  different trigger context (foreground rather than hidden).

## Evidence

- timestamp: 2026-09-12 — On-device action log, Android Chrome/PWA, foreground. Ten `media.stalled`
  events within a 24 ms band (~3,240 ms) across five sources; one surviving track reached `playing`
  at 2,781 ms; `strike.clear-all {reason:"foreground", n:1}` after ~6 skips. Full tables above.

- timestamp: 2026-09-12 — Code read confirmed the mechanism. `stalled` listener (player.svelte.ts
  ~:1878) = `if (!hasPlayedSinceSrc) recoverLoadStall()` with NO `document.hidden` check; the round-2
  PARK guard inside recoverLoadStall only covers hidden&&!audibleThisHide, so foreground runs
  unguarded. `stallRetried` resets ONLY in play() (:3340) and on `playing` (:1807) — `reresolveCurrent`
  does not reset it and (per its D-14 note) arms NO watchdog. So: `stalled`@3.2s → retry → re-attached
  src's own `stalled`@+3.2s → skip. Matches the capture's retry→skip spacing exactly.
- timestamp: 2026-09-12 — Watchdog coverage check (does the fix lose anything?). `armStall()` is called
  at BOTH play() src-set points (:3138 blob, :3355 url) with STALL_TIMEOUT_MS=15000 and is not
  throttled in the foreground; `error` fires for a dead URL and calls disarmStall + its own ceiling/
  fallback. The ONLY gap after gating `stalled` to hidden: a foreground silent hang on the RETRIED src
  had no second signal (reresolveCurrent arms nothing) → added `this.armStall()` in the retry branch.
- timestamp: 2026-09-12 — TDD red: two new tests in the stall-watchdog suite FAILED under current code
  exactly as predicted — (1) fg `stalled` at rs:0 → `reresolveCurrent` called 1× (expected 0);
  (2) fg `stalled` after a watchdog retry → `play(next)` called (skip short-circuited the budget).
  Green after the fix: 265/265 in the file; full suite 2023/2023; svelte-check 0/0.
- timestamp: 2026-09-12 — `pause deliberate:true` at t=250257667: `deliberate:true` means
  `pauseAudio()` was called, i.e. an INTENTIONAL pause by one of: user tap (toggle :3775), Media
  Session `pause` action (:2230, lock-screen / headset / another app taking focus), sleep timer
  (:1639), offline gate (:4256), or a self-halt — `haltRunawayRecovery` (:3908, logs `recovery.halt`)
  / `tripLoopGuard` (:4153). NOT the stall path (stall.skip sets `playing=false` and advances; it
  never pauses). To attribute: read the 1–2 log lines immediately before each `pause deliberate:true`
  — `recovery.halt` / `src.redrive-brake` = self-halt; `visibility hidden:true` or nothing = OS/Media
  Session; `sleep.*` = timer. Separate defect if it is a self-halt; not addressed in this session.

## Eliminated

- hypothesis: "the skipped songs are genuinely unplayable" — CONTRADICTED. Several logged
  `resolve.ok hasUrl:true` immediately before being stalled out, the failures cluster in a 24 ms
  timing band rather than by source, and they span five independent upstreams at once.

## Resolution

root_cause: The `stalled` media-event listener in `Player.attach()` called `recoverLoadStall()` on the
  FIRST `stalled` in the FOREGROUND. It was added (bg-lockscreen-stall-noskip) as the BACKGROUND-
  reliable trigger because setTimeout is throttled in a hidden tab, but nothing scoped it to hidden.
  Chrome fires `stalled` once per load ~3s after the last progress (≈3.2s after src.set with no bytes)
  and this device's normal first-byte is 1.8–2.9s, so healthy-but-slow tracks were retried (the
  re-attach destroys the in-flight load) and then skipped by the re-attached src's own `stalled`.
  The skip struck once against STRIKE_CAP=3, so nothing was marked ✗ and `clearAllStrikes('foreground')`
  erased the evidence.
fix: `src/lib/stores/player.svelte.ts` — (1) `stalled` listener: `if (typeof document === 'undefined'
  || !document.hidden) return;` — foreground defers to the un-throttled 15s STALL_TIMEOUT_MS watchdog
  and the `error` path; hidden behaviour (PARK guard, audibleThisHide one-hop bound) unchanged.
  (2) `recoverLoadStall` retry branch: `this.armStall()` after `reresolveCurrent()` so a foreground
  silent hang on the retried src still completes retry→skip (never-stop intact) without `stalled`.
  (3) Decision-ref comment on the skip branch: one strike + emitSkipNotice is the live-skip contract
  (same as the error ceiling); ✗ stays reserved for STRIKE_CAP confirmed failures (31-D-16).
verification: TDD — `player.svelte.test.ts` stall-watchdog suite: "FOREGROUND: a pre-first-byte
  `stalled` (rs:0) is NOT a fault…" and "FOREGROUND: a genuinely dead src … retry → skip on the 15s
  watchdog alone" both RED before the fix, GREEN after. `pnpm check` 0 errors 0 warnings. `pnpm test`
  110 files, 2023 passed (baseline 2021 + 2). All bg-lockscreen-stall-noskip round-2 tests still pass.
  DEVICE-ONLY (outstanding, not claimed): on the Android phone, foreground, play ~10 songs from
  Up-Next and open Settings → Activity log. Expect `media.stalled` lines to still appear (~3.2s,
  observability) but NO `stall.retry` / `stall.skip` following them in the foreground; a healthy
  track shows `media.progress` → `playing` after its `media.stalled`. A genuinely dead URL should
  show `audio.error` → skip, or `stall.retry` at ~15s then `stall.skip` at ~30s. Lock the screen
  mid-queue and confirm the round-2 shape (no cascade while hidden+silent; `stall.fg-recheck` on
  unlock) is unchanged.
files_changed:
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
