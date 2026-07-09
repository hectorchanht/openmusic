---
gsd_debug_version: 1.0
slug: nowbar-frozen-audius-spam
status: fix-applied-verified
trigger: "check out local dev. nowbar can not be extended and not showing current played song. the app is kinda of frozen. http://localhost:5173/api/audius/search?query is being spammed."
created: 2026-07-09
updated: 2026-07-09
---

# Debug: nowbar frozen (won't expand, no current song) + /api/audius/search spammed

## Symptoms (from user)

- **Expected:** Nowbar expands into NowPlaying, shows the current song; app stays responsive.
- **Actual:** Nowbar cannot be extended and does not show the current played song. App is "kinda frozen."
- **Signature:** `http://localhost:5173/api/audius/search?query=…` is being SPAMMED (tight request loop).
- **Environment:** Local dev, Vite server running on port **5173** (PID 84958; note: not the 4321
  strictPort noted in older memory — current dev instance is on 5173, matching the user's URL).
- **Reproduction:** Present live on the running local dev server right now — "check out local dev."

## Prior art (related, DISTINCT root causes)

- `.planning/debug/resolved/nowbar-freeze-reresolve-loop.md` — whole-app freeze from an UNCAPPED
  SYNCHRONOUS `audio.error` re-resolve storm in `player.svelte.ts`. Fixed with a rapid-fire brake
  (<400ms, no intervening `playing`) + restored FAILURE_CAP, both routing to SKIP. Same FREEZE
  class, but that storm hit resolve/`audio.src`, not a search endpoint.
- `.planning/debug/reresolve-loop-stops-playback.md` (active, fix-applied-pending-verify) — bounded
  post-playback `reresolveCurrent` loop on a dead netease URL. Again a RESOLVE loop, not search.

**This session is a NEW facet:** the spammed endpoint is `/api/audius/search` — a SEARCH fan-out
(`catalog.searchAll` → audius adapter `search()` at `src/lib/sources/audius.ts:42`), NOT a track
`resolve()`. The freeze is the symptom; the driver is whatever calls `searchAll()` in a tight loop.

## Suspects (searchAll callers, to trace)

- `player.svelte.ts` `runFallback` / `tryFallback` — cross-source failover fans out via search.
- `player.svelte.ts:2221` `resolveStub` — "re-searches it through searchAll+dedupeBest (~5-10s)".
- `player.svelte.ts` `playStub` overlay (`pendingGen`) path.
- Cover resolution CN tier (`searchAll → dedupeBest[0].cover`) — cover-backfill / self-heal loop.
- `catalog.searchAll` TTL cache (`catalog.ts:85`): if the loop varies the keyword or bypasses the
  cache, every iteration is a live upstream hit → the spam.

A tight synchronous loop here would block the main thread → nowbar can't expand + UI frozen, exactly
like the resolved storm but via the search path. Confirm which caller, why it has no cap/gen-guard,
and whether it's search-driven or (as before) an audio.error storm that happens to re-search.

## Evidence

- timestamp: 2026-07-09
  checked: git working tree + running dev server (PID 84958 on :5173)
  found: working tree is CLEAN (only HANDOFF.json + this debug file). The bug is in COMMITTED code.
    Most recent playback/cover commits (today/yesterday): c902264 (bound reresolve storm → SKIP),
    26e413a (NowPlaying hero effectiveCover now reads the reactive cover cache), f7c2580 (blob
    pre-buffer), 110fb0b (bg keep-alive + dead-run strike).
  implication: the loop was introduced/unleashed by a recent commit, not uncommitted work.

- timestamp: 2026-07-09
  checked: ttl-cache.ts `cached()` semantics + catalog.searchAll cache key
  found: searchAll memoizes the RESOLVED SearchResult under key `${query.trim().lower}|${enabledIds}|${page}`
    for 60min. A REJECTED/aborted searchAll is NOT cached (retried next call). So a same-query loop hits
    audius exactly ONCE; audius is spammed ONLY when (a) the query VARIES per iteration, or (b) the call
    is aborted before it resolves (signal-threaded callers), so the cache never populates.
  implication: the spam driver must be a loop over VARYING seeds (skip chain regenerating from a new
    `current` each time) OR a signal-aborted searchAll that never caches (runFallback→tryFallback).

- timestamp: 2026-07-09
  checked: NowPlaying healCover $effect (:481) + effectiveCover (:463) + player.healCover (:2687)
    + cover-version.svelte.ts (bumpCoverVersion rAF-coalesced in browser)
  found: 26e413a made effectiveCover fall back to readCoverByUidOrName (coverVersion-reactive) so the
    healCover $effect now re-runs on EVERY global cover write. BUT healCover is one-shot-guarded on
    `${uid}|${resolvedCover}` (healProbed) and early-returns when resolvedCover is null/non-https. It
    only bumps coverVersion after a probe→evict→re-resolve, and resolveCoverForTrack is deterministic
    (stable url for a given artist/title) so the second run's key is already in healProbed → STOP. The
    rAF-deferred bump could in principle escape Svelte's synchronous effect-loop depth guard, but the
    healProbed guard breaks the cycle after one probe per url.
  implication: the healCover $effect is NOT the search-spam driver (it never calls searchAll on a loop;
    resolveCoverForTrack's CN tier fires at most once per uid+url).

- timestamp: 2026-07-09
  checked: skip/advance chain — audio.error ceiling (:1489 c902264) → strikeUnplayable + next() (:2909)
    → nextAdvanceIndex/advanceTo (:2878/:2894) → play(). ensureAhead (:1820) → buildSimilarQueue
    (similar.ts:58, up to 8× searchAll) → primeNext (:2215). play() regenerate only on opts.fresh (:2576).
  found: CORRECTION — play(track, opts?) reads opts?.fresh; advanceTo→play(t) passes opts=undefined →
    NON-fresh → does NOT regenerate. So a skip/advance does NOT fire buildSimilarQueue directly; it fires
    primeNext→ensureAhead (only when tail within 2 of current, growPromise-guarded) → buildSimilarQueue
    (8× searchAll, cached by similar-artist name). The audio.error ceiling calls next() directly. ensureAhead is
    growPromise-guarded (single in-flight) and only grows when tail within 2 of current. runFallback
    (:2994) → tryFallback → searchAll(query, onlySource, signal) fires per source-attempt WITH a signal
    (abort-on-supersede → not cached → re-fetched). FAILURE_CAP ceiling fires every 5 raw audio errors,
    each ceiling → strike + next() (a fresh advance → regenerate).
  implication: candidate root = a systemic-playback-failure SKIP STORM: every failed track → ceiling →
    next() → fresh advance → regenerate (8× searchAll, varying similar-artist seeds) + runFallback
    (signal-aborted searchAll per source) → `/api/audius/search` spammed with varying queries; `current`
    flaps so the nowbar can't bind/expand and the app churns ("frozen"). NEEDS empirical confirmation of
    (1) whether playback is actually failing on :5173 and (2) which caller dominates the audius requests.

## Eliminated

- hypothesis: The NowPlaying healCover $effect (made coverVersion-reactive by 26e413a) is a per-frame
    reactive loop that spams searchAll via cover re-resolution.
  evidence: healCover is one-shot-guarded on `${uid}|${resolvedCover}` and early-returns on null/non-https
    resolvedCover; resolveCoverForTrack is deterministic so the cycle self-terminates after one probe per
    url. It cannot drive a sustained searchAll loop.
  timestamp: 2026-07-09

- timestamp: 2026-07-09
  checked: NEW user evidence (3 network screenshots, 2060→ requests, 130MB) + full code trace of the
    prefetch/prebuffer/regenerate/fallback fetch machinery + the client fetch seam (api-base.apiFetch).
  found: THREE correlated spam families, all initiated by `fetcher.js:67` = compiled
    `src/lib/services/api-base.ts` `apiFetch` (a THIN `fetch` wrapper — NO throttle, NO dedupe, NO
    concurrency cap; confirmed there is ZERO global outbound-request governance anywhere in src/lib):
      (1) `/api/qq/detail?msg=周杰伦&type=json&mid=001Bbywq2gicae` — IDENTICAL params, ~2000×, all
          200 but pending "1.7 min". Same Jay Chou track re-resolved endlessly. QQ `resolve()` mutates
          the track in place and sets `detailsLoaded=true` ONLY on success (qq.ts:273); an expired/
          region-locked vkey throws (:279) leaving detailsLoaded=false → re-resolve on the next pass.
      (2) `…flac?guid=…&vkey=<VARIES>&rc=F000001Bbywq2gicae` — the SAME FLAC, a FRESH vkey each row,
          6–62MB each, many `(canceled)`. This is `prebufferNext()` (f7c2580, added Jul 8) fetching the
          FULL resolved bytes; each fresh vkey proves a fresh detail re-resolve fed it. BUG: on `!resp.ok`
          (403) prebufferNext returns WITHOUT setting `prebufferedUid` (:2178) so its per-uid dedupe
          NEVER trips on failure → the same failing URL is re-fetched every prewarm.
      (3) `/api/audius/search?query=…`, `/api/*/search?…` with VARYING artist seeds (Bruno Mars, Taylor
          Swift, Coldplay, 周杰伦, 林俊杰, 邓紫棋) = `buildSimilarQueue` (8× searchAll) via ensureAhead/
          regenerate, plus `runFallback→tryFallback→searchAll(q, source, signal)` (signal-aborted →
          never TTL-cached → re-fetched every cycle).
  implication: ROOT CAUSE (below). NOT the resolved nowbar-freeze CPU-peg class; this is an ASYNC
    fetch FLOOD that saturates the browser's ~6-per-origin connection pool → every request (incl. the
    nowbar's own cover/resolve) queues for minutes → app appears frozen. c902264's error ceiling only
    brakes the SYNCHRONOUS <audio>.error re-attach loop (:1489) — it does nothing to the fire-and-forget
    `void this.prefetchNext()/prebufferNext()/regenerate()/runFallback()` fetch fan-out.

## Eliminated

- hypothesis: The NowPlaying healCover $effect (made coverVersion-reactive by 26e413a) is a per-frame
    reactive loop that spams searchAll via cover re-resolution.
  evidence: healCover is one-shot-guarded on `${uid}|${resolvedCover}` and early-returns on null/non-https
    resolvedCover; resolveCoverForTrack is deterministic so the cycle self-terminates after one probe per
    url. It cannot drive a sustained searchAll loop.
  timestamp: 2026-07-09

- hypothesis: Same root cause as the resolved `nowbar-freeze-reresolve-loop` (synchronous audio.error
    re-attach storm pegging the main thread).
  evidence: c902264's RAPID_ERROR/FAILURE_CAP ceiling (:1514) DOES bound the synchronous <audio>.error
    loop and routes it to SKIP. The freeze here is instead an async fetch flood (connection-pool
    saturation) driven by the OUT-OF-BAND prefetch/prebuffer/regenerate/fallback tasks, which the error
    ceiling never touches. Different mechanism, different fix surface.
  timestamp: 2026-07-09

## Root Cause

Under systemic playback failure (expired / region-locked QQ FLAC URLs that resolve fine then 403 on the
byte stream), the never-stop recovery chain churns the queue, and the fire-and-forget prefetch /
prebuffer / regenerate / fallback tasks each re-issue `apiFetch` calls with NO global concurrency, NO
in-flight dedupe, and NO rate ceiling. Two amplifiers compound the churn:
  - **Blob pre-buffer (f7c2580, Jul 8)** turns every churn cycle from a light JSON resolve into a full
    multi-MB FLAC download, and its 403 path never dedupes (no `prebufferedUid` set) → re-fetches the
    same dead URL repeatedly (the varying-vkey FLAC flood + 130MB).
  - **Similar-queue regeneration** (`buildSimilarQueue`, 8× searchAll) + signal-aborted `runFallback`
    searchAll fan varying-seed searches across every source, none TTL-cached (the search flood).
Every subsystem is LOCALLY bounded (per-uid strike, per-gen guard, single in-flight prefetch) but they
COMPOSE and re-arm faster than they converge. Thousands of concurrent `/api/*` fetches saturate the
browser connection pool → the nowbar's own requests queue for minutes → it can't bind/expand the current
song and the app is effectively frozen. c902264 bounded only the synchronous <audio>.error CPU loop.

## Fix (proposed — pending user confirmation of scope)

- **A. Global outbound governor in `api-base.ts`** (surgical, guarantees "never spam"): wrap `apiFetch`
  with (a) in-flight DEDUPE by method+URL — identical concurrent `/api/qq/detail?…mid=…` and
  `/api/*/search?query=…` collapse to ONE shared promise (kills the 2000× identical-detail + repeat
  searches outright); (b) a max-concurrency cap (~6–8) so a fan-out can never saturate the pool.
- **B. Disable the blob pre-buffer (f7c2580)** per the user's ask: `prewarmNextAssets` stops calling
  `prebufferNext` (keep `preloadNextCover`); play()'s CDN-URL src path already handles the absence
  gracefully. Removes the full-FLAC flood + the 403-no-dedupe bug.
- **C. (optional) Failure circuit breaker**: after N consecutive playback failures, stop auto
  regenerate/prefetch/ensureAhead and surface a notice instead of churning the queue.

## Fix applied (scope A + B, user-approved)

- **A. Outbound governor in `src/lib/services/api-base.ts`** — `apiFetch` now routes every `/api/*`
  request through a governor (replacing the thin `fetch` wrapper):
    • in-flight DEDUPE (idempotent body-less GET): identical concurrent method+URL collapse to ONE
      upstream fetch; each caller reads an independent `resp.clone()`. The shared fetch is driven by the
      governor's OWN timeout signal (caller signals are stripped), so one caller's supersede-abort can
      never cancel a request another caller awaits. → kills the ~2000× identical `qq/detail` + repeated
      identical searches.
    • MAX_CONCURRENT_REQUESTS = 8 + FIFO queue: at most 8 fetches ISSUED at once → the browser request
      queue can never explode; UI-critical requests are never buried.
    • REQUEST_TIMEOUT_MS = 25_000: a hung upstream cannot hold a slot forever.
- **B. Removed the zero-fetch blob pre-buffer (f7c2580)** in `src/lib/stores/player.svelte.ts`:
  deleted the `prebuffered{Uid,BlobUrl}`/`prebufferController` fields + the `prebufferNext()` method;
  `prewarmNextAssets` now warms the cover only; play()'s consume branch drops the prebuffer path and
  always swaps to the CDN URL for non-downloaded tracks (offline-download `cachedBlobUrl` untouched).
  → removes the multi-MB FLAC flood + the 403-no-dedupe re-fetch bug.
- **C. Caller-side systemic-failure STOP (added on user request — "those api should not be spammed at
  the first place")** in `player.svelte.ts`. The governor (A) only caps the blast radius; the CALLER
  was still firing the storm because nothing bounded the whole-queue skip-storm: under systemic failure
  every track 403s → the error ceiling / handleTotalFailure just SKIP forever → each skip re-resolves +
  auto-grows (8× searchAll) + prefetches. The D-04 consecutive-failure STOP (`tripLoopGuard`) had been
  DISABLED in ef2c751. Re-enabled it as `haltRunawayRecovery()`, driven by a new cross-track counter
  `failoverSkips` (cap `SYSTEMIC_SKIP_CAP = 5`): once 5 DISTINCT tracks fail back-to-back with zero
  successful playback, STOP — pause (via `pauseAudio()`), abort the in-flight prefetch, cancel pending
  delayed re-resolves, clear the OS media UI, and surface ONE sticky Retry notice (`recoverFromStop`).
  `failoverSkips` resets on a real `playing` and on recovery, so it CANNOT false-positive on a transient
  blip (the reason the old rapid-error STOP was disabled — that tripped on a synchronous storm on ONE
  track; this trips only across N separate failed tracks). Incremented at BOTH the raw-audio-error
  ceiling and `handleTotalFailure`.

## Round 2 — the storm PERSISTED (search flood on Home), two more root findings

The user re-reported the storm (3043 `search?*` requests, all FAILED at ~2ms = net::ERR_INSUFFICIENT_
RESOURCES, stale song stuck on the loading line) — on the HOME screen. Investigation (this session):

- **Real driver = the Home cover backfill, NOT the player.** `scheduleBackfill()` calls
  `backfillCovers(rows, { max: rows.length })` — the cap was LIFTED in quick-260607-0bb, so EVERY
  uncached gradient tile (~270) runs the cover chain Deezer→iTunes→**CN `searchAll` (6-source fan-out)**.
  On cold Home with Deezer/iTunes failing that is ~1600+ search requests; a FAILED cover-search is never
  cached, so every refresh/randomize re-fires them → the sustained flood.
- **Finding 1 — `deezer.ts` BYPASSED the governor.** All 7 Deezer call sites used raw
  `fetch(apiUrl(url), …)`, so `/api/deezer/*` (chart, search, song cover, related artists — the primary
  cover tier AND the Home chart) never touched the governor/breaker/dedupe. This is why hammering
  Randomize issued 330 real `/api` fetches even with the governor in place. **Fix:** route all 7 sites
  through `apiFetch` (per-caller timeout/abort preserved via the governor wrapper). deezer.test.ts mocks
  gained a `clone()` (the GET-dedupe path clones the shared Response).
- **Finding 2 — the governor PACED but did not STOP.** MAX_CONCURRENT caps concurrency but the FIFO
  queue is unbounded and dedupe is in-flight-only; a caller loop firing DISTINCT URLs (varying cover
  seeds) still issued its whole backlog (8 at a time), and when everything fails in ~2ms the queue drains
  fast → thousands still hit the wire. The governor's own FIFO also STARVED the player's resolve behind
  the backfill flood (the stale-song-stuck-loading symptom the user saw).
- **D. CIRCUIT BREAKER in `api-base.ts`** — the structural "never spam" guarantee at the one seam every
  `/api/*` call now funnels through (adapters + deezer). When `/api/*` FAILURES spike
  (`CIRCUIT_FAILURE_THRESHOLD = 30` within `CIRCUIT_WINDOW_MS = 3s`), OPEN the breaker and FAST-REJECT
  every new `/api/*` for `CIRCUIT_COOLDOWN_MS = 10s`; a single half-open probe success closes it. A
  failure = network error / timeout / 5xx / 429; a caller-abort (supersede) and a normal 4xx are NEUTRAL.
  Checked BEFORE acquiring a slot (hard-open fast-reject) AND after (re-gate for requests that queued
  before the trip + the single half-open probe). Never-throw callers (search allSettled, cover tiers,
  translate) already degrade to empty/gradient sentinels, so an OPEN breaker just stops the flood and
  retries after cooldown. This is what makes detail/search/blob "never spam" regardless of which
  (individually-bounded, composing) caller loops.

## Verification

- `pnpm check`: 0 errors / 0 warnings (4298 files).
- `pnpm test`: 69 files, **1080** tests pass. New/updated tests:
    • `api-base.test.ts` — dedupe collapses identical concurrent GETs to one fetch + independent clones;
      a superseded caller rejects (AbortError) without cancelling the shared fetch; concurrency never
      exceeds MAX_CONCURRENT_REQUESTS while draining. CIRCUIT BREAKER: trips after
      CIRCUIT_FAILURE_THRESHOLD failures and fast-rejects further requests WITHOUT hitting fetch; does
      NOT trip below the threshold; a caller-abort does NOT count toward tripping; a successful half-open
      probe closes it after the cooldown. `__resetGovernor()` reset in afterEach so breaker state can't
      leak across tests.
    • `deezer.test.ts` — mock Response gained `clone()` (deezer now fetches through the GET-dedupe path).
    • `player.svelte.test.ts` — prefetch pre-resolves + warms cover but NEVER byte-fetches (blob
      pre-buffer removed); RE-ENABLED + adapted the two SYSTEMIC-STOP tests (at the failoverSkips cap it
      halts with a sticky Retry notice, does NOT advance, and aborts the in-flight prefetch; Retry
      resets + skips ahead); reset `failoverSkips`/`consecutiveFailures` in the global beforeEach so a
      leaked count can't false-trip the STOP.
- LIVE (dev server :4321, driven via preview tools):
    • Round 1 (A+B): searched "Jay Chou" → results render across all sources (no clone/dedupe
      regression); played a track → cross-source fell back to kuwo and PLAYS; nowbar SHOWS the title and
      EXPANDS to the full NowPlaying overlay (lyrics loaded). Census: `qq/detail` 0, `.flac` 0, ~47
      searches total (vs 2060+ before). All three reported symptoms resolved.
    • Round 2 (A+B+C): searched "周杰伦" → played a track → PLAYS (t≈107s/215s, readyState 4). The
      systemic STOP did NOT false-trigger on healthy playback (no "stopped" notice); census again clean
      (`qq/detail` 0, `.flac` 0, `/search` 43 normal). Note: the automated browser blocks autoplay until
      a real gesture (paused at t=0 with metadata loaded → played after an explicit `.play()`), unrelated
      to the fix. Pre-existing dev-only Svelte reactivity warnings ("updated at" from `restore()` →
      `set queue`/`set current` in the +layout `$effect`) are NOT introduced by this change (my diff
      touches only api-base.* and player.svelte.*, not restore/+layout) — out of scope.
    • Round 3 (D — breaker + deezer routing): forced ALL `/api/*` to fail via a fetch wrapper, then
      hammered Randomize 300× → real `/api` fetches PLATEAUED at 30 (was 330 before routing deezer +
      dedupe). Definitive breaker proof (80 DISTINCT governed GETs, dedupe can't collapse): only 32
      reached fetch, breaker OPEN (msUntilClose 10000) → the other 48 fast-rejected. Confirmed the
      probed module instance is the app's (a direct `mod.apiFetch` drive showed active:8/waiters:42).

## Files changed

- src/lib/services/api-base.ts — outbound governor (dedupe + concurrency cap + timeout) + CIRCUIT
  BREAKER (D); `__resetGovernor()` test helper.
- src/lib/services/api-base.test.ts — governor + breaker regression tests; `__resetGovernor()` in
  afterEach; updated the init pass-through test.
- src/lib/services/deezer.ts — route all 7 `/api/deezer/*` fetches through `apiFetch` (were raw `fetch`,
  bypassing the governor/breaker) — the ungoverned-Deezer gap that let the Home backfill flood through.
- src/lib/services/deezer.test.ts — mock Response gained `clone()` (GET-dedupe path clones).
- src/lib/stores/player.svelte.ts — removed the blob pre-buffer feature (B) + systemic-failure STOP
  `haltRunawayRecovery()` / `failoverSkips` ceiling (C).
- src/lib/stores/player.svelte.test.ts — replaced the prebuffer test; re-enabled the SYSTEMIC-STOP
  tests; counter resets in the global beforeEach.

## Known follow-ups (not blocking; noted for a future pass)

- The Home cover backfill still fans `searchAll` across up to `max: rows.length` (~270) gradient tiles
  (quick-260607-0bb lifted the cap). The breaker now bounds the FAILING case, but a healthy-but-slow
  cold Home still issues a large (if successful + cached) fan-out; consider re-capping the backfill or
  negative-caching cover misses so repeated refreshes don't re-search failed tiles.
- The governor's FIFO can transiently starve a UI-critical resolve behind a large background fan-out
  (mitigated by the breaker once failures spike + by healthy-case completion). A priority lane for
  playback resolves would remove the residual stale-loading window.

## Current Focus

- hypothesis: CONFIRMED + FIXED — async fetch flood (no global outbound governor) amplified by the
  f7c2580 blob pre-buffer + similar-queue regeneration, saturating the connection pool → frozen app.
- test: done — `pnpm check` + `pnpm test` green; live smoke test on :4321 confirms bounded requests +
  all three symptoms resolved.
- expecting: n/a — resolved.
- next_action: (optional) commit A+B; consider the deferred circuit breaker (C) if systemic-failure
  churn is still observed under real region-lock conditions.
- reasoning_checkpoint:
- tdd_checkpoint:
