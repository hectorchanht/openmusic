# Codebase Concerns

**Analysis Date:** 2026-07-03

> **Scope note:** The LIVE app is a SvelteKit + Vite mobile PWA under `src/`, deployed on Cloudflare (Pages + Workers), pnpm + vitest (67 test files). The root `CLAUDE.md` / `AGENTS.md` describe an OLD vanilla `index.html` player that **no longer exists in the repo** — treat those docs as stale (see Tech Debt below). `index.html` is NOT present at the repo root.
>
> **Overall health: strong.** Zero `TODO`/`FIXME`/`HACK`/`XXX` markers in `src/`. Near-zero `console.*` noise (2 intentional JOOX soft-allow warns). Solid security posture (edge-only secrets, allowlisted CORS, input validation). Cover logic is well-consolidated (single `resolveTrackChain`). The concerns below are concentrated in a few well-known hotspots, not spread systemically.

---

## Tech Debt

### `player.svelte.ts` god-object (CONFIRMED — highest-leverage)

- Issue: One class holds **15 `$state` fields + ~67 methods across 3017 lines** (`src/lib/stores/player.svelte.ts`), backed by a **4163-line** test file (`src/lib/stores/player.svelte.test.ts`). It owns: audio-element attach + all `<audio>` event listeners, queue model, prefetch/probe walk, cross-source failover, loop-guard/never-stop, sleep-timer integration, media-session sync, cover healing, localStorage persistence, and offline-blob playback.
- Files: `src/lib/stores/player.svelte.ts` (whole file; e.g. `attach()` at line 1151, `play()` at 2072, `restore()` at 383, `healCover()` at 2439).
- Impact: Every playback bug fix touches this one file; the 96-entry quick-task history shows repeated churn here. High regression surface, hard to reason about in isolation, merge-conflict magnet.
- Fix approach: Extract cohesive slices into peer `.svelte.ts` modules that the `Player` composes, WITHOUT changing the public `player.*` API the components read. Natural seams (already isolated by field/method): (a) **persistence** (`serializeTrack`/`persist`/`persistThrottled`/`flushPersist`/`restore`), (b) **failover/never-stop state machine** (`runFallback`/`handleTotalFailure`/`consecutiveFailures`/`errorBurst`/`reresolveBurst`/strike maps), (c) **prefetch/probe walk** (`prefetchNext`/`PREFETCH_*`/`PROBE_*`/dead-uid tracking), (d) **cover healing** (`healCover`/`resolvedCover`/`healProbed`). The pure helpers already live outside (`media-session.ts`, `sleep-timer.ts`, `fallback.ts`) — this continues that established "wrap, don't inline" pattern. HIGH effort, HIGH long-term impact; do incrementally, one slice per phase, leaning on the existing 4163-line test suite.

### Stale root docs — `CLAUDE.md` / `AGENTS.md` (CONFIRMED)

- Issue: Both root docs (76 references each to `index.html`, "vanilla", "no build step", "3320 lines", "IIFE") describe a project that was fully rewritten. They actively mislead: `CLAUDE.md` claims "hardcoded `JOOX_TOKEN` at index.html:2165" — but the token is now correctly edge-only in `platform.env` (`src/lib/proxy/joox.ts:32`). An agent following `CLAUDE.md` would edit a non-existent file and reintroduce a fixed security flaw.
- Files: `CLAUDE.md` (last modified 2026-06-05), `AGENTS.md` (2026-06-11).
- Impact: Confuses every AI/human onboarding; the user's auto-memory already carries a correction note ("CLAUDE.md is stale; live app lives under src/").
- Fix approach: Rewrite both to describe the SvelteKit architecture (the `.planning/codebase/` docs from this map run are the source of truth). LOW–MEDIUM effort, HIGH clarity impact.

### Orphan `spike` route (CONFIRMED — dead code)

- Issue: `src/routes/spike/+page.svelte` (277 lines) is a Phase-1 audio-engine experiment. It is not linked from any nav/router (only a comment reference in `src/routes/+layout.svelte:17`), reachable solely by typing `/spike`.
- Files: `src/routes/spike/+page.svelte`.
- Impact: Ships in the bundle, indexable, confuses readers. Low risk but pure dead weight.
- Fix approach: Delete the route (and the `/spike` comment in `+layout.svelte`). LOW effort.

### Player state comments encode a fossil record of reverted fixes (SUSPECTED debt)

- Issue: Many `player.svelte.ts` doc-comments narrate the HISTORY of a bug and its prior (now-removed) mechanism — e.g. the `pause`/`visibilitychange` handlers carry multi-paragraph explanations of `scheduleExternalResume`, `resumeOnForeground`, `resumeIfStalled` that were all deleted (`attach()` lines 1186–1266). This is valuable archaeology but bloats the file and makes the CURRENT behavior harder to extract from the WAS-behavior.
- Files: `src/lib/stores/player.svelte.ts` (comment blocks throughout `attach()`).
- Impact: Readability tax; contributes to the god-object size. Not a functional bug.
- Fix approach: When the failover/lifecycle slices are extracted (see god-object item), trim the reverted-mechanism narration to a one-line "removed in quick-260703-i7e" pointer. LOW effort, do opportunistically.

---

## Fragile Areas

### iOS / Android background audio + autoplay lifecycle (CONFIRMED — the dominant bug source)

- Files: `src/lib/stores/player.svelte.ts` — `attach()` event wiring (line 1151), the `play`/`playing`/`pause`/`canplay`/`timeupdate` listeners (1190–1308), `maybeRetryAutoplay`, `reresolveCurrent` (487), stall watchdog, `flushPersist` (369).
- Why fragile: The store distinguishes `play` (intent) vs `playing` (real audio) events because the whole never-stop/loop-guard chain breaks if the success-reset hangs off the wrong one (CR-01, documented at line 1190). The auto-resume-on-foreground mechanism was added and then REMOVED (quick-260703-i7e); an earlier "defer UI swap until `playing`" froze mobile playback and was reverted (user memory `player-displayed-defer-broke-mobile`). Behavior depends on unreliable, browser/OS-specific event ordering that cannot be unit-tested — it is validated only on-device.
- Safe modification: NEVER gate the now-playing UI swap on the audio `playing` event (proven to freeze iOS). NEVER re-issue `play()` on foreground/visibility (removed twice now). Change one listener at a time, re-run `player.svelte.test.ts` (161 cases), and use the built-in **Activity Log** (Settings → Activity log, `logAction`/`actionLog.svelte.ts`) to diagnose on real devices — it exists precisely because these cases are not reproducible in CI.
- Test coverage: Extensive headless logic tests, but ZERO real-device automation — the fragile part (event ordering under backgrounding) is inherently untested by the suite.

### JOOX cross-source identity matching (CONFIRMED — recurring, now soft-guarded)

- Files: `src/lib/sources/joox.ts:227–273` (identity re-validation in `resolve()`).
- Why fragile: Upstream keys detail by a POSITIONAL `n`, and separately **swaps which value lands in `songmid` vs `歌曲ID` between the search and detail endpoints** (user memory `joox-swaps-songmid-songid`). A naive same-field compare rejects a CORRECT song (real case: 有人). The current guard does a cross-field token-pool match and only THROWS in the "strong-disjoint" case (both sides fully populated, zero overlap); otherwise it SOFT-ALLOWs with a `console.warn` (relaxed in quick-260630-e6e). This is a deliberate correctness/availability tradeoff that can still let a wrong song through in partial-identity cases.
- Safe modification: Keep the cross-field pool logic; do not tighten back to same-field compare. Any change must preserve the 有人 case (add it as a fixture if not already). The `__fixtures__/joox.*.json` files support this.
- Test coverage: `src/lib/sources/joox.test.ts` covers the adapter; verify the swap case is asserted.

### Upstream shape drift on all CN sources (CONFIRMED — external, unavoidable)

- Files: `src/lib/sources/{netease,qq,kuwo,joox,fivesing,audius,jamendo}.ts`; parsers read Chinese field names (`歌曲名称`, `歌手`, `播放链接`) directly.
- Why fragile: Every source is a third-party proxy whose JSON shape can change without notice (a project constraint). Adapters throw a typed contract-drift error on mismatch (e.g. `joox.ts:177`) so `Promise.allSettled` records a per-source failure without killing the fan-out — good. But a silent SHAPE change (fields present but repurposed) would pass the guard and surface as wrong/empty data.
- Safe modification: Keep the throw-on-contract-drift posture. Prefer adding new sources over patching drifted ones (registry pattern in `src/lib/sources/registry.ts` makes this a new-file-only change).
- Test coverage: Per-source fixtures in `src/lib/sources/__fixtures__/` — but fixtures are snapshots; they cannot catch live drift.

### Content-type-fragile / echo-mode parsers — `/api/translate` (CONFIRMED)

- Files: `src/routes/api/translate/+server.ts` (header comment documents THREE separate historical failure modes: blank-line reflow, oversized-payload echo, and fallback-line indistinguishability).
- Why fragile: Uses an UNOFFICIAL, keyless Google translate endpoint that silently echoes input on oversized payloads and reflows on blank lines. The fix stack (sentinel tokens, chunking, echo-mode detection, `flags[]`) is intricate and load-bearing; user memory `translate-api-soft-fail-echoes-originals` confirms a regression where a 200-with-echoed-originals silently dropped translations. Clients MUST gate on the `complete`/`flags` signal, not HTTP 200.
- Safe modification: Preserve the `flags: boolean[]` contract and the chunking. Never treat HTTP 200 as "translated". Any client consuming `/api/translate` must retry incomplete lines rather than cache echoed originals.
- Test coverage: `src/lib/services/translate.test.ts`.

### Cover CDN URL expiry + stale-cache churn (CONFIRMED — root of the largest bug cluster)

- Files: `src/lib/services/cover-cache.ts` (unbounded flat `Record<string,string>`, NO TTL/LRU), `src/lib/actions/lazyCover.ts` (per-row `new Image()` probe + `removeCoverBoth` self-heal), `src/lib/stores/player.svelte.ts:2439` (`healCover`), `src/lib/stores/cover-version.svelte.ts` (global reactive bump).
- Why fragile: Resolved cover URLs (Deezer/iTunes/CN CDN) can EXPIRE, but the cache stores them forever with no time-based eviction — only whole-cache-clear (`clearCoverCache`) or per-entry evict on a detected dead-image. At least 8 quick tasks fixed cover symptoms (260629-nyl, 260630-efr/ey2/fe1, 260704-20e, 260606-rvy/v7k, 260607-0bb). The self-heal is now reactive (probe dead → evict → re-resolve), but it fires ONLY after a broken paint is observed; a cache full of soon-to-expire URLs guarantees repeated dead-paint → probe → re-resolve cycles. User memory `cover-cache-stale-url-root-cause` confirms: failures aren't cached, no per-entry TTL.
- Safe modification: The cleanest durable fix is a TTL/LRU on `cover-cache.ts` (see Optimization backlog). Until then, keep the two-layer read order (uid → name, D-13) and the `isSolidCover` https guard intact — they are the invariants every fix depends on.
- Test coverage: Good — `cover-cache.test.ts`, `cover-backfill.test.ts`, `lazyCover.test.ts` (13 cases).

---

## Security Considerations

> **Posture is strong.** The stale `CLAUDE.md` warnings about a hardcoded `JOOX_TOKEN` no longer apply — the rewrite fixed this properly.

### Secrets handling (CONFIRMED — GOOD)

- `JOOX_TOKEN`, `LASTFM_KEY`, `LASTFM_SECRET`, `JAMENDO_CLIENT_ID` are typed edge-only bindings (`src/lib/proxy/proxy-types.ts`), injected into upstream URLs on the Cloudflare Worker and NEVER sent to the client (`src/lib/proxy/joox.ts:32`, `src/routes/api/similar/+server.ts:53`).
- `.dev.vars`, `.dev.vars.*`, `*.jks`, `.env` are all gitignored (`.gitignore:140,221–222,244`). `release.jks` and `.dev.vars` are present on disk but **NOT tracked in git** (verified via `git ls-files`) — correct.
- `src/lib/proxy/joox.ts:12` explicitly forbids logging the token/URL. No violations found.
- Recommendation: None required. Keep the "never log secrets / never `Allow-Origin: *`" discipline in any new proxy route.

### Proxy CORS / SSRF surface (CONFIRMED — GOOD, one minor note)

- CORS is centralized in `src/hooks.server.ts` and `src/lib/proxy/http.ts`: an explicit origin allow-list (`ALLOWED_ORIGIN_PATTERNS`), never `*`, always `Vary: Origin`. This prevents the token-bearing proxy from becoming an open relay (threat T-01-02).
- SSRF is well-contained: no route forwards a user-controlled HOST. Every proxy `buildUrl` pins a fixed upstream base and only forwards allow-listed path segments + `encodeURIComponent`'d params (`src/lib/proxy/netease.ts:13`, `joox.ts:24`, `src/routes/api/fivesing/url/+server.ts:20` pins `ALLOWED_TYPES`).
- Minor note (LOW risk): the fivesing upstream hop is plaintext HTTP (`src/routes/api/fivesing/url/+server.ts:19` — upstream has a TLS cert mismatch). The Worker→upstream leg is unencrypted; the client→Worker leg is https. Metadata-only, no secrets on that hop, but worth flagging.
- Recommendation: None blocking. Any NEW proxy route must reuse `corsHeaders()` + an allow-list of path segments, never accept a target URL from the client.

### localStorage tampering (SUSPECTED — LOW, already defended)

- Persisted state (`settings.svelte.ts` load path lines 207–326, `player.svelte.ts` `restore()`) is defensively parsed: coerce-and-clamp numbers, drop un-migratable garbage, try/catch around every read. This is solid; a tampered `localStorage` degrades to defaults rather than crashing. No action needed.

---

## Performance / Optimization Opportunities

### Missing edge cache on the CORE CN metadata proxy (CONFIRMED — highest-leverage perf win)

- Problem: The hottest route — `/api/[source]/[...path]` (netease/qq/kuwo/joox **search + detail**) — sets NO `Cache-Control` and does NOT use `caches.default`. Every search keystroke-driven query and every track-detail resolve hits the upstream proxy fresh, even for identical queries across users. `/api/similar` also has no edge cache.
- Files: `src/routes/api/[source]/[...path]/+server.ts:48–54` (passthrough Response sets only CORS + content-type), `src/routes/api/similar/+server.ts`.
- Contrast: Deezer/lastfm/audius/jamendo/fivesing-search routes ALL use `caches.default` with long TTLs (`src/routes/api/deezer/search/+server.ts:30` `TTL=86400`), and `/api/translate` sets `cache-control: public, max-age=86400` (`translate/+server.ts:80`). The core CN proxy is the outlier.
- Improvement path: Add `caches.default` + a `Cache-Control` on the catch-all proxy for `search`/`detail` responses (keyed by own-origin Request, mirroring the Deezer route). Search metadata is safe to cache short (~5–15 min); detail URLs expire faster so cache them shorter (~2 min) or not at all. This is the single biggest reduction in upstream load and search latency. MEDIUM effort, HIGH impact.

### Global cover-version bump = whole-page tile re-render fan-out (CONFIRMED)

- Problem: Every single cover write calls `bumpCoverVersion()` which increments ONE global `$state` counter (`src/lib/stores/cover-version.svelte.ts:38`) that EVERY mounted tile depends on via `coverVersion()`. When `backfillCovers` lands N covers on a home visit, it fires N bumps → up to N full re-evaluations of every tile's `$derived` cover read across the whole grid.
- Files: `src/lib/stores/cover-version.svelte.ts` (`bumpCoverVersion`, `writeCoverBoth`, `removeCoverBoth`), consumed in `src/routes/(app)/+page.svelte` (1093 lines) and every tile.
- Improvement path: Batch bumps (coalesce to one bump per animation frame / microtask when backfill resolves a burst), OR move to per-key reactivity (a `SvelteMap` so only the tile whose key changed recomputes). MEDIUM effort, MEDIUM impact (most visible on cold home loads with many gradient tiles).

### Cover-cache has no bound → unbounded localStorage growth + stale churn (CONFIRMED)

- Problem: `openmusic:cover-cache:v1` is a flat `Record<string,string>` with three key families (uid:/artist:/name) and NO size cap and NO TTL (`src/lib/services/cover-cache.ts`). Over a long-lived install it grows without limit and accumulates expired CDN URLs that trigger the observe-dead → evict → re-resolve cycle (the cover bug cluster).
- Files: `src/lib/services/cover-cache.ts` (`writeKey` line 98 — no eviction).
- Improvement path: Add a TTL (store `{url, ts}`, treat entries older than e.g. 7–30 days as misses) and/or an LRU cap (~2000 entries). This proactively expires soon-dead URLs instead of waiting for a broken paint, directly attacking the largest recurring bug class. MEDIUM effort, HIGH impact (perf + correctness).

### Prefetch probe walk network/CPU cost (SUSPECTED — bounded but real)

- Problem: `prefetchNext()` walks up to `PREFETCH_MAX_CANDIDATES = 4` (`player.svelte.ts:158`) queue entries, RESOLVING each (a proxy detail call) AND silent-probing each with an offscreen muted `<audio>` test-play up to `PROBE_TIMEOUT_MS = 1500` (line 163). On a queue with several dead sources, one advance can cost ~4 detail fetches + 4 probe elements. It IS gated (arms once per src after 5s of real playback, `PREFETCH_PLAYBACK_DELAY_MS`) to avoid bot-burst patterns — that gate is a deliberate correctness feature, not a bug.
- Files: `src/lib/stores/player.svelte.ts` (`prefetchNext`, `PREFETCH_*`/`PROBE_*` constants lines 152–163).
- Improvement path: Already well-bounded; likely fine. If profiling shows probe-element churn matters on low-end Android, consider caching per-uid probe verdicts for the session (some session dead-uid tracking already exists — extend it to cache PASS verdicts too). LOW priority — do not touch without profiling; the caps exist for a reason.

### lazyCover per-row `Image()` probe on every cache HIT (SUSPECTED — minor)

- Problem: On a cache hit, `lazyCover` still constructs `new Image()` to probe the cached URL before painting (`src/lib/actions/lazyCover.ts:57–60`, the self-heal). This is one extra image load per visible row even when the cache is warm and healthy.
- Files: `src/lib/actions/lazyCover.ts`.
- Improvement path: The probe is what makes stale covers self-heal, so it can't be removed outright — but if the cover-cache gains a TTL (above), warm-and-fresh entries could skip the probe entirely (probe only entries near expiry). LOW–MEDIUM effort, LOW–MEDIUM impact. Couple this with the cover-cache TTL work.

### Bundle size (CONFIRMED — NOT a concern)

- The dependency tree is lean: 8 runtime deps, all Capacitor/lucide/blob-writer (`package.json`). No bundler bloat, no lodash/moment, Svelte 5 runes throughout. No action needed. The largest source files are the player store + `NowPlaying.svelte` (1652 lines) and the 15 i18n locale files (~363 lines each) — the i18n dicts are data, not logic, and are the natural candidate for lazy-loading per-locale if bundle size ever becomes an issue (currently fine).

### localStorage write frequency (CONFIRMED — already handled)

- Player `currentTime` persistence is correctly throttled to ~2s (`persistThrottled`, `player.svelte.ts:354`) with an immediate `flushPersist` on hide/freeze/pagehide (line 369) to avoid stale-position-on-eviction. Settings use explicit user-triggered `save()` (not high-frequency). No throttling gap found — this is done right.

---

## Test Coverage Gaps

### On-device playback lifecycle (CONFIRMED — inherent gap)

- What's not tested: iOS/Android background audio, autoplay-policy rejection ordering, lock-screen resume, headphone-unplug behavior. The 161-case `player.svelte.test.ts` covers all the PURE logic (state machine, generation guards, dedupe) but the fragile part — real `<audio>` event ordering under backgrounding — runs only on device.
- Files: `src/lib/stores/player.svelte.ts` (all `attach()` listeners).
- Risk: A change that passes CI can still break mobile playback (has happened: `player-displayed-defer-broke-mobile`).
- Priority: High awareness, but not fixable by more unit tests — the mitigation is the Activity Log diagnostic (already built) + on-device verify checkpoints.

### No jsdom/client test project (SUSPECTED)

- What's not tested: `.svelte` component rendering. `vite.config.ts` defines ONLY a `node` project — `.svelte.test.ts` files run headless as pure logic; there is no jsdom project, so component-level DOM behavior (gesture actions bound to real elements, NowPlaying reactivity) is untested at the component level.
- Files: `vite.config.ts` (single `node` project, comment at lines 12–17 acknowledges "No jsdom client project exists").
- Risk: Gesture/reactivity regressions in `.svelte` components slip past CI.
- Priority: Medium — action-level logic IS tested (`coverSwipe.test.ts`, `dragReorder.test.ts`, etc.); the gap is the component wiring.

---

## Prioritized Optimization Backlog

Ranked by leverage (impact ÷ effort). Each is concrete and ready to feed `/gsd:quick` or `/gsd:plan-phase`.

| # | Optimization | Impact | Effort | Files | Notes / feed-to |
|---|--------------|--------|--------|-------|-----------------|
| 1 | **Edge-cache the core CN metadata proxy** (search + detail) via `caches.default` + `Cache-Control`, mirroring the Deezer route | HIGH | MED | `src/routes/api/[source]/[...path]/+server.ts:48`, pattern from `src/routes/api/deezer/search/+server.ts:30` | Biggest upstream-load + search-latency win. Short TTL for search (~5–15m), shorter/none for detail (URLs expire). `/gsd:quick` |
| 2 | **Add TTL + LRU cap to cover-cache** (store `{url,ts}`, expire >7–30d, cap ~2000) | HIGH | MED | `src/lib/services/cover-cache.ts:98` (`writeKey`), tests in `cover-cache.test.ts` | Proactively kills the recurring stale-cover bug class (8+ quick tasks) + bounds localStorage growth. `/gsd:quick` or a small `/gsd:plan-phase` |
| 3 | **Extract failover/never-stop slice out of `player.svelte.ts`** into a composed `.svelte.ts` | HIGH | HIGH | `src/lib/stores/player.svelte.ts` (`runFallback`/`handleTotalFailure`/strike maps/counters) | De-risks the #1 regression hotspot. Do first slice of the god-object split; keep public API. `/gsd:plan-phase` |
| 4 | **Rewrite stale `CLAUDE.md` / `AGENTS.md`** to the SvelteKit reality | MED | LOW | `CLAUDE.md`, `AGENTS.md` | Use the fresh `.planning/codebase/` docs as source of truth. Prevents agents editing the phantom `index.html`. `/gsd:quick` |
| 5 | **Batch/coalesce `bumpCoverVersion`** (one bump per frame) OR move to per-key `SvelteMap` reactivity | MED | MED | `src/lib/stores/cover-version.svelte.ts:38`, `src/routes/(app)/+page.svelte` | Cuts home-grid re-render fan-out on cold loads. `/gsd:quick` |
| 6 | **Delete orphan `/spike` route** | LOW | LOW | `src/routes/spike/+page.svelte`, comment in `src/routes/+layout.svelte:17` | Pure dead-code removal. `/gsd:quick` |
| 7 | **Extract persistence slice** (`serializeTrack`/`persist`/`restore`/`flush`) from player | MED | MED | `src/lib/stores/player.svelte.ts:312–470` | Second god-object slice; smaller/safer than #3. `/gsd:plan-phase` |
| 8 | **Skip lazyCover `Image()` probe for warm+fresh cache entries** (requires #2 first) | LOW-MED | LOW-MED | `src/lib/actions/lazyCover.ts:57` | Removes an image load per warm visible row. Depends on cover-cache TTL landing first. `/gsd:quick` |
| 9 | **Add a jsdom/client vitest project** for component-level tests | MED | MED | `vite.config.ts` | Closes the `.svelte` component-render coverage gap. `/gsd:plan-phase` |
| 10 | **Session-cache prefetch probe PASS verdicts** (only if profiling shows Android cost) | LOW | LOW-MED | `src/lib/stores/player.svelte.ts` (`prefetchNext` + dead-uid tracking) | Do NOT touch without profiling; caps already bound the cost. Lowest priority. |

---

## Backlog progress (updated 2026-07-04)

- **#1 Edge-cache CN search proxy — DONE** (quick-260704-2os, commits 1bf4094/4e95c94). Search path only; url/detail/lrc stay uncached.
- **#2 Cover-cache TTL + LRU — DONE** (quick-260704-2xq, commits 146d314/e31afa4). `{u,t}` shape, 14d TTL, 2000-entry cap, legacy grandfathered.
- **#4 Rewrite stale CLAUDE.md/AGENTS.md — DONE** (quick-260704-3df, commit 4496315). Mechanical GSD-block resync from this map; index.html refs 74→1 each. NOTE: `/gsd:docs-update` does NOT touch these files (it targets README + docs/*.md) — the resync was a direct block-edit.
- **#6 Delete orphan /spike — DONE** (quick-260704-3ac, commit 83e3de3).
- **#7 Extract persistence slice — DONE** (quick-260704-3ov, commits d03db26/b8831fb, --validate/verified 6/6). Pure `player-persist.ts`; player.svelte.ts 3017→2972; 161-case suite green with zero edits.
- **#3 Extract failover/never-stop slice — DEFERRED to `/gsd:plan-phase`** (decision 2026-07-04). Recon found NO clean pure core: `unplayableUids` is a reactive `SvelteSet` (UI ✗ row), `runFallback` cycles back into `play({fromFallback})`, the burst/strike counters are spread across `attach()` listeners + `play()`/`next()`/stall-watchdog, and it owns a playGen-bound AbortController. A quick extraction would need a `.svelte.ts` sub-store with a bidirectional Player back-reference (more coupled, not less) AND touches the un-CI-testable iOS/Android background-audio state machine (regressed twice: `player-displayed-defer-broke-mobile`, foreground-resume removed in 260703-i7e). Phase-sized + fragile → needs full plan-phase treatment (research + plan-check + wave + verifier + on-device UAT). Do NOT attempt as a bare quick task.
- **#5 batch bumpCoverVersion — DONE** (quick-260704-45c, commits f673cfb/14b9dd2). rAF-coalesced to one increment per frame + node/SSR sync fallback.
- **#8 skip warm lazyCover probe — DONE** (quick-260704-4fr, commits d85f6d7/1d27986/fe405e6/5f8f76a). New pure `coverAgeByUidOrName` reader; lazyCover skips the `new Image()` probe when a cache hit's age < FRESH_MS=24h (null age ⇒ probe path, self-heal preserved).
- **#9 jsdom/client test project**, **#10 session-cache probe verdicts** — still open.

**Discovered during #8 (not yet fixed):** a pre-existing literal NUL byte (`\x00`) in `src/lib/actions/lazyCover.ts` `inFlightKey` (the `name:${artist}\x00${title}` de-dupe separator) makes git treat the file as binary (no line diffs). Cosmetic/robustness only — the key is never rendered or networked; tests + svelte-check pass. Worth a one-char fix (swap `\x00` for a printable separator + a fixture) in its own task.

---

*Concerns audit: 2026-07-03 (backlog progress appended 2026-07-04)*
