# Phase 31: Faster, smoother playback — Research

**Researched:** 2026-08-09
**Domain:** Client playback engine (Svelte 5 runes store) + Cloudflare Workers edge cache (SvelteKit adapter-cloudflare)
**Confidence:** HIGH (codebase facts read in full, line-verified); MEDIUM on Cloudflare Cache API production-only semantics (cited docs, not live-probed)

## Summary

This phase is **not** a greenfield feature. Every one of the 19 locked decisions lands inside machinery that already exists, is already bounded, and is already regression-tested by 197 passing tests in one file (`player.svelte.test.ts`). The work is surgical edits at ~8 identified sites plus **one new edge route pair** — not new subsystems. The highest-value thing a planner can do is route each decision through the *existing* seam rather than adding a parallel one: `driveSrc()` is already the single `audio.src` authority, `apiFetch` is already the single client fetch governor, `emitSkipNotice()` is already the batched skip-toast channel, `edgeCache()`/`ownOriginCacheKey()` are already the single Cache API seam, `downloadTrack()` is already the single download orchestration, and `scheduleRetryResolve()` is already the bounded backed-off retry.

Two things in this phase are genuinely new and carry the risk: **(a)** the edge cache (D-06..D-11), whose failure path is the *primary* path per D-11 and which needs a `delete` method that the current `EdgeCache` interface does not declare and a `waitUntil` that `src/app.d.ts` does not type; and **(b)** the D-15/D-16 loosening of the strike/skip policy, which increases retry work per failing track inside a system whose three documented freeze classes were each caused by exactly that kind of unbounded retry work. D-17 already flags this; the research below identifies precisely which guard becomes load-bearing (`SYSTEMIC_SKIP_CAP=5`, which is the only *cross-track* bound) and what a regression looks like.

The broken-download bug (D-12/D-13) has a clean, small fix with one non-obvious trap: reusing `downloadTrack()` verbatim for the "quietly re-download in the background" step would pop a visible browser file-save dialog and a library spinner, because it ends in `saveBlobToDisk()`.

**Primary recommendation:** Add a blob-provenance flag set inside `driveSrc()` (it is already the single choke point and already takes the uid), gate all three IDB reads behind a shared `readGoodBlob(uid)` helper that does the D-13 size check, model the new `/api/resolve` route on `api/deezer/search/+server.ts` (the JSON-cache template, not the streaming `/api/og` one), and treat `SYSTEMIC_SKIP_CAP` as the phase's load-bearing safety net — do not touch it, and add a test that proves it still trips after D-15/D-16 land.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cold-resolve latency**
- **D-01:** Leave `RESOLVE_WATCHDOG_MS` at 6000. Do NOT retune timeouts — the win comes from pre-warming, not from failing over sooner.
- **D-02:** No hedged/parallel source racing. The kuwo-first serial resolve from Phase 26 stands.
- **D-03:** Pre-warm (speculative resolve before the tap) on exactly two triggers: **the top search result when results render**, and **long-press / track-menu open**. Explicitly NOT scroll-into-view — that shape caused the `api-fetch-flood-freeze` class of bug.
- **D-04:** Keep the optimistic UI swap exactly as-is. Do not gate the now-playing swap on the `playing` event — that was tried, froze mobile playback, and was reverted.
- **D-05:** Phase 26's ~3-call floor is a *waste* target, not a hard cap. Spending 1–2 extra calls to make a play feel instant is an accepted trade.

**Edge cache**
- **D-06:** Cache **all three layers**: (a) `name+artist → songid` lookup, (b) resolved audio URL, (c) source-availability hints ("kuwo has it, netease is dry").
- **D-07:** Store = **Cache API (`caches.default`)** inside the Worker — the pattern already proven by `/api/og` (1698ms → 2ms). **No new binding.** `open-music-db` (D1) and `open-music-audio` (R2) exist but stay unused; no KV is created.
- **D-08:** The cache is **advisory, never authoritative.** User's words: *"update audio url if fail, and even if cache fails, run client resolver after that and update cache. the goal is to serve songs asap with retry."* A miss OR a stale hit must fall through to the client resolver silently, then repair the entry.
- **D-09:** Invalidation = **bust on playback failure.** The client reports a dead entry so the edge drops/refreshes it. Requires a new report endpoint.
- **D-10:** Cache is **shared globally** across all users.
- **D-11:** **Accepted risk, must be designed for:** a globally-shared audio URL can be IP- or region-bound and will 403 for some other user. D-08 + D-09 are the mitigation, which means **the failure path is the load-bearing part of this feature, not an edge case.** Plan and test it as the primary path, not the exception.

**Broken-download recovery**
- **D-12:** A blob-sourced playback error means: **evict the blob + the download record → re-resolve over the network and keep playing → quietly re-download in the background** so offline works next time. Self-repairing.
- **D-13:** Add a **cheap size/type sanity check when reading a blob from IDB** — reject zero-byte or absurdly small blobs before ever attaching them to `<audio>`.
- **D-14:** Surface it: **one toast** ("download was corrupted, streaming instead") plus a `logAction` entry for Settings → Activity log.

**Next-song failure policy**
- **D-15:** A failed next track gets a **cross-source re-resolve before being skipped**. A track that fails on kuwo often plays on qq; silently dropping it is the actual complaint.
- **D-16:** Strikes get **more forgiving on both axes**: raise `STRIKE_CAP` above 2 **and** clear a track's strikes more eagerly (on network recovery / return to foreground), so a tunnel or Wi-Fi blip cannot blacklist half the queue for the session.
- **D-17:** **Tension to manage (flagged, not a blocker):** D-15 and D-16 both increase retry work per failing track — exactly the churn `STRIKE_CAP` was introduced to bound. The rapid-fire brake (`RAPID_ERROR_CAP=3`), the `FAILURE_CAP` error ceiling, and `SYSTEMIC_SKIP_CAP=5` must remain intact and become the real backstop. Verify no regression against the three known freeze classes before this ships.
- **D-18:** A skip is **surfaced with a toast** ("Couldn't play X — skipped"), not silent. Part of the complaint is not knowing a skip happened.
- **D-19:** Lookahead stays at **next-1 only**. Do not deepen the prefetch walk.

### Claude's Discretion

- The blob-vs-URL error signal. Either record it in `driveSrc()` (the existing single `audio.src` authority) or test the `blob:` prefix at error time — planner picks after reading the full error handler.
- Exact new `STRIKE_CAP` value and the precise strike-clearing trigger.
- Cache key shape, TTLs, and the report-endpoint contract.
- Toast copy and dedupe policy when several tracks fail in a row.

### Deferred Ideas (OUT OF SCOPE)

- **Verify blobs at download time** so a corrupt download never enters the library at all — Phase 29 territory. This phase only repairs at playback time.
- **Scroll-into-view pre-warming** — highest hit rate, explicitly rejected for this phase (it is the shape that caused `api-fetch-flood-freeze`).
- **Hedged parallel source resolve** (fire source #2 after ~1.5s) — rejected in favour of pre-warming.
- **Deeper prefetch lookahead (next-2)** — D-19 keeps it at next-1.
- **Marking failed tracks in the Up Next list** (dimmed / warning state) instead of a toast — deferred in favour of D-18's toast.
</user_constraints>

## Project Constraints (from CLAUDE.md)

Directives the planner MUST honour. These carry the same authority as locked decisions.

| # | Directive | Consequence for this phase |
|---|-----------|---------------------------|
| C-01 | **Svelte 5 runes mode is FORCED.** No `export let`, no `$:`. | Any new store field is `$state<T>(init)`. |
| C-02 | **Internal loop-guard counters use PLAIN class fields, NOT `$state`.** | New blob-provenance flag, new strike counters, new cache-hit markers → plain fields. Only UI-read state is `$state`. |
| C-03 | **Runes files must be `*.svelte.ts` / `*.svelte`; pure logic stays `.ts`.** | A new edge-cache *client* helper is a pure `.ts` in `$lib/services/`. |
| C-04 | **Stores emit `TranslationKey`, never localized text.** | D-14/D-18 toasts must go through `player.notice` (or `toast` with a `t()` call at the UI layer), never a hardcoded English string in the store. |
| C-05 | **`src/lib/i18n/*.ts` uses DOUBLE QUOTES for every key AND value; all 16 dictionaries must expose an IDENTICAL key set** (`i18n.test.ts` guards parity, `en` is the reference). | Any new toast key = 16 file edits. Non-negotiable, and a compile error if `en` gains a key others lack. |
| C-06 | **Tabs for indentation. Single quotes in TS/JS except i18n.** | — |
| C-07 | **Zero `as any` in production source** (all existing ones are in tests). Prefer `satisfies` / `as const`. | The `EdgeCache` widening must be a proper interface extension, not a cast. |
| C-08 | **High comment density is the house style; comments are load-bearing decision records tagged with quick-task IDs or decision refs (`D-09`, `PLAY-08`, `COVER-01`).** Never remove an existing decision-ref comment. | Every new site gets a `D-NN` (phase-31) tagged comment. |
| C-09 | **Generation guards:** every async path snapshots a monotonic counter before the first `await` and re-checks after **every** `await`. | The pre-warm resolve, the cache-report call, and the background re-download all need this or a documented reason they don't (fire-and-forget with no state write). |
| C-10 | **Never-throw services:** data/enrichment services map every rejection to a null/empty sentinel at the exported boundary. | The edge-cache *client* must return `null` on any failure. D-08 depends on this literally. |
| C-11 | **SSR / browser guards:** anything touching `localStorage`/`window`/`document`/`Image`/`IntersectionObserver` early-returns under `!browser`. | The app is `ssr=false` app-wide but stores still guard. |
| C-12 | **`pnpm check` (svelte-check) is the ONLY quality gate.** No prettier/eslint/biome. | Type errors are the lint. |
| C-13 | **Secrets live only in `platform.env`, injected edge-side.** | No new secret needed for this phase. |
| C-14 | **CORS via the single seam `src/hooks.server.ts`** — never `*`. | New `/api/*` routes inherit CORS automatically; do NOT hand-roll headers, but DO add an `OPTIONS` 204 export matching sibling routes. |
| C-15 | **GSD workflow enforcement:** file edits go through a GSD command. | — |

**Additional hard constraint discovered (not in CLAUDE.md, but in project memory and verified in code):**
- C-16: **A `+server.ts` may only export HTTP verbs.** A top-level non-verb `export function` 500s at request time and unit tests do NOT catch it (they import the module directly). Documented in-code at `src/routes/api/deezer/search/+server.ts:12-13`. Shared helpers go in `$lib/proxy/*.ts` or `$lib/services/*.ts`.

<phase_requirements>
## Phase Requirements

`phase_req_ids` is **null** — this phase has no mapped REQUIREMENTS.md IDs. The 19 locked decisions in CONTEXT.md are the requirement set. The planner should treat D-01..D-19 as the traceability keys and tag code comments with them (per C-08).
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pre-warm trigger detection (D-03) | Components (`search/+page.svelte`, `CompactRow`/`NowPlaying` longpress) | — | UI knows when results render / a menu opens. Stores must not observe scroll or focus. |
| Pre-warm execution (D-03) | Services (`catalog.ensureTrackDetails`) via the `apiFetch` governor | Player store (only if it needs a dedupe registry) | Resolve is a service concern; the governor already bounds it. Do **not** add a new throttle. |
| Edge resolve cache read/write (D-06, D-07) | **API / Backend** — new `+server.ts` under `src/routes/api/` | — | `caches.default` exists only in the Worker runtime. It is `undefined` in the browser and `null` under `vite dev`. |
| Cache-first lookup on the client hot path (D-08) | Services (`catalog.ts` `ensureTrackDetails`) | — | The single seam every resolve caller funnels through (play / prefetch / warmAfter / download / fallback). |
| Cache bust report (D-09) | Player store detects → Services client → **API / Backend** deletes | — | Only the Worker can call `cache.delete`. The client can only POST a report. |
| Blob sanity check (D-13) | Services (`blob-store.ts` `get`, or a wrapper) | Player store (three call sites) | Put it at the read boundary so all three sites inherit it — the lazy fix IS the root-cause fix. |
| Blob-vs-URL provenance (D-12) | Player store (`driveSrc`) | — | `driveSrc()` is already the single `audio.src` authority and already receives the uid. |
| Blob eviction + re-download (D-12) | Player store orchestrates → `library.removeDownload` + `blobStore.del` + a **silent** variant of `downloadTrack` | — | Download acquisition already lives in `download-track.ts`. |
| Strike / skip policy (D-15..D-18) | Player store | Services (`fallback.tryFallback` for the cross-source retry) | Already there; this is a policy edit, not new code. |
| Toasts (D-14, D-18) | Player store emits `TranslationKey` → `(app)/+layout.svelte` host renders via `t()` | i18n (16 dictionaries) | C-04 + C-05. |

## Standard Stack

**No new packages.** This phase adds zero dependencies. Everything it needs is already installed or is a platform API.

### Already-installed / platform primitives this phase uses

| Thing | Version / source | Purpose | Why it's the right choice |
|-------|------------------|---------|---------------------------|
| `@sveltejs/adapter-cloudflare` | `7.2.8` (devDep, verified in `package.json`) | Supplies `platform.ctx` / `platform.caches` at the edge | Already the default adapter (`svelte.config.js` dual-adapter switch). [VERIFIED: `node_modules/@sveltejs/adapter-cloudflare/ambient.d.ts`] |
| Cloudflare **Cache API** (`caches.default`) | Workers runtime, `compatibility_date: 2026-06-05` | The D-07 store | Already proven in-repo across 11+ `/api/*` routes via `$lib/proxy/edge-cache.ts` |
| `@cloudflare/workers-types` | `4.20260605.1` (devDep) | `ExecutionContext` type for the `waitUntil` typing | Already in `tsconfig.json` `types` array |
| `$lib/proxy/edge-cache.ts` | in-repo | `edgeCache()` + `ownOriginCacheKey()` | The **single** `typeof caches` guard in the repo (`quick-260713-mqv`). Must be extended, not bypassed. |
| `$lib/services/api-base.ts` `apiFetch` | in-repo | The governed client fetch seam | D-03's speculative traffic and D-09's report call MUST route through it |
| `$lib/services/blob-store.ts` | in-repo (IndexedDB + Capacitor Filesystem) | D-13 read point | Never-throws contract already holds |
| `$lib/services/download-track.ts` `downloadTrack()` | in-repo | D-12 background re-download | ⚠️ See Pitfall 4 — needs a silent mode |
| `$lib/services/fallback.ts` `tryFallback()` | in-repo | D-15 cross-source retry | Already kuwo-first, already `attempted`-bounded, already never-throws |
| Vitest | `^4.1.3` (resolved `4.1.8` at run time) | Test harness | Single `node` project, no jsdom |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| `caches.default` | Cloudflare KV | Global replication (fixes the per-PoP miss rate), but is a new binding + a Pages config change | **Rejected by D-07.** Do not re-open. |
| `caches.default` | The existing unused `open-music-db` D1 | Queryable, global, but a new binding + schema + a config change | **Rejected by D-07.** Do not re-open. |
| A new client throttle for pre-warm | `apiFetch` governor | The governor already dedupes identical concurrent GETs and caps concurrency at 8 | Use the governor. A second throttle is exactly the "composing, individually-bounded loops" pattern that caused `api-fetch-flood-freeze`. |
| `blob:` prefix sniff at error time | Provenance flag in `driveSrc()` | Sniffing `this.audio.src.startsWith('blob:')` is 1 line and needs no new state — BUT it cannot distinguish an **offline-download blob** (D-12 target: evict) from a **prebuffer blob** (`prebufferNext`, NOT a download, must not evict a library record that doesn't exist) | **Use the `driveSrc()` flag.** See Pitfall 3. |

**Installation:** none. Verify with `pnpm check && pnpm test` only.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** No `slopcheck` run is required. Every capability is served by an already-installed dependency or a platform API. If the planner finds itself reaching for a new npm package, that is a signal the ladder was skipped: re-check `$lib/services/` first.

## Architecture Patterns

### System Architecture Diagram (this phase's data flow)

```text
                          ┌──────────────── PRE-WARM (D-03) ───────────────┐
                          │ search results render → top row                │
                          │ longpress / TrackMenu open                     │
                          └───────────────────┬────────────────────────────┘
                                              │ (dedupe by uid, fire-and-forget)
  USER TAP ─────────────────────┐             ▼
                                ▼      ensureTrackDetails(track, signal)
                    player.play(track)         │  ($lib/services/catalog.ts)
                                │              │
              ┌─────────────────┴──────┐       │  ┌── NEW (D-06/D-08) ──────────────┐
              │ library.isDownloaded?  │       ├─▶│ GET /api/resolve?k=<matchKey>   │
              │  YES → blobStore.get   │       │  │  edge: caches.default lookup    │
              │   └─ D-13 size check ──┼─ bad ─┤  │  HIT  → {songid,url,avail}      │
              │   └─ good → driveSrc(  │       │  │  MISS → 204/empty (never block) │
              │        uid, blob:URL,  │       │  └──────────────┬──────────────────┘
              │        fromBlob:TRUE)  │       │                 │ advisory only
              └────────────────────────┘       │                 ▼
                                               └──▶ SOURCES[src].resolve()  (kuwo-first)
                                                             │
                                                             ▼
                                              driveSrc(uid, cdnURL, fromBlob:FALSE)
                                                             │
                                     ┌───────────────────────┴──────────────────────┐
                                     ▼                                              ▼
                              audio `playing`                              audio `error`
                          (resets EVERY counter)                                    │
                                                          ┌─────────────────────────┴──────────────┐
                                                          │ 1. RAPID/ABSOLUTE CEILING (:1660)      │
                                                          │    rapidErrorBurst>=3 || errorBurst>=5 │
                                                          │      → strike + failoverSkips++        │
                                                          │      → SYSTEMIC_SKIP_CAP? STOP : next()│
                                                          │ 2. NEW (D-12): lastSrcWasBlob?         │
                                                          │      → blobStore.del + removeDownload  │
                                                          │      → toast + logAction               │
                                                          │      → reresolve over network          │
                                                          │      → silent background re-download   │
                                                          │ 3. NEW (D-09): lastSrcWasEdgeCached?   │
                                                          │      → POST /api/resolve/report        │
                                                          │         (edge: cache.delete)           │
                                                          │ 4. seek window → reresolveCurrent      │
                                                          │ 5. hasPlayedSinceSrc → 1 reresolve     │
                                                          │ 6. → runFallback (cross-source)        │
                                                          │      exhausted → handleTotalFailure    │
                                                          │        → emitSkipNotice + next()       │
                                                          └────────────────────────────────────────┘
```

Everything above the `NEW` markers already exists and is tested. The phase adds four boxes and one edge route pair.

### The four code sites that matter — precise structure

#### 1. `src/lib/stores/player.svelte.ts` (3625 lines)

**Tunable constants (all `private static`, all mirrored by hand in the test file — see Testing):**

| Line | Constant | Value | Bounds |
|------|----------|-------|--------|
| 159 | `FAILURE_CAP` | 5 | Dual-purpose: (a) `consecutiveFailures` loop-guard, (b) the **absolute** raw-`audio.error` ceiling per track since the last real `playing` |
| 182 | `SYSTEMIC_SKIP_CAP` | 5 | **CROSS-TRACK.** Consecutive failure-driven auto-skips with zero real `playing` in between. The ONLY whole-queue bound. → `haltRunawayRecovery()` (STOP) |
| 190 | `RAPID_ERROR_WINDOW_MS` | 400 | Two `error` events closer than this = a synchronous re-attach storm, not two network failures |
| 195 | `RAPID_ERROR_CAP` | 3 | Consecutive sub-400ms errors tolerated before force-skip |
| 202 | `PREFETCH_PLAYBACK_DELAY_MS` | 5000 | Elapsed real playback before the timeupdate gate arms `prefetchNext()` |
| 208 | `PREFETCH_MAX_CANDIDATES` | 4 | Queue entries the prefetch walk may step through per invocation |
| 213 | `PROBE_TIMEOUT_MS` | 1500 | Silent muted test-play deadline |
| 232/233 | `SRC_REDRIVE_WINDOW_MS` / `SRC_REDRIVE_CAP` | 1500 / 4 | Same-uid `audio.src` re-drive storm → `haltRunawayRecovery()` (STOP). Catches the case where `<audio>` *cancels* before firing `error`, so `errorBurst` never climbs |
| 626 | `SEEK_ERROR_WINDOW_MS` | 1500 | An error within this window of a seek → same-track re-resolve, not cross-source |
| 640 | `STALL_TIMEOUT_MS` | 15000 | Initial-load stall watchdog |
| 652 | `RESOLVE_WATCHDOG_MS` | **6000** | **D-01 — DO NOT TOUCH** |
| 830 | `STRIKE_CAP` | **2** | **D-16 raises this.** Confirmed definitive failures before a uid is promoted to `unplayableUids` |
| 840 | `RETRY_RESOLVE_MAX` | 2 | Delayed backed-off re-resolves per uid before it is finally allowed to die |
| 844 | `RETRY_RESOLVE_DELAY_MS` | 4000 | Base delay; backs off linearly `delay * (attempt+1)` |

**The three blob reads (D-12/D-13 targets) — all three currently handle a *missing* blob correctly and a *bad* blob not at all:**

| Site | Lines | Shape | Note |
|------|-------|-------|------|
| `restore()` | **491–493**, attach at **511–525** | `if (library.isDownloaded(target.uid)) offlineBlob = await blobStore.get(...).catch(() => null)` then `audio.src = src` | ⚠️ **`restore()` sets `audio.src` DIRECTLY at :525 — it does NOT go through `driveSrc()`.** A provenance flag set only inside `driveSrc()` would be unset on the restore path. The planner must either route restore through `driveSrc()` (behaviour change: the redrive brake would now apply to restore) or set the flag at both sites. |
| `reresolveCurrent()` | **568–575**, attach via `driveSrc` at **582** | Re-reads the SAME blob and re-attaches it | **This is the bug.** A corrupt blob → error → `reresolveCurrent()` → same corrupt blob → error → ceiling → strike → skip. Nothing distinguishes bad bytes from a bad URL. |
| `play()` | **2532–2603** (early-return offline branch, blob get at **2533**) and **2713–2720** (post-resolve branch) | Two separate reads. The early branch sets `this.audio.src = this.cachedBlobUrl` **directly at :2568** (also bypassing `driveSrc`); the post-resolve branch goes through `driveSrc` at :2750 | Same direct-assign caveat as `restore()`. |

Additionally at **2726–2731**: the *prebuffer* blob consume (`prebufferedUid`/`prebufferedBlobUrl` from `prebufferNext()`, lines 2327–2351). This is a `blob:` URL that is **NOT** a library download. Evicting a download record for it would be wrong (there is none) — this is the concrete reason the `blob:`-prefix sniff is the inferior discretion option.

**`driveSrc()` — 1176–1193.** Signature `private driveSrc(uid: string, url: string): boolean`. Returns `false` (and calls `haltRunawayRecovery()`) when the same uid is re-driven `SRC_REDRIVE_CAP` (4) times within `SRC_REDRIVE_WINDOW_MS` (1500). Every caller MUST bail on `false`. It already has both the uid and the url — adding a third param (`fromBlob: boolean`, or an options object) is a 1-line signature change with 2 call sites (`reresolveCurrent:582`, `play:2750`) plus the 2 direct-assign sites above that should be migrated.

**The `audio.error` handler — 1625–1778.** Structure, in order:

1. **1626–1633** — compute `willReresolve`, `logAction('audio.error', …)`, `disarmStall()`.
2. **1635–1691 — the ceiling block.** Checked **FIRST**, before any recovery. Updates `rapidErrorBurst` (1652), `lastAudioErrorAt` (1653), `errorBurst++` (1654). If `rapidErrorBurst >= 3 || errorBurst >= 5`: log `error.ceiling`, zero all three burst counters, break `repeat: 'one'`, `strikeUnplayable(current.uid)` (1679), then `if (++this.failoverSkips >= SYSTEMIC_SKIP_CAP) { haltRunawayRecovery(); return; }` (1685–1688), else `this.next()` (1689). **Note: this path calls `next()` with NO `emitSkipNotice()` — this is the D-18 gap.**
3. **1702–1706 — seek branch.** `Date.now() - lastSeekAt < 1500` → `reresolveCurrent()`, return.
4. **1718–1755 — `hasPlayedSinceSrc` branch.** Sub-branch **1734–1746**: `document.hidden` → `bg-error-skip` (strike + `next()`, again **no skip notice**). Else `reresolveBurst++`; `<= 1` → one in-place `reresolveCurrent()`; else log `reresolve.cap` and fall through.
5. **1756–1777 — cross-source.** `this.playing = false`, capture `failed = this.current`, `void this.runFallback(failed)` at **1777**.

**Where D-12's blob branch goes:** immediately after the ceiling block (so the ceiling still wins — never let a corrupt-blob path outrank the freeze guards) and **before** the seek branch. A corrupt blob is a definitive "these bytes are bad" signal, so it should not consume the seek or `hasPlayedSinceSrc` budgets.

**`strikeUnplayable()` — 854–863.** Increments `unplayableStrikes` map; at `>= STRIKE_CAP` logs `mark-dead` and adds to the reactive `unplayableUids` (SvelteSet, drives the dimmed ✗ Up-Next row). Returns `true` at cap.
- `clearStrike(uid)` — 868–870.
- `handleDefinitiveFailure(uid)` — 886–896: strike, and at cap, if delayed-retry budget remains, **undo** the promotion and `scheduleRetryResolve(uid)` instead.
- `scheduleRetryResolve(uid)` — 933–962: one timer per uid, budget `RETRY_RESOLVE_MAX=2`, linear backoff, re-reads `current`/`queue` at fire time, then `void this.prefetchNext()`.

**Strike-clearing points today (D-16 wants more):** the `playing` listener at **1467–1477** (`clearStrike` + `retriedDeadUids.delete` + `cancelRetryResolve` + `retryResolveAttempts.delete` for the current uid), `retryUnplayable()` at **3191–3197**, `advanceTo()` at **3222–3235**, `recoverFromStop()` at **3478–3498** (clears everything), `clearQueue()`.
**D-16's new triggers have obvious homes:** the `online` store already exposes `isOnline = $state(...)` with `online`/`offline` window listeners (`src/lib/stores/online.svelte.ts`), and `attach()` already registers a `visibilitychange` listener at **1401–1411** that currently does *nothing* on foreground return (deliberately — `quick-260703-i7e` removed foreground auto-resume because it caused unwanted playback). **Clearing strikes on foreground is safe there; re-issuing `play()` is not.** That distinction must be in the plan or someone will re-introduce the i7e bug.

**`prefetchNext()` — 2089–2213.** Walk from `indexOf(current)+1`, up to `PREFETCH_MAX_CANDIDATES=4` steps:
- skip `unplayableUids` members (2120);
- short-circuit an already-complete candidate (2124) else `ensureTrackDetails(cand, sig)` (2128) — a **throw** is transient, `continue` (2129–2134);
- `!resolved.audioUrl` → `handleDefinitiveFailure` (2142) — **this is D-15's first target: today it strikes with no cross-source attempt**;
- `probePlayable(url)` (2147) → hard `error` → `handleDefinitiveFailure` (2155) — **D-15's second target**; timeout → `scheduleRetryResolve` (2165);
- landed → write back by fresh uid lookup (2173–2177), `prewarmNextAssets`, `warmAfter()` (2188), return.
- Fell out without landing → `ensureAhead()` (2200–2202).
Guards: in-flight dedupe on `prefetchingUid` (2100), single `prefetchController` (2104), `seedUid` re-checked after **every** await, `finally` clears the claim (2205–2212).

`probePlayable()` — **2256–2307**. Muted offscreen `new Audio()`, races `canplay`/`loadeddata` vs `error` vs a 1500ms timer. **Degrades to `{ok:true}` when `Audio`/`Audio.prototype.addEventListener` is absent** (2260–2262) — this is what makes it node-testable.

`warmAfter()` — **2227–2243** (depth-2 pre-resolve, no probe). D-19 keeps this as-is.

**Never-stop advance machinery:** `nextPlayableIndex` 3166, `nextAdvanceIndex` 3206 (a dead-but-not-yet-retried uid is still a valid target), `advanceTo` 3222 (grants the one second chance), `next()` 3237–3257 (falls through to `ensureAhead().then(...)` when everything ahead is exhausted).

**Failure policy:** `runFallback` 3322–3388 (offline gate 3328, one-fallback-per-gen guard 3338, per-episode `attempted` set 3340–3348, `tryFallback` 3359, on success `play(swap, {fromFallback:true})`, on exhaustion `handleTotalFailure`), `handleTotalFailure` 3405–3431 (`consecutiveFailures++`, `failoverSkips++` → `haltRunawayRecovery` at cap, else `emitSkipNotice(failed.title)` + `next()`), `haltRunawayRecovery` 3448–3470 (aborts prefetch, cancels every retry timer, disarms stall, `pauseAudio()`, sticky Retry notice), `recoverFromStop` 3478–3498, `emitSkipNotice` 3506–3526 (batches within `SKIP_BURST_WINDOW_MS=2500` into one notice with a `count`).

#### 2. `src/lib/services/api-base.ts` (293 lines) — the governor

Three composed structural bounds at the one seam every `/api/*` client call passes through:

- **In-flight dedupe** (`inflight: Map<url, Promise<Response>>`, 170; used 251–265). **GET-only, body-less-only** (240–242). The shared fetch has the caller's `signal` **stripped** (254–255) so one caller's supersede-abort cannot cancel another's request; each caller gets an independent `resp.clone()` (283). Evicted as soon as the head settles (260–263).
- **Concurrency cap** `MAX_CONCURRENT_REQUESTS = 8` (55) with a FIFO waiter queue (`acquireSlot` 150, `releaseSlot` 159). Slot released when the response **head** arrives; the body streams after.
- **Per-request timeout** `REQUEST_TIMEOUT_MS = 25_000` (57).
- **Circuit breaker** (62–136): `CIRCUIT_FAILURE_THRESHOLD = 30` failures within `CIRCUIT_WINDOW_MS = 3_000` → OPEN for `CIRCUIT_COOLDOWN_MS = 10_000`. Two gates: a **hard-open fast-reject before taking a slot** (180) and a **re-check after the queue wait** (187, which is also the single half-open probe gate). A "failure" = network error, timeout, or 5xx/429. A **caller-abort is NEUTRAL** (210–212) — it neither trips nor closes. A 4xx is a **success** for breaker purposes (the upstream is alive, 203).
- Open-breaker rejection is a `DOMException(..., 'AbortError')` (134–136) so supersede-aware callers degrade rather than hard-fail.
- `__resetGovernor()` (140) is **TEST-ONLY** and exists precisely so a tripped breaker cannot leak between tests.

**How a new caller opts in:** just call `apiFetch(path, init)` instead of `fetch()`. Nothing else. `apiUrl()` handles the web-vs-native base. Note `apiFetch` takes an own-origin **path** (`/api/…`), never an absolute upstream URL.

**Explicit non-users (documented in-code, do not "fix"):** media byte fetches. `prebufferNext` (2341), `downloadTrack` (raw `fetch` of `r.audioUrl`), `blob-store.nativeGet`, and the edge-side `/api/og` image fetch all use raw `fetch` deliberately, each with a `// RAW fetch (not apiFetch — fetch→apiFetch audit)` comment. There is evidently an audit that greps for this comment; **any new raw fetch must carry it**.

#### 3. `src/lib/services/catalog.ts` (384 lines) — where the cache-first lookup slots in

`ensureTrackDetails(track, signal?, quality?)` — **288–336**:
1. **293–295** — readiness guard: `detailsLoaded && audioUrl && (lrc || !lrcUrl)` → return as-is. *A cache hit that populates `audioUrl` + `detailsLoaded` would make every downstream caller short-circuit — this is the mechanism that makes prefetch/pre-warm "free".*
2. **296** — `const sig = signal ?? new AbortController().signal` (the signal is always non-null downstream).
3. **304–307** — `resolveByName` branch → `resolveNameStub(artist, title, sig)` (kuwo-first single-source walk, 228–277). Returns the unresolved stub on total miss (never-throw).
4. **311** — `SOURCES[track.source].resolve(track, sig, quality)`.
5. **324–334** — bounded cross-source lyric backfill (`crossSourceLyric`, 349–384), gated on `resolved.audioUrl && !resolved.lrc && !LYRICLESS_SOURCES.has(source) && !sig.aborted`.

**Where the D-08 cache-first read goes:** between step 2 and step 3, i.e. right after the readiness guard and signal normalisation, *before* the `resolveByName` branch. A hit should synthesize a `Track` with `audioUrl`/`songid`/`detailsLoaded:true`; a miss/failure must return `null` and fall straight through (C-10, D-08).

**Where the cache *write* goes:** after step 4 succeeds with a truthy `audioUrl` — fire-and-forget, never awaited, never allowed to reject into the caller.

**AbortSignal threading:** already complete and disciplined. `sig` is threaded into `resolveNameStub` → `searchAll` → adapter → `apiFetch`, and into `SOURCES[].resolve`, and into `crossSourceLyric` → `searchAll`. Every loop re-checks `sig.aborted` after each `await` (261–275, 359–378). The new cache call must accept and honour the same `sig`.

**`searchAll` already has a 60-minute in-memory TTL cache** (`SEARCH_TTL_MS`, 65; `cached()` from `./ttl-cache`, 102–105), keyed `${normQuery}|${enabledSources}|${page}`. Its docstring explicitly says it caches **search metadata only — never resolved (short-lived) audio URLs**. D-06(b) deliberately breaks that rule at the *edge* layer; the phase should not also start caching URLs in the client TTL cache.

#### 4. `src/routes/api/og/+server.ts` (329 lines) — the `caches.default` template

**Cache key construction** — always via `ownOriginCacheKey()` from `$lib/proxy/edge-cache.ts`:
```ts
export function ownOriginCacheKey(url: URL | string): Request {
	return new Request(url.toString());
}
```
The invariant it encodes (T-09-05 / T-2os-02 / T-wv8-06): **the cache key must be the own-origin URL, NEVER a secret-bearing upstream URL.**

Two layers in `/api/og`:
- **Bytes layer**, key = the request URL as-is: `const bytesKey = ownOriginCacheKey(url)` (268), read at 269–276.
- **Resolve layer**, key = a **synthetic normalized own-origin URL** (298–300):
  ```ts
  const resolveKey = ownOriginCacheKey(
      `${url.origin}/api/og/_resolve?k=${encodeURIComponent(matchKey(artist, title))}&t=${type}`
  );
  ```
  `/api/og/_resolve` is **not a real route** — it is a pure key namespace. `matchKey()` normalization collapses query-order variants and the hyphen-for-space share loss into one entry. **This is exactly the shape D-06(a) needs** (`name+artist → songid`).

**Response cloning pattern** (`streamImage`, 213–230): `const streamed = new Response(upstream.body, {...})`, then `new Response(streamed.clone().body, {...})` goes to `cache.put` while the **original** streams to the client. The comment at 73–74 records that **`clone()` buffers the whole body**, hence `CACHE_BYTES_CAP = 3_000_000` and the `sized && len <= CAP` gate. For a small JSON resolve payload this is irrelevant — the `deezer/search` pattern (build a fresh `Response(JSON.stringify(...))` for the cache and return a separate one to the client, `84–93`) is simpler and is the better template for D-06.

**Cached copies are CORS-FREE by design (WR-01)**; the requesting origin's CORS is re-applied per hit (`withCors`, 115–124; `jsonResult(..., origin, ttl)` in deezer/search). Since `hooks.server.ts` also merges CORS onto every `/api/*` response, a new route gets CORS for free — but must still store a CORS-free body so a cross-origin hit never inherits a prior requester's `Access-Control-Allow-Origin`.

**Best-effort discipline:** every `cache.match` and `cache.put` is individually wrapped in `try/catch` that degrades to a miss / a skipped write (131–169, 225–229, 269–276). A broken Cache API never becomes a 5xx. **D-08 requires exactly this posture, extended to the resolve route.**

**Negative caching:** `/api/og` writes `null` for a clean all-tier miss (a genuine "does not exist") but writes **nothing** for an `'ERROR'` (a fault must be retried, not pinned for the TTL) — 310–315. **This maps directly onto D-06(c) source-availability hints:** "netease is dry" is a clean negative worth caching; "netease threw" is not.

**`ctx.waitUntil` — the gap.** `/api/og` does **not** use `waitUntil` today; every `cache.put` is `await`ed inline.

## Cloudflare Cache API under SvelteKit adapter-cloudflare — verified specifics

| Question | Answer | Evidence |
|----------|--------|----------|
| How to reach `caches.default` from a `+server.ts` | `edgeCache()` from `$lib/proxy/edge-cache.ts` — the **single** `typeof caches` guard in the repo. It returns `null` when `caches` is undefined. | [VERIFIED: `src/lib/proxy/edge-cache.ts:26-29`] |
| Why the local narrowing interface exists | The DOM lib's `CacheStorage` (pulled in by SvelteKit's generated tsconfig, `lib: ["esnext","DOM","DOM.Iterable"]`) does **not** declare `default` and **shadows** `@cloudflare/workers-types`' global. Hence a hand-written `EdgeCache` interface. | [VERIFIED: `edge-cache.ts:8-12` + `.svelte-kit/tsconfig.json`] |
| **`cache.delete` availability (D-09 blocker)** | The `EdgeCache` interface declares **only `match` and `put`**. `delete` must be added to the interface for D-09. This is a 1-line interface extension, not a cast (C-07). | [VERIFIED: `edge-cache.ts:13-16`] |
| How to reach `waitUntil` | `platform.ctx.waitUntil(promise)`. The adapter's ambient declares `ctx: ExecutionContext`, `context: ExecutionContext` (**deprecated** alias), `caches: CacheStorage`, `cf?: IncomingRequestCfProperties`. **Use `ctx`, not `context`.** | [VERIFIED: `node_modules/@sveltejs/adapter-cloudflare/ambient.d.ts`] |
| **`waitUntil` typing gap (D-06/D-09 blocker)** | `src/app.d.ts` re-declares `App.Platform` with **only `env`**, and the adapter's `ambient.d.ts` is **not** in `.svelte-kit/tsconfig.json`'s `include` list — so `platform.ctx` is currently **untyped**. `app.d.ts:21` even carries the comment `// ctx?: ExecutionContext;  // add if waitUntil() is needed for caching later`. **The planner must uncomment/add this line.** `ExecutionContext` comes from `@cloudflare/workers-types`, already in `tsconfig.json` `types`. | [VERIFIED: `src/app.d.ts:1-31`, `tsconfig.json`, `.svelte-kit/tsconfig.json`] |
| What is cacheable | **Only `GET`** requests can be a cache key — `cache.put` throws on any other method. `cache.put` also throws on status **206**, on `Vary: *`, on certain 301/302 mismatches, when `Cache-Control` says not to cache, or when the response is too large. `Set-Cookie` responses are not cached by default. | [CITED: developers.cloudflare.com/workers/runtime-apis/cache/] |
| `cache.delete` semantics | Returns `true` if an entry was cached and is now deleted, `false` if it was not cached. **"only purges content of the cache in the data center that the Worker was invoked."** | [CITED: developers.cloudflare.com/workers/runtime-apis/cache/] |
| Per-PoP semantics | "The Cache API is available globally but the contents of the cache do not replicate outside of the originating data center." | [CITED: developers.cloudflare.com/workers/runtime-apis/cache/] |
| `vite dev` (`pnpm dev`, port 4321) | `caches` global is **absent** → `edgeCache()` returns `null` → both layers are inert and every request hits live upstream. **This is by design and documented** (`/api/og` header comment, `edge-cache.ts:11-12`). **The cache is therefore unit-provable ONLY in `pnpm dev`.** | [VERIFIED: `edge-cache.ts:26-29`, `og/+server.ts:26-27`] |
| `wrangler pages dev` (`pnpm preview`, port 4173) | Wrangler v3+ runs Miniflare v3 on workerd, which **simulates** the Cache API. Cached data is in-memory by default (persists across reloads, not across Miniflare instances); `cachePersist` enables filesystem persistence, `disableCache` makes it a no-op. So `pnpm preview` **can** exercise a hit/miss cycle locally, unlike `pnpm dev`. | [CITED: blog.cloudflare.com/wrangler3, developers.cloudflare.com/workers/testing/miniflare/storage/cache/] |

**What per-PoP means for D-10 (globally shared) in practice:** the "shared globally" decision is shared-across-*users*, not shared-across-*PoPs*. A Hong Kong user's write does not help a Singapore user. Hit rate is therefore a function of per-PoP traffic density, which for a single-user-scale app may be low. **This is not a reason to re-open D-07** (that is settled) — it is a reason the plan should not promise a hit-rate number, and should make sure the miss path is genuinely zero-cost (a miss must not add a serial round-trip to the resolve; see Pitfall 6).

**The critical corollary for D-09:** because `cache.delete` is PoP-local, a bust report only heals the PoP the reporting client happened to hit. A user in a *different* PoP with the same poisoned entry will independently 403, independently report, and independently heal their own PoP. That is acceptable under D-08/D-11 (the client always falls through and keeps playing), but it means **the bust is a repair-on-encounter mechanism, not a purge.** The plan should say so explicitly so nobody later "fixes" it with a global purge that Cache API cannot provide.

### Recommended file layout for the new code

```text
src/lib/proxy/
├── edge-cache.ts          # EXTEND: add `delete(request: Request): Promise<boolean>` to EdgeCache
└── resolve-cache.ts       # NEW (pure, edge-side): key builders + read/write/bust helpers
                           #   (C-16: cannot live in +server.ts)
src/lib/services/
└── resolve-cache-client.ts # NEW (pure, client-side): never-throw apiFetch wrapper,
                           #   returns null on ANY failure (C-10 / D-08)
src/routes/api/resolve/
├── +server.ts             # NEW: GET (lookup) + POST (report/bust) + OPTIONS 204
└── resolve-endpoint.test.ts # NEW: mirrors og-endpoint.test.ts's stubCache harness
```

Note: a **single route with GET + POST** is cheaper than two routes and both verbs are legal exports (C-16). If the planner prefers separation, `api/resolve/report/+server.ts` is fine — but remember `POST` is never deduped by `apiFetch` (it only dedupes body-less GETs) and can never be a Cache API key.

### Pattern 1: Never-throw advisory cache client (D-08 / C-10)

**What:** every failure — miss, non-200, malformed JSON, abort, breaker-open — maps to `null` at the exported boundary.
**When to use:** the client-side read in `ensureTrackDetails`.
**Example** (the in-repo posture, from `deezer.ts`/`og/+server.ts` `readResolveCache`):
```ts
// Source: src/routes/api/og/+server.ts:131-144 (adapted to the client seam)
export async function readResolveCache(key: string, sig: AbortSignal): Promise<CachedResolve | null> {
	try {
		const resp = await apiFetch(`/api/resolve?k=${encodeURIComponent(key)}`, { signal: sig });
		if (!resp.ok) return null;
		return (await resp.json()) as CachedResolve;
	} catch {
		return null; // miss / abort / breaker-open — the caller resolves normally (D-08)
	}
}
```

### Pattern 2: Generation-guarded fire-and-forget (C-09)

Every new async path re-checks its snapshot after **every** await. The canonical form in this codebase:
```ts
// Source: src/lib/stores/player.svelte.ts:2227-2243 (warmAfter)
const myGen = this.playGen;
const resolved = await ensureTrackDetails(after, sig);
if (sig.aborted || this.current?.uid !== seedUid) return; // superseded — discard
```
For the D-12 background re-download the guard is different: it must **not** be `playGen`-guarded (the user has moved on by then and that's fine) but it must be **uid-keyed and deduped** so a repeated corrupt-blob error can't queue N downloads.

### Pattern 3: Cache-key namespacing via a synthetic own-origin URL

```ts
// Source: src/routes/api/og/+server.ts:298-300
const resolveKey = ownOriginCacheKey(
	`${url.origin}/api/og/_resolve?k=${encodeURIComponent(matchKey(artist, title))}&t=${type}`
);
```
Reuse `matchKey()` from `$lib/services/match-key` for D-06(a) so the lookup layer normalizes identically to the rest of the app (cover cache, dedupe, `crossSourceLyric` all use it).

### Anti-Patterns to Avoid

- **Adding a second throttle/dedupe for pre-warm traffic.** `apiFetch` already dedupes identical concurrent GETs and caps at 8. A second local bound composes into exactly the "individually-bounded loops that sum to unbounded" shape the governor's own header comment names as the root cause of `api-fetch-flood-freeze`.
- **A helper `export function` in a `+server.ts`.** 500s at request time; unit tests will not catch it (C-16).
- **Sniffing `audio.src.startsWith('blob:')` at error time.** Cannot distinguish a library download blob from a `prebufferNext` blob (`player.svelte.ts:2726-2731`). Use the `driveSrc` flag.
- **Setting the blob-provenance flag only inside `driveSrc()`.** `restore():525` and `play():2568` assign `audio.src` directly. Either migrate them or set the flag at all four sites.
- **Reusing `downloadTrack()` unchanged for the D-12 background re-download.** It ends in `saveBlobToDisk()` (a visible `<a download>` click) and brackets `library.beginDownload/endDownload` (a UI spinner). See Pitfall 4.
- **Localizing in the store.** D-14/D-18 must emit a `TranslationKey` (C-04). `player.notice` already carries `msg: TranslationKey` plus `count`/`title` interpolation slots.
- **Raising `SYSTEMIC_SKIP_CAP` "to match" the raised `STRIKE_CAP`.** D-17 is explicit: the cross-track ceiling must stay intact and becomes the real backstop.
- **Awaiting the cache write on the hot path.** Use `platform.ctx.waitUntil(cache.put(...))` so the client's response is not delayed by the write.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Throttling pre-warm / report traffic | A per-trigger debounce + counter | `apiFetch` (`$lib/services/api-base.ts`) | Already dedupe + cap-8 + 25s timeout + circuit breaker, all at the one seam |
| Cross-source retry for a failed next track (D-15) | A new source walk in `prefetchNext` | `tryFallback(failed, preferred, signal, attempted)` (`$lib/services/fallback.ts:90`) | Already kuwo-first via registry order, already `sameSongKey`-gated (WR-06 — a fuzzy search can return a *different* song), already `attempted`-bounded to kill the A↔B ping-pong, already never-throws |
| A bounded backed-off retry for a struck track | A new timer map | `scheduleRetryResolve(uid)` (`player.svelte.ts:933`) | Dedupe per uid, `RETRY_RESOLVE_MAX` budget, linear backoff, re-reads state at fire time, self-converges |
| Batching several skip toasts | A queue of toasts | `emitSkipNotice(title)` (`player.svelte.ts:3506`) | Already collapses N skips within 2500ms into ONE notice with a `count`, and clears the channel when the window closes (WR-04) |
| A `typeof caches` guard in the new route | `if (typeof caches !== 'undefined')` | `edgeCache()` (`$lib/proxy/edge-cache.ts:26`) | Explicitly the ONE guard in the repo (`quick-260713-mqv`); duplication here is a named CLAUDE.md anti-pattern |
| Building the cache key `Request` | `new Request(...)` inline | `ownOriginCacheKey(url)` | Encodes the never-key-on-a-secret-bearing-upstream-URL invariant |
| Name+artist normalization for the lookup key | A local lowercase/strip | `matchKey(artist, title)` (`$lib/services/match-key`) | Already the app-wide normalization (cover cache, dedupe, lyric fallback) |
| Detecting online/offline for D-16 | A new `navigator.onLine` poll | `online.isOnline` (`$lib/stores/online.svelte.ts`) | Runes singleton with `online`/`offline` listeners already wired |
| Foreground detection for D-16 | A new `visibilitychange` listener | The one already registered in `attach()` at `player.svelte.ts:1401` | One listener; it currently only flushes persist on hide |
| Blob eviction bookkeeping | Manual IDB + list surgery | `blobStore.del(uid)` + `library.removeDownload(uid)` | Both never-throw; `library.removeDownload` at `library.svelte.ts:185` |

**Key insight:** every recovery/bounding primitive this phase needs already exists and was each added in response to a specific production incident. The phase's job is to **re-route** decisions through them, not to add a parallel set. Every historical freeze in this codebase came from two independently-correct bounded mechanisms composing into an unbounded one.

## Runtime State Inventory

This is not a rename/refactor phase, but it **does** change runtime-persisted and edge-cached state, so the categories are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data (client) | **IndexedDB `openmusic-blobs` / store `tracks`**, uid-keyed audio Blobs. D-12 deletes entries. **localStorage `openmusic:library:v1`** — the `downloads: Track[]` reference list; D-12 removes entries. **localStorage `openmusic-blob-uri:<uid>`** — native-only MediaStore content URI index, cleared by `blobStore.del` on native. | Code edit only. **No migration needed** — eviction is the intended runtime effect, and both stores tolerate a missing entry (`isDownloaded` → false → normal network resolve). |
| Stored data (edge) | **NEW: `caches.default` entries** under the new `/api/resolve` key namespace. Written by this phase, read by this phase, PoP-local. | No migration. **Design the key with a version segment** (e.g. `…/_resolve?v=1&k=…`) so a future shape change is a key change, not a stuck-cache incident — `cache.delete` cannot purge globally. |
| Live service config | **Cloudflare Pages project `openmusic`**: production vars are `JAMENDO_CLIENT_ID` + secrets `JOOX_TOKEN`/`LASTFM_KEY`/`LASTFM_SECRET`. **No `d1_databases` / `r2_buckets` / `kv_namespaces` bindings.** `open-music-db` (D1, `a14554d5-7190-440a-b4f4-23ec93dfb4b4`) and `open-music-audio` (R2) exist unbound since 2026-05-09. | **None — and that is the point of D-07.** Cache API needs no binding, so this phase is a **pure code deploy**: no `wrangler.jsonc` change, no `wrangler pages secret put`. If a plan task proposes a binding, D-07 is being violated. |
| OS-registered state | None. No Task Scheduler / launchd / pm2 / systemd involvement. Verified: this is a browser + Cloudflare Pages app with a Capacitor Android shell; the only CI is `.github/workflows/android-*.yml`. | None. |
| Secrets / env vars | No new secret. `VITE_API_BASE` (build-time, native only) is unchanged. | None. |
| Build artifacts | None stale. The Android APK embeds `VITE_API_BASE=https://openmusic.lol`, so an **already-shipped APK will start hitting the new `/api/resolve` route as soon as the web deploy lands** — the route must therefore be additive and the client must tolerate its absence (a 404 → `null` → normal resolve, per D-08). | Verify the client's never-throw sentinel covers a 404. |

**Deployment order note:** because the native APK points at the deployed origin, **deploy the edge route before or with the client change**, and make the client tolerate the route not existing. D-08's never-throw contract already gives this for free if implemented correctly — but it should be an explicit verification step, not an assumption.

## Common Pitfalls

### Pitfall 1: D-15/D-16 dissolve the per-track bounds and leave only `SYSTEMIC_SKIP_CAP` standing

**What goes wrong:** D-16 raises `STRIKE_CAP` (2 → N) and adds strike-clearing on network recovery / foreground. D-15 inserts a cross-source `tryFallback` walk before a skip. Multiply: each failing track now costs `STRIKE_CAP × (1 resolve + 1 probe)` in the prefetch walk **plus** up to `RETRY_RESOLVE_MAX=2` delayed re-runs of that whole walk **plus** an N-source `tryFallback` (each source = 1 `searchAll` + 1 `ensureTrackDetails`). With `STRIKE_CAP=4` and 5 enabled sources that is on the order of 30–40 `/api/*` calls per dead track, up from ~6. Under a systemic outage (region lock, dead upstream) every track is a dead track.

**Why it happens:** `STRIKE_CAP`, `RETRY_RESOLVE_MAX`, `FAILURE_CAP` and `RAPID_ERROR_CAP` are all **per-track** bounds. Raising one and adding a retry loop multiplies work per track without touching any cross-track ceiling. The `api-fetch-flood-freeze` post-mortem in `api-base.ts:36-51` names this exact failure mode: *"Each subsystem is only LOCALLY bounded … they COMPOSE into an unbounded fetch flood."*

**The load-bearing guard, precisely:** **`SYSTEMIC_SKIP_CAP = 5`** (`player.svelte.ts:182`) is the **only** cross-track bound in the system. It counts consecutive failure-driven auto-skips with zero real `playing` in between and calls `haltRunawayRecovery()` — which is the only thing that *actually stops the spam at the source* (aborts the prefetch controller, cancels every pending `retryResolveTimers`, disarms the stall watchdog, pauses, and — critically — does **not** call `next()`, so nothing re-arms `ensureAhead`/`regenerate`/`prefetch`). Secondary, and also load-bearing: the `apiFetch` circuit breaker (30 failures / 3s → 10s cooldown) is the structural blast-radius cap that holds regardless of any player logic.

**How to avoid:**
1. **Do not change `SYSTEMIC_SKIP_CAP`, `RAPID_ERROR_CAP`, `FAILURE_CAP`, `SRC_REDRIVE_CAP`, or any circuit-breaker constant.** D-17 says this; make it an explicit plan constraint with a test.
2. Increment `failoverSkips` on every new skip path added by D-15/D-18 (the error-ceiling path already does at `:1685`; the `bg-error-skip` path at `:1744` does **not** — check whether that is intentional before copying it).
3. Bound D-15's cross-source retry by **reusing `runFallback`'s existing per-episode `attempted` set** rather than a fresh walk. `fallbackEpisodeKey`/`fallbackAttempted` (`:3340-3348`) guarantee each source is tried at most once per logical song.
4. Consider making the raised `STRIKE_CAP` modest (3) rather than large. The complaint D-16 addresses is "a Wi-Fi blip blacklists half the queue" — the *eager clearing* half of D-16 fixes that directly, at near-zero churn cost. The cap raise is the expensive half.

**Warning signs of a regression:** in the Activity log (Settings → Activity log), a run of `error.ceiling` / `mark-dead` / `advance` with no `playing` between and **no** terminating `recovery.halt`; or `recovery.halt` firing far later than 5 tracks in; or `src.redrive-brake` appearing (that means a same-uid re-drive storm got past the error-based ceilings). In DevTools: `/api/*` request count climbing monotonically while the nowbar sits on the loading line.

### Pitfall 2: `restore()` and the offline-blob `play()` branch bypass `driveSrc()`

**What goes wrong:** a provenance flag (or a redrive brake, or any future `audio.src` invariant) added only inside `driveSrc()` is silently unset on two of the four attach paths.
**Why it happens:** `driveSrc()` is documented as "the ONE place `audio.src` is set for playback" but its own docstring carries the carve-out: *"(the offline-blob / restore paths aside)"*. `restore():525` and `play():2568` are plain assignments.
**How to avoid:** decide explicitly. Migrating both to `driveSrc()` is cleaner and makes the redrive brake universal, but it is a **behaviour change** (a restore that re-drives the same uid 4× in 1500ms would now STOP). Setting the flag at all four sites is the conservative option. Either way, write it down.
**Warning signs:** a corrupt downloaded track that self-heals when tapped from the queue but not after a page reload.

### Pitfall 3: `blob:` at error time cannot tell a download from a prebuffer

**What goes wrong:** the D-12 eviction fires for a `prebufferNext()` blob — `library.removeDownload(uid)` on a uid that was never downloaded (harmless no-op) plus `blobStore.del(uid)` (harmless) plus a **wrong toast** ("download was corrupted") for a song the user never downloaded, plus a spurious background re-download that puts an undownloaded song into the library.
**Why it happens:** `play():2726-2731` swaps in `prebufferedBlobUrl` as `src` for a track that is explicitly *not* downloaded (`prebufferNext` early-returns when `library.isDownloaded(track.uid)`).
**How to avoid:** the `driveSrc` flag should be tri-state or paired with the uid — e.g. `lastSrcKind: 'url' | 'download-blob' | 'prebuffer-blob'`. A prebuffer-blob error should discard the prebuffer and fall through to the normal URL path, **not** evict a library record.
**Warning signs:** songs appearing in Downloads that the user never downloaded.

### Pitfall 4: `downloadTrack()` is not silent

**What goes wrong:** D-12's "quietly re-download in the background" pops a browser file-save (a `blob:` `<a download>` click) and a per-uid library spinner, mid-playback, with no user action.
**Why it happens:** `downloadTrack()` (`src/lib/services/download-track.ts:58-124`) ends with `return saveBlobToDisk(blob, filename) ? 'saved' : 'failed'` and brackets the whole thing in `library.beginDownload(uid)` / `library.endDownload(uid)`.
**How to avoid:** add an option — `downloadTrack(track, { persist: true, save: false })` — mirroring the existing `{ persist?: boolean }` option that the album bulk path already uses to skip `blobStore.put`. That keeps ONE download orchestration (which is the whole point of the file's header comment) rather than forking a second path. The spinner is arguably fine to keep (it *is* downloading) — decide deliberately.
**Warning signs:** a save dialog appearing while music plays.

### Pitfall 5: the pre-warm trigger fires many times per search

**What goes wrong:** D-03's "top search result when results render" fires 4–8 times per query, because `results` in `src/routes/(app)/search/+page.svelte` is reassigned on **every** `onPartial` emission (one per source as it settles, `:343`), again on the final `searchAll` return (`:348`), and again when the async Deezer boost lands (`:363`) — and the *identity* of `results[0]` can change on each. Naively `$effect`ing on `results[0]` issues a speculative resolve per re-rank.
**Why it happens:** progressive search rendering (D-06 of an earlier phase) plus `rankList` re-sorting the cumulative set.
**How to avoid:** dedupe on the resolved uid (`if (uid === lastPrewarmedUid) return`) **and** rely on `apiFetch`'s GET dedupe as the second line. Do not add a debounce timer — the uid guard is sufficient and stateless.
**Warning signs:** more than one `/api/kuwo/detail` per search in the network tab.

### Pitfall 6: a cache MISS must not cost a serial round-trip

**What goes wrong:** the D-06 cache-first read is `await`ed before the source resolve. On a miss (which, per Pitfall 7, may be the common case) every play now pays `edge round-trip + resolve` instead of `resolve` — i.e. the latency-reduction phase makes cold plays *slower*.
**Why it happens:** the obvious implementation is sequential.
**How to avoid:** either (a) give the cache read a very short deadline (`AbortSignal.timeout(~400ms)`) and race it against nothing — just take the miss — or (b) fire the cache read and the source resolve **concurrently** and take whichever lands first with a usable `audioUrl`. Note (b) is *not* the D-02-rejected "hedged parallel source racing" — it is one source plus one own-origin cache lookup, not two upstream sources. **Flag this for the planner as a genuine design choice, not a settled one.**
**Warning signs:** click-to-play feeling slower after the cache lands than before it.

### Pitfall 7: PoP-local cache means low hit rate, and D-11 makes misses the norm anyway

**What goes wrong:** the team measures a disappointing hit rate and concludes the feature failed.
**Why it happens:** Cache API contents do not replicate outside the originating data center [CITED: developers.cloudflare.com/workers/runtime-apis/cache/]. For an app without heavy per-PoP traffic, a globally-shared cache is really N independent per-PoP caches.
**How to avoid:** set expectations in the plan. The cache's value is **repeat plays of popular songs within one PoP**; the correctness guarantee (D-08: a miss or stale hit is invisible) is what makes it safe to ship regardless of hit rate.
**Warning signs:** none in code — this is a planning/expectation pitfall.

### Pitfall 8: `Vary: Origin` interacts with the cache key

**What goes wrong:** `hooks.server.ts:33-37` merges `corsHeaders(origin)` onto **every** `/api/*` response, and `corsHeaders` sets `Vary: Origin` (documented at `hooks.server.ts:11-12` as being *for* edge-cache correctness). Meanwhile the in-repo convention is to store a **CORS-free** copy and re-apply CORS per hit (WR-01). Storing a response that carries `Vary: Origin` fragments the entry per origin; storing `Vary: *` makes `cache.put` **throw**.
**How to avoid:** follow `deezer/search`'s pattern exactly — build a **fresh** `Response` with an explicit header allow-list for `cache.put` (content-type + Cache-Control only), and return a separate CORS-bearing `Response` to the client. Never `cache.put` the response object that went through the hook.
**Warning signs:** `cache.put` silently failing (it's in a try/catch, so it will be silent) → 0% hit rate with no error.

### Pitfall 9: the D-18 gap is in three skip paths, not one

**What goes wrong:** D-18's toast is added to `handleTotalFailure` — which **already has it** (`emitSkipNotice` at `:3429`). The skips the user actually doesn't see are the other three.
**Where the silent skips are:**
- the error-ceiling skip at `:1689` (`this.next()` with no notice),
- the `bg-error-skip` at `:1744` (`this.next()` with no notice — though a background skip has no visible UI anyway),
- `recoverLoadStall`'s second-stall skip at `:1125` (`strikeUnplayable` + `next()`, no notice).
**How to avoid:** route all of them through `emitSkipNotice(title)` — it already batches, so three sources feeding it will not stack toasts. **Do not** add a toast for the background path if `document.hidden` (nobody sees it and it would fire on foreground return as a stale burst).

### Pitfall 10: 16 i18n dictionaries, parity-enforced, double quotes

**What goes wrong:** adding `"toast.downloadCorrupted"` to `en.ts` only → `i18n.test.ts` fails on key-set parity, and `TranslationKey` (derived from `en`) makes every other dictionary a compile error.
**How to avoid:** every new toast key = 16 file edits (`ar de en es fr hi id it pt ru th tr vi zh-Hans zh-Hant` + `en`), **double quotes on key and value**, no formatter will do it for you. Budget a task for it. Existing precedent keys: `"toast.skipped"`, `"toast.skippedMany"`, `"toast.playbackStopped"`, `"toast.downloadFailedKeptInLibrary"` (`en.ts:330-337`).

## Code Examples

### Extending the `EdgeCache` interface for D-09
```ts
// Source: src/lib/proxy/edge-cache.ts:13-16 (current) — add the third member
export interface EdgeCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
	// D-09 (phase 31): bust-on-playback-failure. PoP-LOCAL — purges only the data center
	// this Worker ran in (CF Cache API docs). Repair-on-encounter, never a global purge.
	delete(request: Request): Promise<boolean>;
}
```

### Typing `waitUntil` (currently absent)
```ts
// Source: src/app.d.ts:21 — the comment already anticipates this exact change
declare global {
	namespace App {
		interface Platform {
			env: { JOOX_TOKEN: string; LASTFM_KEY?: string; LASTFM_SECRET?: string };
			// D-06/D-09 (phase 31): the edge cache write must not delay the client response.
			// `ctx` is the adapter-cloudflare accessor (`context` is its deprecated alias).
			ctx?: ExecutionContext;
		}
	}
}
```
Usage in a `+server.ts`: `platform?.ctx?.waitUntil(writeResolveCache(cache, key, value));`

### The JSON edge-cache route shape (D-06/D-07)
```ts
// Source: src/routes/api/deezer/search/+server.ts:38-94 — the JSON-cache template
export const GET: RequestHandler = async ({ url, request, platform }) => {
	const origin = request.headers.get('origin');
	const k = (url.searchParams.get('k') ?? '').trim();
	if (!k) return jsonResult(EMPTY, origin);           // zero-subrequest short-circuit

	const cache = edgeCache();                          // null under `vite dev` — by design
	const key = ownOriginCacheKey(`${url.origin}/api/resolve/_k?v=1&k=${encodeURIComponent(k)}`);

	if (cache) {
		try {
			const hit = await cache.match(key);
			if (hit) return jsonResult(await hit.json(), origin, TTL);
		} catch { /* broken Cache API degrades to a miss, never a 5xx */ }
	}
	// ... resolve ...
	if (cache) {
		// FRESH Response with an explicit header allow-list — never the hook-decorated one
		// (Pitfall 8: a Vary:Origin / Set-Cookie copy fragments or throws on put).
		const forCache = new Response(JSON.stringify(result), {
			status: 200,
			headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${TTL}` }
		});
		platform?.ctx?.waitUntil(cache.put(key, forCache).catch(() => {}));
	}
	return jsonResult(result, origin, TTL);
};

export const OPTIONS: RequestHandler = ({ request }) =>
	new Response(null, { status: 204, headers: corsHeaders(request.headers.get('origin')) });
```

### Cross-source retry before skip (D-15), reusing the existing walk
```ts
// Source: src/lib/services/fallback.ts:90-122 — already kuwo-first, sameSongKey-gated,
// attempted-bounded, never-throws. Do NOT write a new source walk.
const swap = await tryFallback(failed, settings.preferredSource, ac.signal, this.fallbackAttempted);
if (swap) { /* play(swap, { fromFallback: true }) */ }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact on this phase |
|--------------|------------------|--------------|----------------------|
| `netease`-first resolve, 7-source fan-out on click (~59 calls/play) | **kuwo-first single-source resolve** (~3 calls) | Phase 26 (spikes 001–004) | D-02/D-05 build on this. The cross-source walk is a *failure* path only. |
| Eager `prefetchNext()` on every src-set | **timeupdate-gated single walk** at ≥5s real playback | `debug-song-click-lrc-flood-noplay` | A track that never starts never triggers speculative churn. D-03's pre-warm reintroduces speculative work — deliberately, but from a *user gesture*, not from playback state. |
| `tripLoopGuard()` hard STOP on rapid errors | **SKIP** at the rapid/absolute ceiling; STOP only at `SYSTEMIC_SKIP_CAP` | `ef2c751` disabled the STOP; `debug-nowbar-frozen-audius-spam` re-enabled a *cross-track* one | The old STOP was a false-positive on transient CDN blips. Never re-introduce a per-track STOP. |
| Blob pre-buffer removed (`f7c2580` flood) | **Re-added, bounded**: uid claimed *before* the await so a dead URL is fetched at most once | `bg-lockscreen-stall-noskip` | `prebufferedUid`/`prebufferedBlobUrl` exist and matter for Pitfall 3. |
| `restore()` run tracked in the layout `$effect` | **`untrack()`-wrapped** `attach()` + `restore()` | `debug-song-click-lrc-flood-noplay` | Freeze class 3. Any new `$state` write in `restore()`/`attach()` is safe *only* because of that `untrack()` — do not remove it, and do not add a new tracked effect that reads player state and then mutates it. |

**Deprecated / do not use:**
- `platform.context` — the adapter declares it `@deprecated`; use `platform.ctx`.
- Foreground auto-resume on `visibilitychange` — removed in `quick-260703-i7e` because it caused unwanted playback. D-16 may clear strikes there, but must not call `play()`.
- Gating the now-playing UI swap on the `playing` event — tried, froze mobile playback, reverted (D-04 restates this).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | Tooling / Vitest | ✓ | `>=22` required (`.nvmrc`, `engine-strict`) | — |
| pnpm | Package manager | ✓ | `8.15.5` pinned via `packageManager` | — |
| Vitest | Tests | ✓ | resolved `4.1.8` (verified by running the player suite: **197/197 pass, 1.81s**) | — |
| `wrangler` | `pnpm preview` / deploy | ✓ | `4.98.0` devDep | — |
| Cloudflare Cache API (`caches.default`) | D-06/D-07/D-09 | ✗ under `pnpm dev` (port 4321) · ✓ simulated under `pnpm preview` (Miniflare 3, port 4173) · ✓ production | — | `edgeCache()` returns `null` → all cache logic inert, live upstream. **This is the designed fallback.** |
| kuwo upstream | Resolve verification in-sandbox | ✓ (per project memory) | — | — |
| Deezer upstream | Cover verification | ✓ (per project memory) | — | — |
| netease / qq Meting proxies | Resolve verification in-sandbox | ✗ **blocked in this sandbox** | — | Use kuwo for any live probe; do not conclude "netease is dry" from a sandbox result |
| Dev server port | Manual/E2E verification | Probe — `4321` via `.claude/launch.json`, `5173` via bare `pnpm dev` | — | Probe, don't assume |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** the Cache API under `pnpm dev` — plan all cache verification as (a) unit tests with the in-memory `stubCache()` harness, and (b) a `pnpm preview` smoke check. **Do not plan a `pnpm dev` cache verification step; it will always show a miss.**

**Command corrections (project memory, do not rediscover):**
- `pnpm deploy` is shadowed by a pnpm builtin — the script is **`pnpm run deploy`**. `CLAUDE.md` documents this wrong.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.3` (resolves `4.1.8`) |
| Config file | `vite.config.ts` — a **single** project named `server`, `environment: 'node'`, **no jsdom project exists** |
| Include glob | `src/**/*.{test,spec}.{js,ts}` (covers `*.svelte.test.ts` — the SvelteKit Vite plugin transforms runes for node) |
| Notable | `expect: { requireAssertions: true }` — a test with zero assertions **fails** |
| Quick run command | `npx vitest --run src/lib/stores/player.svelte.test.ts` (~1.8s, 197 tests) |
| Full suite command | `pnpm test` (90 test files) |
| Type gate | `pnpm check` (`svelte-kit sync && svelte-check`) — the only lint |

### What is mockable in this harness (verified by reading `player.svelte.test.ts`)

| Thing | Mockable? | How |
|-------|-----------|-----|
| `ensureTrackDetails` / `searchAll` | ✓ | `vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: vi.fn(), searchAll: vi.fn() }))` — the whole module is replaced |
| `tryFallback` / `fallbackOrder` | ✓ | `vi.mock('$lib/services/fallback', ...)` — already mocked; D-15's cross-source retry is directly assertable |
| `blobStore.get/put/del` | ✓ | `vi.mock('$lib/services/blob-store', ...)` — already returns a **deferred** promise so the gen-guard await window is controllable. **D-13's corrupt-blob test drops straight in: `mockBlobGet.mockResolvedValue(new Blob([]))`.** |
| `browser` from `$app/environment` | ✓ | `vi.mock('$app/environment', () => ({ browser: true }))` |
| `localStorage` | ✓ | Module-scope in-memory `Storage` via `vi.stubGlobal` (re-established in `afterEach` because `unstubAllGlobals` tears it down) |
| `logAction` | ✓ | `vi.mock` with `importOriginal` + call-through `vi.fn(actual.logAction)` — **so D-14's log entry is assertable** |
| The `<audio>` element | ✓ | `makeFakeAudio()` records `addEventListener` handlers and exposes `.fire('error')` / `.fire('playing')` — **the entire error-handler tree is drivable** |
| `Audio` / `Image` constructors | ✓ | `installAssetPreloadMocks()` via `vi.stubGlobal` |
| `probePlayable` | ✓ (implicitly) | Degrades to `{ok:true}` when `Audio.prototype.addEventListener` is absent — so it is a no-op unless a test installs the mock |
| `navigator.onLine` | ✓ | `vi.stubGlobal('navigator', { onLine: false })` (the offline suite does this) |
| `caches.default` | ✓ | `stubCache()` in `og-endpoint.test.ts:746-762` — an in-memory `Map<url, Response>` with `match`/`put` spies and a `putKeys` array. **Add a `delete` spy for D-09.** |
| `platform` in a route test | ✓ | `fakeEvent()` builds `{ url, platform: env ? { env } : undefined, request }` and the test calls `GET(event as any)`. **`platform.ctx` must be added to this fake for a `waitUntil` path** — and note the `as any` is a test-only escape hatch (allowed by C-07). |
| Private `Player` statics (`STRIKE_CAP` etc.) | ✗ **not readable** | The test file **mirrors them by hand** (`const Player_FAILURE_CAP = 5;` etc.). **D-16's `STRIKE_CAP` change means updating the mirrored constant too — and there is no compiler check that they agree.** Flag this as a real trap. |
| Private instance fields | ✓ (via cast) | `const internals = player as unknown as { … }` — the `beforeEach` resets ~20 of them |
| `player.play` | ✓ | `vi.spyOn(player, 'play').mockImplementation(...)` in `beforeEach` — most suites test *around* `play()`, re-mocking it per-suite when they need the real thing |

**What is NOT testable here:** anything requiring a real DOM (`jsdom` project does not exist), real IndexedDB, real `<audio>` byte loading, Media Session, Capacitor native bridges, real Cloudflare `caches.default` semantics (PoP scoping, `put` throwing on 206/`Vary: *`), and real network timing.

### Phase Requirements → Test Map

| Ref | Behavior | Test type | Automated command | File exists? |
|-----|----------|-----------|-------------------|-------------|
| D-03 | Pre-warm fires **once** per top-result uid, routes through `apiFetch`, and never fires on scroll | unit | `npx vitest --run src/lib/stores/player.svelte.test.ts -t "pre-warm"` | ❌ Wave 0 (new describe block) |
| D-03 | Pre-warm on longpress/menu-open dedupes against an in-flight resolve | unit | same | ❌ Wave 0 |
| D-06/D-07 | Route: cache MISS → resolve → `cache.put` with an own-origin key; second identical request = HIT with **zero** upstream calls | unit | `npx vitest --run src/routes/api/resolve/resolve-endpoint.test.ts` | ❌ Wave 0 (new file, model on `og-endpoint.test.ts:892-963`) |
| D-06(c) | A clean "source is dry" negative IS cached; an upstream **error** writes nothing | unit | same | ❌ Wave 0 |
| D-08 | Client cache read returns `null` on 404 / 500 / malformed JSON / abort / breaker-open, and `ensureTrackDetails` still resolves normally | unit | `npx vitest --run src/lib/services/catalog.test.ts` | ⚠️ file exists, new cases needed |
| D-09 | POST report → `cache.delete(key)` called with the **same** key the GET wrote | unit | `npx vitest --run src/routes/api/resolve/resolve-endpoint.test.ts` | ❌ Wave 0 |
| D-09 | Client reports **only** when the failing src came from a cache hit (not for a normally-resolved URL) | unit | `npx vitest --run src/lib/stores/player.svelte.test.ts -t "cache bust"` | ❌ Wave 0 |
| D-11 | A cache-hit URL that 403s → report + fall through to the client resolver + keep playing (the **primary** path) | unit | same | ❌ Wave 0 |
| D-12 | `blobStore.get` returns a blob → `audio.error` fires → `blobStore.del` **and** `library.removeDownload` called, network re-resolve attempted, background re-download queued once | unit | `npx vitest --run src/lib/stores/player.svelte.test.ts -t "corrupt blob"` | ❌ Wave 0 |
| D-12 | A **prebuffer** blob error does **not** evict a download record (Pitfall 3) | unit | same | ❌ Wave 0 |
| D-13 | A 0-byte blob is rejected at read time and never reaches `audio.src` — on all three read sites (`restore`, `reresolveCurrent`, `play`) | unit | same + `blob-store.test.ts` | ⚠️ `blob-store.test.ts` exists |
| D-14 | Exactly ONE toast + one `logAction` entry per corruption event | unit | `-t "corrupt blob"` (assert `mockLogAction` calls) | ❌ Wave 0 |
| D-15 | A next-track definitive failure calls `tryFallback` **before** `strikeUnplayable` promotes to dead | unit | `-t "cross-source"` | ❌ Wave 0 |
| D-16 | `STRIKE_CAP` raise: a uid survives N-1 strikes without entering `unplayableUids` | unit | `-t "strike"` (existing describe at `:3926`) | ⚠️ exists, **mirrored constant must be updated** |
| D-16 | An `online` event / foreground return clears accumulated strikes **without** issuing `play()` | unit | `-t "strike"` | ❌ Wave 0 |
| D-17 | **Regression:** after D-15+D-16, `SYSTEMIC_SKIP_CAP` still trips `haltRunawayRecovery` at 5 consecutive no-`playing` skips | unit | `-t "systemic"` (existing suite at `:4798`) | ⚠️ exists — **must still pass unmodified** |
| D-17 | **Regression:** the rapid-error storm suite (`:4798`) and the redrive-brake suite (`:1391`) still pass unmodified | unit | `npx vitest --run src/lib/stores/player.svelte.test.ts` | ✅ exists |
| D-17 | **Regression:** the `api-base` governor + breaker suite still passes; new callers don't bypass it | unit | `npx vitest --run src/lib/services/api-base.test.ts` | ✅ exists |
| D-18 | Every skip path (`error.ceiling`, stall-skip, total-failure) emits a batched skip notice; N skips in 2500ms = ONE notice with `count: N` | unit | `-t "skip"` | ⚠️ partial coverage exists |
| C-05 | All 16 dictionaries expose the new toast keys | unit | `npx vitest --run src/lib/i18n/i18n.test.ts` | ✅ exists (parity guard) |
| — | Type gate | typecheck | `pnpm check` | ✅ |

### Sampling Rate

- **Per task commit:** `npx vitest --run src/lib/stores/player.svelte.test.ts` (~1.8s) — the file that owns 90% of this phase's blast radius.
- **Per wave merge:** `pnpm test && pnpm check`.
- **Phase gate:** `pnpm test` green + `pnpm check` clean + the manual/E2E checks below, **before** `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `src/routes/api/resolve/resolve-endpoint.test.ts` — new file. Copy `stubCache()` + `fakeEvent()` from `src/routes/api/og/og-endpoint.test.ts:746-778`, **add a `delete` spy** to `stubCache` and a `ctx: { waitUntil }` to `fakeEvent`. Covers D-06, D-07, D-09.
- [ ] New describe blocks in `src/lib/stores/player.svelte.test.ts` for: corrupt-blob recovery (D-12/D-13/D-14), cross-source-retry-before-skip (D-15), strike clearing on recovery (D-16), cache-bust reporting (D-09/D-11), pre-warm dedupe (D-03).
- [ ] Update the hand-mirrored `Player_*` constants in the test file when D-16 changes `STRIKE_CAP`. **There is no compiler check for this.**
- [ ] New cases in `src/lib/services/catalog.test.ts` for the cache-first read's never-throw sentinel (D-08).
- [ ] Framework install: **none needed.**

### Explicitly NOT unit-testable — verification must be manual / on-device

| What | Why | How to verify instead |
|------|-----|----------------------|
| Real Cache API hit/miss/`delete` semantics, PoP scoping, `put` throwing on `Vary: *` / 206 | `edgeCache()` is `null` under `vite dev`; the unit tests exercise an in-memory `Map`, not workerd | `pnpm preview` (Miniflare 3 simulates the cache) for hit/miss; production `curl` with `CF-Cache-Status`-style timing (`/api/og` measured 1698ms → 2ms) for the real thing |
| Actual click-to-play latency improvement (the phase's whole point) | No timing harness in the repo; `apiFetch` is mocked out in every unit test | Manual: the spike-003 method — wrap `window.fetch`, reset `window.__net = []` at the click boundary, count and categorize. Reuse the Activity log (`logAction`) timestamps for `play` → `resolve.ok` → `playing`. |
| iOS Safari / Android Chrome background playback, lock-screen behaviour, autoplay policy | No jsdom, no device runner | On-device. Project memory is explicit that background-audio bugs are **device-only reproducible** and that the Activity log is the diagnostic channel. |
| Whether the raised `STRIKE_CAP` actually feels better on a flaky connection | Subjective + network-dependent | Manual on a real degraded network |
| That a globally-shared audio URL 403s for another user (D-11's premise) | Needs two clients in different regions | Manual, or accept the risk — the *handling* is unit-testable even if the *trigger* is not |
| Toast visual behaviour / batching feel | No component test project | Manual |

**Bottom line for the planner:** the *logic* of every decision is unit-testable in this harness, and the harness is unusually good. What is not testable is the *performance claim* and the *device behaviour* — both of which need a named manual verification step in the plan, not an assumption.

## Security Domain

`security_enforcement` is not set in `.planning/config.json` → treated as **enabled**.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | The app has no accounts; the new route is unauthenticated by design |
| V3 Session Management | no | No sessions |
| V4 Access Control | **partially** | The new `/api/resolve` POST (D-09) is an **unauthenticated write to globally-shared state** — see Threat Patterns |
| V5 Input Validation | **yes** | `k` query param and the POST body. Follow `/api/og`'s posture: length-cap every text input (`MAX_TERM_CHARS = 200`), `encodeURIComponent` into fixed templates, **never accept a URL** |
| V6 Cryptography | no | No new crypto. No new secret is read. |
| V7 Error Handling & Logging | **yes** | Never-500 posture; a broken Cache API must degrade to a miss (`/api/og`'s outermost try/catch) |
| V9 Communications | **yes** | CORS via the single `hooks.server.ts` seam, allow-listed origin, **never `*`** (C-14) |
| V13 API & Web Service | **yes** | Only `GET`+`POST`+`OPTIONS`; `OPTIONS` returns 204 without `resolve()` (workerd requirement) |
| V14 Configuration | **yes** | No new binding, no new secret, no `wrangler.jsonc` change (D-07) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard mitigation |
|---------|--------|---------------------|
| **Cache poisoning via the D-09 report endpoint** — an unauthenticated POST that deletes shared cache entries lets anyone force every user in a PoP to cold-resolve, or (worse, if the endpoint ever *writes*) inject an attacker-chosen audio URL | Tampering / DoS | **Make the report endpoint delete-only, never write.** Deleting is idempotent and self-limiting (worst case = a cold resolve, which is exactly the pre-phase behaviour). Rate-limit implicitly by routing the client call through `apiFetch` (POSTs are not deduped, so add a client-side per-uid one-shot guard). Never accept a URL or a replacement value in the body — only a key. This mirrors `/api/og`'s D2/T-3uo-03 reasoning verbatim: *"the resolve entry is keyed on normalized TEXT and is SHARED by every requester, so letting request-supplied input write it would let one crafted link change what everyone else resolves."* |
| **Open relay / SSRF via a cached URL** | Tampering | The cached `audioUrl` originates from a source adapter, never from client input. **Do not add a client-supplied-URL write path.** If a URL is ever echoed to `<audio>`, it must have come from `SOURCES[].resolve`. |
| **Secret leakage into a cache key** | Information Disclosure | `ownOriginCacheKey()` — never key on an upstream URL (T-09-05 / T-wv8-06). This phase reads **no** secret, so the risk is structural only. |
| **`Set-Cookie` / CORS header leaking into a shared cached copy** | Information Disclosure | Build a **fresh** `Response` with an explicit header allow-list for `cache.put` (the `/api/og` + `ytmusic/stream` posture). Never cache the hook-decorated response (Pitfall 8). |
| **Cross-origin cache hit inheriting a prior requester's ACAO** | Information Disclosure | Store CORS-free; re-apply per hit (WR-01, `og/+server.ts:113-124`). |
| **Unbounded upstream amplification** (a report storm triggering N cold resolves) | DoS | `apiFetch` circuit breaker (30 failures/3s → 10s cooldown) + `MAX_CONCURRENT_REQUESTS=8`. Do not bypass. |
| **Pathological input building a giant upstream URL** | DoS | Length-cap the `k` param at ingress (`MAX_TERM_CHARS` precedent = 200). |

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `pnpm preview` (`wrangler pages dev`, Miniflare 3) exercises a real in-memory Cache API, so a local hit/miss cycle is observable there | Environment Availability, Validation | LOW — if wrong, cache verification is unit-tests-only + production. Cheap to check: run `pnpm preview` and hit `/api/og` twice. |
| A2 | Adding `ctx?: ExecutionContext` to `src/app.d.ts`'s `Platform` will typecheck cleanly against `@cloudflare/workers-types` (already in `tsconfig.json` `types`) | Cloudflare specifics | LOW — worst case is an import/type tweak. The comment at `app.d.ts:21` implies it was already considered. |
| A3 | A cache MISS added serially to `ensureTrackDetails` would measurably slow cold plays (Pitfall 6) | Pitfall 6 | MEDIUM — if the edge round-trip is <100ms same-origin, serial is fine and simpler. **The planner should measure before choosing the concurrent design.** |
| A4 | The `bg-error-skip` path (`:1744`) intentionally omits `failoverSkips++` | Pitfall 1 | MEDIUM — if it is an oversight, D-15/D-16 make it a real hole in the only cross-track bound. Worth one focused read + a question in the plan. |
| A5 | Per-PoP cache scoping will produce a low hit rate at this app's traffic level | Pitfall 7 | LOW (expectation-setting only) — does not affect correctness, only the perceived success of the feature. |
| A6 | The `// RAW fetch (not apiFetch — fetch→apiFetch audit)` comment convention is enforced by a grep-based audit somewhere | Standard Stack | LOW — following it costs nothing either way. |
| A7 | Deploying the edge route and the client change together is safe because an already-shipped APK tolerates a 404 from `/api/resolve` via D-08's never-throw sentinel | Runtime State Inventory | MEDIUM — must be an explicit verification step, not an assumption. A client that treats a 404 as a hard failure would break the installed APK. |

## Open Questions

1. **Serial vs concurrent cache read on the hot path (Pitfall 6 / A3)**
   - What we know: a miss must be free (D-08 says "serve songs asap"), and the miss rate may be high (Pitfall 7).
   - What's unclear: whether a same-origin edge round-trip is cheap enough (<100ms) to eat serially.
   - Recommendation: implement serial with a short `AbortSignal.timeout(~400ms)` first (simplest), measure with the spike-003 fetch-wrap method, and only go concurrent if the measurement says so. Note explicitly in the plan that "concurrent cache + single source" is **not** the D-02-rejected hedged multi-source race.

2. **Does `bg-error-skip` need `failoverSkips++`? (A4)**
   - What we know: the error-ceiling path increments it (`:1685`); the background path at `:1744` does not.
   - What's unclear: whether that is deliberate (a backgrounded skip is cheap and the user isn't watching) or an oversight.
   - Recommendation: read the `bg-resolve-gap-stall` debug session before touching it. If deliberate, add a comment saying so; if not, fix it as part of D-17's backstop hardening.

3. **Should `restore()` and the offline-blob `play()` branch migrate to `driveSrc()`? (Pitfall 2)**
   - What we know: both bypass it today; the docstring carves them out explicitly.
   - What's unclear: whether applying the redrive brake to those paths is safe.
   - Recommendation: **do not migrate in this phase.** Set the provenance flag at all four sites instead. Migrating is a separate, riskier change and this phase is already touching the freeze-sensitive core.

4. **New `STRIKE_CAP` value (D-16, discretion)**
   - What we know: currently 2, with `RETRY_RESOLVE_MAX=2` delayed retries layered on top, so a uid already gets up to ~6 chances before dying.
   - Recommendation: **3**, plus the eager clearing. The clearing half of D-16 addresses the stated complaint (a tunnel blacklisting the queue) at near-zero churn cost; the cap raise is where the churn is. Pair the change with a `SYSTEMIC_SKIP_CAP` regression test.

5. **Should the D-06(c) availability hints be a separate cache layer or a field on the resolve entry?**
   - What we know: `/api/og` uses two separate layers because one (bytes) is huge and the other (resolve) is tiny.
   - Recommendation: **one entry, three fields** (`{ songid, url, avail }`). Both layers here are small JSON; two layers doubles the key-management surface and the bust complexity for no benefit. Version the key (`?v=1`) so the shape can change later.

## Sources

### Primary (HIGH confidence)
- `src/lib/stores/player.svelte.ts` (3625 lines) — read in full at the relevant ranges; all line numbers verified
- `src/lib/services/api-base.ts` (293 lines) — read in full
- `src/lib/services/catalog.ts` (384 lines) — read in full
- `src/lib/services/fallback.ts` (122 lines) — read in full
- `src/lib/proxy/edge-cache.ts` (39 lines) — read in full
- `src/routes/api/og/+server.ts` (329 lines) — read in full
- `src/routes/api/deezer/search/+server.ts` (100 lines) — read in full
- `src/hooks.server.ts` (41 lines) — read in full
- `src/lib/services/blob-store.ts` (256 lines) — read in full
- `src/lib/services/download-track.ts` — read (Pitfall 4)
- `src/routes/+layout.svelte`, `src/lib/stores/online.svelte.ts`, `src/lib/stores/toast.svelte.ts`, `src/lib/stores/library.svelte.ts` — read
- `src/lib/stores/player.svelte.test.ts` (5199 lines) — harness + all 38 describe blocks surveyed; **suite executed: 197/197 pass**
- `src/routes/api/og/og-endpoint.test.ts` — `stubCache()`/`fakeEvent()` harness read
- `node_modules/@sveltejs/adapter-cloudflare/ambient.d.ts` — **authoritative** for `platform.ctx`/`context`/`caches`
- `package.json`, `wrangler.jsonc`, `tsconfig.json`, `.svelte-kit/tsconfig.json`, `vite.config.ts`, `src/app.d.ts` — read
- `.claude/skills/spike-findings-openmusic/` — SKILL.md + `source-resolution.md` + `click-to-play-cost.md`
- `.planning/phases/31-.../31-CONTEXT.md` + `31-DISCUSSION-LOG.md`
- `./CLAUDE.md`

### Secondary (MEDIUM confidence)
- [Cloudflare Workers Cache API runtime docs](https://developers.cloudflare.com/workers/runtime-apis/cache/) — GET-only keys, `cache.put` throw conditions, `cache.delete` return value + PoP scoping, non-replication
- [Improved local development with wrangler and workerd](https://blog.cloudflare.com/wrangler3/) — Miniflare 3 simulates Cache locally
- [Miniflare Cache storage docs](https://developers.cloudflare.com/workers/testing/miniflare/storage/cache/) — in-memory default, `cachePersist`, `disableCache`

### Tertiary (LOW confidence — flagged, not relied on)
- Project memory entries (freeze-class post-mortems, sandbox network reachability, `pnpm run deploy` shadowing, dev-server port ambiguity). These are consistent with in-code comments, which is why they were promoted to MEDIUM in practice — but they are not independently re-verified in this session.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — zero new packages; every primitive read in source
- Architecture / code sites: **HIGH** — all four sites read in full, line ranges verified against the live file
- Cloudflare Cache API semantics: **MEDIUM-HIGH** — official docs cited for the behavioural claims; `platform.ctx` verified against the installed adapter's own type declaration; **not** live-probed against production
- Pitfalls: **HIGH** — each derived from an in-code post-mortem comment or a directly-read code path, not from general knowledge
- Testing: **HIGH** — harness read in full and the suite executed successfully in this session
- Latency/hit-rate expectations: **LOW** — no measurement was taken; flagged in Assumptions and Open Questions

**Research date:** 2026-08-09
**Valid until:** ~2026-09-08 (30 days). The codebase facts are stable; the Cloudflare Cache API claims are stable. Re-verify the `player.svelte.ts` line numbers if any other phase or quick-task touches that file first — it changes often.
