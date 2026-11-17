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
- Phase 2 (Adaptive Pre-Buffer) — EXECUTED 2026-11-16 (quick-261116-prebuf):
  pure helpers appended to `src/lib/services/never-stop.ts` (measureLocalPool
  — Downloads + byte-present Cached, duration-less tracks estimated at the
  pool's own average, NS_DEFAULT_TRACK_SEC 210 when nothing is known;
  planBufferTopUp; bufferTierFor; planBufferEvictions) + player wiring:
  a persisted car-buffer registry (localStorage openmusic:carbuffer:v1),
  an idle-gated strictly-sequential walk (onApiPipelineIdle before every
  track, 2 consecutive failures end the walk) that resolves upcoming queue
  tracks tier-capped per call and byte-buffers them into blobStore as
  CACHE, and LRU eviction down to the target that unregisters — never
  deletes — entries whose uid became a real Download. Triggers: first
  Fallback Interlude entry (armCarBuffer() inside enterFallbackInterlude)
  + the public player.armCarBuffer() entry point for Phase 4; rolling
  re-top-up kicked at every real `playing`. Buffered tracks are
  offline-playable via a new play() branch (blobStore read under the
  track's own uid, 'prebuffer-blob' provenance so corrupt bytes are
  discarded + unregistered without touching library state) and join the
  interlude pool as cached filler (buildInterludePool candidate list now
  leads with registry uids). Q15 threshold as corrected by Hector:
  NS_POOL_TARGET_SEC = 30 min (was 60 in the original plan text) — at or
  above it the walk is a no-op (gate-tested: zero resolves/fetches).
  Q7 achieved for real: bufferTierFor maps lossless/auto → '320' (an
  explicit '128' choice is respected), threaded through
  ensureTrackDetails' per-call quality parameter — the same WR-07 seam
  probeDownload's `want` tier uses; test asserts every walk resolve
  carried tier '320' under a lossless setting. Tests: never-stop service
  12 → 27, player suite 408 → 414 (6 CAR-BUFFER tests: gate, walk+tier,
  pool-join, offline play, eviction, interlude trigger); full suite at
  the pre-existing-fail baseline (8: track-menu-order 5 +
  settings-persist 3), zero regressions; svelte-check 0 errors / 18
  warnings (fresh-head baseline, none in touched files). Playback
  behaviour live/device verification remains Phase 5 work.
- Phase 3 (Double-Tap Random Discovery, global) — EXECUTED 2026-11-16
  (quick-261116-dtap): pure tap-timing gate `src/lib/gestures/tapGate.ts`
  (260ms window, inclusive edge, skew-safe) + `use:doubleTap` action
  (`src/lib/actions/doubleTap.ts`) mounted on the COVER element only —
  Nowbar `.np-art` and Now Playing `.cover-cell.cur`. The action claims
  cover clicks in the capture phase and stopPropagation()s them before the
  ancestor's tap handler (.np-open expand / .cover collapse): a single tap
  runs the host action deferred by ≤260ms — paid ONLY by cover taps, title/
  text taps and keyboard (whose event path never crosses the cover child)
  stay instant — and a second tap inside the window cancels it and dives.
  coverSwipe coexistence is structural: its committed-swipe click
  suppressor sits on the ancestor and eats post-swipe clicks before the
  gate sees them; longpress's document-capture suppressor likewise.
  Discovery: `src/lib/services/random-discovery.ts` — genre signal is
  Last.fm tags (enrichTrack + up to 5 recent distinct artists' enrichArtist,
  6h-cached, never-throw) mapped onto the chart-genre vocabulary by a small
  exact alias table (regional pops also block the overlapping 'asian'
  pool; a bare 'pop'/'chinese' tag blocks nothing); the dive draws a random
  unblocked genre pool (genreChart, the home shelves' own pools), filters
  out the last 20 history entries' artists (normField-folded) and heard
  songs (matchKey), and plays through player.tapStub('home-discovery') —
  the home discovery path verbatim, original-artist gate and tap Up-Next
  setting included. Dry pools fall back to buildDiversePicks, then to the
  home unplayable toast — never silent. During a Phase 1 interlude the
  dive draws from the local pool via the new player seam
  (playRandomPoolTrack + inInterlude/inRetrying getters; the pick is pool
  by construction so the interlude survives, registered like a boundary
  advance) and toasts as local; in the zero-asset retrying state it spends
  an immediate revival probe instead. Feedback: haptic tick() (the
  settings-gated leaf), `.dtap-pulse` in app.css (glow = light channel,
  re-asserted under data-reduce-motion per the marquee precedent; flip =
  positional, gated to no-preference + no app reduce flag), and a toast
  naming the genre (new i18n keys toast.dtapGenre / toast.dtapLocal /
  toast.dtapAny in all 15 locales; genre names reuse CHART_GENRE_LABEL).
  No settings toggle — the gesture ships always-on per the confirmed
  brief. Tests: tapGate 10 + doubleTap action 8 + random-discovery 12 new,
  player suite 414 → 415 (interlude dive test); full suite 5477 passed /
  8 failed = the pre-existing baseline (track-menu-order 5 +
  settings-persist 3, untouched files), zero regressions; svelte-check
  0 errors / 18 warnings (baseline, none in touched files). Playback
  behaviour live/device verification remains Phase 5 work.
- Phase 4 (Car Mode UI) — EXECUTED 2026-11-16 (quick-261116-carmode):
  `settings.showCarModeButton` (GENERAL_DEFAULTS, default FALSE per Q5) wired
  through all four settings touchpoints (field / load with the explicit-boolean
  guard / save / resetGeneral) + a SettingToggle row on the Settings index
  (Car icon, beside Haptics) + 3 new i18n keys (home.carMode,
  settings.carModeButton, settings.carModeButtonDesc) in all 15 locales.
  Entry: a Car icon button immediately LEFT of the home Randomize/refresh
  button, rendered only when the toggle is on; it calls carMode.enter().
  State: new leaf-ish runes store `src/lib/stores/car-mode.svelte.ts` — one
  boolean; enter() arms the Phase 2 buffer (player.armCarBuffer), exit()
  disarms it; playback is never touched by the mode. Takeover in the (app)
  layout: while active, <main> and the tabbar/rail get display:none via a
  car-off class (absence without unmounting — page state + scroll survive),
  Nowbar/NowPlaying are {#if}-gated off, and the fixed full-viewport
  `src/lib/components/CarMode.svelte` (z 60; the z-90 toast host stays above
  it) owns the screen. Panel: progress sliver (Nowbar idiom), 56px cover
  carrying the Phase 3 doubleTap (single tap is a deliberate no-op — no
  expand exists here), title 19px bold / artist 15px in full-contrast text,
  a colour-only reliability dot (green local / amber streaming — the pure
  decision lives in `src/lib/services/car-mode.ts` over the player's NEW
  reactive provenance mirror `player.currentLocal`, written by a setSrcKind()
  setter that all five lastSrcKind sites now route through), and exactly 5
  controls >=56px (Prev / Play / Next / Like via library.toggleLike /
  Download via the shared DownloadControl stretched to fill its grid cell).
  Exit is one 52x56 X button; exiting restores the shell exactly. Short-pane
  compaction under max-height:180px keeps every control on-screen at ~150px.
  Impeccable (source-mode detector + operate/distill review): FIXED in this
  push — radii moved onto the documented scale (var(--radius-md)), the Play
  hero switched from white-on-accent (~2.6:1, fails sunlight) to NowPlaying's
  white-disc/black-glyph treatment with the light-theme inversion,
  safe-area-inset-top on the panel, the short-height compaction above.
  DISMISSED as intentional — the fallback-cover gradient literals (verbatim
  reuse of Nowbar's incumbent gradient), the 19px title (pinned by this
  plan's spec), the dot's green/amber literals and the play disc's #fff/#000
  (new fixed semantics the user-variable accent token cannot carry; mirrors
  NowPlaying's literal disc). Tests: car-mode service 7 new +
  settings-persist 5 new (showCarModeButton round-trip; the file's baseline
  failures at this head are the 3 pre-existing showSourceTag cases plus the
  home-layout-switch case srchrank's migration broke — both reproduce on a
  pristine head tree); full suite at the pre-existing baseline, zero new
  failures. svelte-check 0 errors / 18 warnings (baseline, none in touched
  files). Built on head 65cd94e6 (two sibling quick tasks landed mid-phase —
  the nav re-tap pair and srchrank; the layout edits were re-applied onto
  the newer layout and the settings/defaults hunks re-applied onto
  srchrank's versions, diffs verified disjoint — no sibling work clobbered).
  Device / split-screen verification remains Phase 5 work.

## Out of scope

- Bluetooth auto-entry / auto-launch (user's phone Routine owns it).
- Android Auto / Apple CarPlay surfaces.
- Voice control.
- Any change to the rapid-error single-track brake or to source
  adoption ranking.
