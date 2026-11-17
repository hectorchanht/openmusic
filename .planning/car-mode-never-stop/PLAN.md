# Car Mode + Never-Stop Engine + Double-Tap Random — GSD Plan

Status: PLAN stage (brief confirmed by Hector 2026-11-16, grill Q1–Q15 all yes)
Repo: hectorchanht/openmusic, remote main head af6e0459 at plan time.
Work copy: ~/workspace/openmusic-supporters (NOT a git repo — execute stage must
tarball-sync from remote head before editing, per standing sync rule, and push
via the Git Data API with this plan file included).

Governing skills: GSD (this plan = plan stage), CodeGraph for own code,
Karpathy Guidelines for implementation, Impeccable (operate / distill /
harden / adapt) for the Car Mode surface + audit before delivery,
Context7 for any external lib docs if needed.

## Goal

1. **Never-Stop Engine (GLOBAL, not Car-Mode-only)** — playback never stops
   because sources fail. SYSTEMIC_SKIP_CAP=5 stops being a stop and becomes
   the trigger for a fallback interlude.
2. **Double-Tap Random Discovery (GLOBAL)** — double-tap on cover art plays a
   discovery random song (new genre, playful + useful everywhere).
3. **Car Mode UI** — a ~2x Now Bar height (~144px) minimal control panel for
   split-screen use under a map app; no bottom nav; entered manually from a
   button left of the home refresh button, shown/hidden by a Settings toggle
   (default hide). Auto-launch is the user's phone Routine (Bluetooth), NOT
   the app's job.

## Settled decisions (grill Q1–Q15, all confirmed)

- Q1 Fallback chain: streaming queue → same-song downloaded version →
  Downloads shuffle → Cached random. On Car Mode entry, pre-build the buffer.
- Q2 Car Mode = UI + playback engine together (never-stop on, pre-buffer on,
  bottom nav hidden).
- Q3 Double-tap random = discovery pool, avoids recent genres/artists.
  (Later corrected by Hector: double-tap is GLOBAL, Car Mode only inherits.)
- Q4 Car panel controls = exactly 5: Prev / Play-Pause / Next / Like /
  Download. No volume (car/phone hardware), no queue, no search.
- Q5 Entry is manual only; Bluetooth automation belongs to the user's
  Routine. Entry button left of the home refresh (RotateCw) button;
  Settings toggle `showCarModeButton`, default OFF (hide).
- Q6 Double-tap zone = cover art ONLY (Now Bar cover + Now Playing cover),
  so single-tap expand keeps zero delay and buttons are unaffected.
  Feedback: haptic + small toast naming the new genre + cover animation.
- Q7 Car buffer quality capped at 320K even if the user setting is FLAC
  (car Bluetooth + road noise; 3–4x less data, faster buffer). Normal mode
  keeps the user's quality setting.
- Q8 In Car Mode the skip cap is an escape hatch, not a stop (now global
  per Q9).
- Q9 GLOBAL: cap-stop is retired everywhere. Normal mode reports the
  fallback after the session; Car Mode is fully silent/seamless.
- Q10 The cap limits PROBING, not playback: after fallback engages, at most
  one revival probe per Downloaded song played; source cooldown grows
  exponentially. Playback itself is uncapped.
- Q11 Incidents are logged silently during playback and reported once after
  the session (when fallback started, which sources were marked, when they
  recovered); also fed to the source-health tracking. Never interrupt.
- Q12 Fallback is an INTERLUDE: queue position + Up Next intent are saved
  on entry and restored on revival, taking effect at the next track
  boundary (never cut the playing song). Songs that failed are skipped for
  this session only, not permanently banned.
- Q13 Fallback pool rotation: least-recently-played first, no repeat until
  the pool is exhausted; if the pool is small, mix in Cached songs.
  Repeats beat silence.
- Q14 Honest physical limit: with zero playable assets (no Downloads, no
  Cache, no network), repeat the last byte-buffered song if one exists;
  otherwise enter a retrying state probing every 60s that needs no tap.
- Q15 Adaptive pre-buffer threshold = DURATION, not count: if total
  Downloads duration >= 30 min, that is enough safety net — do NOT
  pre-buffer 10 streaming songs. If under 30 min, pre-buffer (320K) only
  enough to top the local pool up to ~30 min. Fallback pool = ALL
  Downloads (downloaded = user-endorsed).

Safety rationale (Hector): a sudden stop while the driver is immersed in
listening makes the driver reach for the phone — that is the accident risk.
Data cost of buffering is accepted; silence is the failure, a different
song is not.

## Codebase findings (verified at plan time, supporters tree)

- Player: `src/lib/stores/player.svelte.ts` (~5,866 lines).
  - `SYSTEMIC_SKIP_CAP = 5` at line 297; `failoverSkips` counter; a real
    `playing` resets it (line ~2623). Two trip sites (~2880, ~5633) call
    `haltRunawayRecovery()` (~5658): pauses audio, aborts prefetch,
    cancels retry resolves, shows sticky Retry notice
    (`toast.playbackStopped`); `recoverFromStop()` is the manual Retry.
  - The cap's documented original fear (in-code comment, debug-nowbar-
    frozen-audius-spam): under a systemic outage every track fails, the
    never-stop chain keeps resolving + auto-growing the queue
    (buildSimilarQueue = 8x searchAll) + prefetching, firing /api bursts
    until the browser connection pool saturates and the app freezes.
    => The replacement MUST keep bounding network churn. Local-file
    fallback playback fires no /api bursts, so it does not reintroduce
    the freeze — as long as revival probing stays budgeted (Q10).
  - Rapid-error brake (RAPID_ERROR_WINDOW_MS 400 / RAPID_ERROR_CAP 3) is a
    separate single-track guard — untouched by this plan.
  - Prefetch: idle-armed single-next byte-buffer; PREFETCH_MAX_CANDIDATES
    = 4 walk; probe timeout 1500ms. Pre-buffer work extends this seam.
- Health gates: `src/lib/services/source-health.ts` `createHealthGate`
  (threshold 3, 60s window, ONE probe after window, recordOk = instant
  recovery). Per-source instances exist (kuwo/netease/joox/kugou/migu/
  gdnetease/fivesing/...). Resolve legs currently record but do not gate.
  => Source marking/cooldown for the fallback engine reuses this factory
  and its semantics instead of inventing a second breaker.
- Downloads: `src/lib/stores/library.svelte.ts` — `downloads: Track[]`
  persisted (localStorage openmusic:library:v1); offline playback already
  works (download-blob driveSrc, adoptDownloadedCurrent). Track durations
  are available for the Q15 30-minute calculation (verify field at
  execute time; fall back to count x avg if a track lacks duration).
- Now Bar: `src/lib/components/Nowbar.svelte` (~833 lines) — `.np-open`
  button carries the coverSwipe action and the cover/title; Now Playing
  cover is in `src/lib/components/NowPlaying.svelte` (~1,758 lines).
  Double-tap hooks onto the cover element inside these, NOT the whole bar.
- Home refresh button: `src/routes/(app)/+page.svelte` line ~1223,
  RotateCw button (class `more`, onclick refresh). Car Mode entry button
  goes immediately LEFT of it.
- Settings: `src/lib/stores/settings.svelte.ts` Settings class + persist
  pattern for boolean toggles — add `showCarModeButton` (default false)
  and the Car Mode settings row in the Settings page.
- Bottom nav lives in the (app) layout (`src/routes/(app)/+layout.svelte`
  + library-tabs nav helpers) — Car Mode hides it via a player/UI state
  flag read by the layout.
- Tests: `src/lib/stores/player.svelte.test.ts` encodes the OLD cap-stop
  behaviour (e.g. tests near lines 2774, 2984, 6106, 7618 expect halt at
  the cap). These tests must be rewritten to the new spec deliberately —
  they are the spec change made visible, not regressions.

## House conventions for execute stage (repo AGENTS.md)

- Extract the fallback-pool / probe-budget / rotation logic as PURE
  functions in a new service (`src/lib/services/never-stop.ts`), node-
  testable; `player.svelte.ts` thin-calls it (the repo's standing answer
  to the player god-object — do not grow it with inline logic).
- Non-reactive counters/budgets are PLAIN class fields, not `$state`.
- Thread generation guards (playGen idiom) through every new async path.
- New user-visible strings go through i18n TranslationKeys (en is the
  reference; locale files use double quotes; key-set parity is tested).
- Load-bearing choices get decision-ref comments in code, per house style.
- Quality gates: `pnpm check` clean in touched files, `pnpm test` at the
  pre-existing-fail baseline.

## Execution phases

### Phase 1 — Never-Stop Engine (global)
- Replace both `haltRunawayRecovery()` trip sites: on cap, enter Fallback
  Interlude instead of stopping. Keep ALL of halt's network-churn cuts
  (abort prefetch walk, cancel pending re-resolves, stop queue auto-grow)
  — they become the probing budget, not a playback stop.
- Fallback pool builder: Downloads (least-recently-played rotation, from
  play history) + Cached songs when the pool is small; play from local
  files only. Save queue pointer + Up Next intent on entry.
- Source marking: per-source fail classification — song-level fail skips
  the song only; source-level fails (error/timeout/dry) feed the existing
  health-gate factory on the resolve leg so a marked source is skipped
  for its cooldown window.
- Revival probe: one probe per interlude song boundary; on success,
  restore the saved queue at the next track boundary; on fail, extend
  cooldown (exponential, capped ~15 min) and play the next interlude song.
- Zero-asset path (Q14): repeat last byte-buffered track if present, else
  retrying state with 60s probe timer, no user action required; in
  normal mode this state shows a quiet non-sticky indicator.
- Incident log: in-memory + persisted summary (start time, sources
  marked, recovery time, interlude count); post-session one-time notice
  in normal mode; nothing shown in Car Mode.
- Update the cap-stop tests to the new behaviour; add tests: cap →
  interlude (no pause), probe budget (<=1 probe per interlude track),
  queue restore at boundary, cooldown extension, zero-asset retry state.

### Phase 2 — Adaptive Pre-Buffer
- Compute local pool duration from library.downloads (+ cached audio).
- Trigger points: Car Mode entry, and first fallback-interlude entry in
  normal mode. If pool < 30 min, buffer streaming queue tracks ahead
  (rolling: keep topping up as tracks play) at 320K cap, into the audio
  cache (NOT the Downloads library), sequential/low-concurrency so it
  never competes with the playing track or the map app; evict on Car
  Mode exit / after play. If pool >= 30 min, buffer only the immediate
  next track (existing prefetch behaviour).
- Data guardrail: buffered bytes are tracks the user would stream anyway;
  worst-case waste = one buffer set on early exit (~80–100MB at 320K).

### Phase 3 — Double-Tap Random Discovery (global)
- Double-tap detector on cover elements only (Nowbar + NowPlaying),
  coexisting with coverSwipe (tap vs swipe disambiguation) and with
  single-tap expand (no added delay: detector lives on the cover, expand
  lives elsewhere).
- Discovery pick: outside the current genre and recent artists/genres
  (history-aware), resolved through the normal artist/quality gates
  (original artist rule still applies — discovery never means covers).
- Feedback: haptics (existing Capacitor haptics setting), cover flip/
  glow animation honouring reduced-motion rules (light/colour channel
  stays alive), toast naming the genre landed on.
- In fallback interlude, double-tap still works against the local pool
  if sources are down (random local discovery), labelled as such.

### Phase 4 — Car Mode UI (Impeccable: operate / distill / harden / adapt)
- Entry button (car icon, lucide) left of the home refresh button,
  rendered only when settings.showCarModeButton is ON (default OFF);
  Settings toggle row added.
- CarMode panel component, ~144px tall (2x Now Bar), designed for the
  split-screen bottom pane (short-height container): top progress sliver;
  row 1: 56px cover, title 19px bold, artist 15px, reliability dot
  (green = local/downloaded, amber = streaming) instead of text badges;
  row 2: 5 controls >=56px, Play and Next largest. No bottom nav, no
  lyrics, no queue/search chrome. Sunlight-readable contrast, no grey
  small text. Exit = a single large close affordance (and exiting
  restores nav + normal layout; playback engine state persists).
- Double-tap cover works here too (inherits Phase 3).
- Impeccable audit on the built surface before delivery; fix verified
  findings in the same push. Desktop + mobile (339px width included)
  and short-height split-screen checks.

### Phase 5 — Verify + Ship
- Full test suite at the pre-existing-fail baseline, zero regressions;
  svelte-check clean in touched files.
- Failure-injection verification: (a) block a source / simulate 5+
  consecutive resolve fails with network up — playback must interlude,
  not stop; (b) airplane mode with Downloads present — seamless local
  playback; (c) airplane mode with no Downloads/Cache — retrying state,
  auto-recovers when network returns, no tap needed.
- Live-verify on the deployed site + device check in the real routine
  (Bluetooth → Maps + OpenMusic split screen) before calling it done.
- Ship log appended here; memory updated.

## Risks and how the plan answers them

- Runaway /api churn + app freeze (the cap's original reason): probing
  is budgeted and local playback is network-free (Q10, Phase 1).
- Hammering a dead source into a ban: health-gate cooldown + exponential
  extension; one probe per window per source.
- Overnight battery/data drain: probing is near-zero cost in interlude;
  playback from local files is the same cost as normal listening. No
  time cap on playback (Q10) — the user can always pause manually.
- Masked bugs: incident log + post-session report + health tracking
  (Q11).
- Queue/history pollution: interlude is bracketed; queue intent saved
  and restored; interlude plays are real plays in history (honest), but
  do not rebuild the Up Next tail.
- Small-pool fatigue: least-recently-played rotation + Cached mixing
  (Q13).
- Quality/artist doctrine: fallback pool is the user's own downloaded
  files and normally-gated discovery — no cover/wrong-artist relaxation
  anywhere.

## Ship log

- Phase 1 (Never-Stop Engine, global) — EXECUTED 2026-11-16 (quick-261116-nstop):
  pure service `src/lib/services/never-stop.ts` (pool ordering, ProbeBudget,
  SourceCooldowns) + player interlude wiring at both SYSTEMIC_SKIP_CAP trip
  sites; haltRunawayRecovery kept for the same-uid re-drive storm guard and
  the dry-grow stop. Zero-asset retrying state (60s auto-probe) + post-recovery
  summary notice (new i18n keys toast.playbackRecovered / toast.playbackRetrying
  in all 15 locales, new 'never-stop' notice kind in the layout toast host).
  Scoped decision: resolve-leg adapter gating NOT wired — the per-source
  cooldown lives inside never-stop.ts (SourceCooldowns, createHealthGate
  semantics) and is consulted by the interlude's probe scheduler in the
  player; attempted sources are marked at interlude entry from the fallback
  episode set. Tests: player suite 404 → 408 (3 cap-STOP tests rewritten, 4
  interlude tests added), never-stop service 12 tests; full suite at the
  pre-existing-fail baseline (8: track-menu-order 5 + settings-persist 3;
  device-filename's timing probe flaky under full-suite load, passes
  standalone); svelte-check 0 errors, no findings in touched files.
  Playback behaviour live/device verification remains Phase 5 work.

## Out of scope

- Bluetooth auto-entry / auto-launch (user's phone Routine owns it).
- Android Auto / Apple CarPlay surfaces.
- Voice control.
- Any change to the rapid-error single-track brake or to source
  adoption ranking.
