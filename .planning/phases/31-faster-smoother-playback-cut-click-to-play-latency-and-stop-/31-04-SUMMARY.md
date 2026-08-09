---
phase: 31
plan: 04
subsystem: resolve-path
tags: [edge-cache, never-throw-service, self-gating-report, availability-hints, never-stop]
requires:
  - "31-03 — /api/resolve GET lookup + delete-only POST bust"
provides:
  - "$lib/services/resolve-cache-client.ts — never-throw readResolveCache + self-gating reportDeadUrl"
  - "the served-url registry that keeps the player free of new provenance state"
  - "cache-first read at the single ensureTrackDetails seam"
  - "resolveNameStub(artist, title, signal, avail) — dry-source skipping that can never empty the walk"
affects:
  - src/lib/services/catalog.ts
  - src/lib/stores/player.svelte.ts
tech-stack:
  added: []
  patterns:
    [
      never-throw-service,
      throw-inside-null-outside,
      served-url-registry,
      self-gating-side-effect,
      generation-guard,
      plain-field-guards
    ]
key-files:
  created:
    - src/lib/services/resolve-cache-client.ts
    - src/lib/services/resolve-cache-client.test.ts
  modified:
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "the bust report self-gates in the SERVICE via a served-url registry, so the player gains exactly one unconditional line and no fourth provenance flag"
  - "a source-bearing track adopts a cached url ONLY on source+songid equality — a match-key entry can belong to a different version"
  - "a dry-source filter that would empty the walk degrades to the full order instead"
  - "the cache read is placed after sig normalization and before the resolveByName branch — the one seam every resolve caller funnels through"
  - "the player.svelte.test.ts cache-bust suite drives the REAL client with a mocked apiFetch, so self-gating is proven at the network boundary"
metrics:
  duration: ~25 min
  completed: 2026-08-09
  tasks: 3
  commits: 6
---

# Phase 31 Plan 04: Client wiring for the edge resolve cache Summary

A play now asks the edge first — a hit fills `audioUrl` and skips the whole source walk — and when a
globally-shared URL turns out to be dead for this user, the client reports it once, the PoP entry is
dropped, and the song keeps playing through the ordinary resolver.

## What Changed

**Task 1 — the never-throw client** (RED `fc94edf`, GREEN `d4a870c`)

`src/lib/services/resolve-cache-client.ts`, copying `deezer.ts`'s posture verbatim: throw inside,
`.catch(() => null)` at the exported boundary. `readResolveCache(artist, title, signal)` short-circuits
to `null` (zero requests) on an already-aborted signal or blank terms, otherwise issues ONE
`apiFetch('/api/resolve?a=…&t=…')` bounded by `combinedSignal` (`AbortSignal.any` + a
`RESOLVE_CACHE_TIMEOUT_MS = 400` deadline, with the `typeof` feature check and timeout-only fallback).
A `{ hit: true, entry }` returns the entry — **including a known-none entry**, because its `avail`
hints are the D-06(c) payload; everything else (`{ hit: false }`, 404, 500, malformed JSON, abort,
timeout, open breaker) returns `null`.

`reportDeadUrl(url)` is the D-09 bust and is self-gating by construction: `readResolveCache` records
every served URL in a module-level plain `Map` (`servedUrls`, cap 32, oldest-out) mapped back to the
terms that bust its entry, so a URL the cache never served is a silent no-op with ZERO requests. On a
hit it POSTs `{ a, t }` through `apiFetch`, then drops the registry entry and adds the URL to a capped
plain `Set` — `apiFetch` only dedupes body-less GETs, so a POST always reaches the server and needs
that client-side one-shot. Fire-and-forget, returns void, never rejects. All module state is plain
(`Map`/`Set`), never reactive. `__resetResolveCacheClient()` is the test-only reset, mirroring
`__resetGovernor`.

**Task 2 — cache-first read in `ensureTrackDetails`** (RED `2aaf0e3`, GREEN `785ec79`)

One `readResolveCache` call site, placed after `const sig = …` and before the `resolveByName` branch,
followed immediately by `if (sig.aborted) return track;` (C-09). Adoption rules:

- a `resolveByName` stub with a cached `url` + a registry-known `source` + `songid` returns a fully
  resolved Track (`makeUid`, `audioUrl`, `detailsLoaded: true`) — the whole search+resolve walk is
  replaced by one own-origin round-trip;
- a source-bearing track adopts the url ONLY when `cached.source === track.source && cached.songid ===
  track.songid` (T-31-04-01 — the entry is keyed on normalized artist+title, so a mismatched songid
  would play a different version than the VersionPicker choice);
- every other outcome falls straight through with no side effect. **No client write path was added.**

D-06(c): `resolveNameStub` gained a fourth `avail` parameter; the eligible order is filtered of
`avail[id] === 'dry'` sources, and the filter is applied only when at least one source survives so an
all-dry (or stale) hint degrades to the full walk rather than to nothing. `cachedEntry?.avail` is
threaded from `ensureTrackDetails`.

**Task 3 — the report from the playback error path** (RED `397562f`, GREEN `ceabc3c`)

Exactly one statement — `reportDeadUrl(this.audio?.src ?? '');` — in the `audio.error` handler, after
the 31-D-12 corrupt-blob branch and before the seek-window branch. No condition, no `await`, no
`return`, no strike, no skip. The freeze ceiling still returns before it; the seek /
`hasPlayedSinceSrc` / cross-source chain below runs unchanged.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Acceptance criterion] `grep -c 'fetch(' … returns 0` is unsatisfiable as written**

- **Found during:** Task 1
- **Issue:** `grep -c 'fetch('` matches the substring inside `apiFetch(`, so the criterion could only
  pass for a file that calls nothing at all. The intent is "no RAW fetch".
- **Fix:** evaluated with the word-boundary form `grep -cE '\bfetch\(' → 0`, which expresses the actual
  rule (`apiFetch` has no word boundary before `fetch`). Same class as 31-03's deviation 2.
- **Files:** none (verification only)

**2. [Rule 1 — Acceptance criterion] comment text broke two greps**

- **Found during:** Tasks 1 and 3
- **Issue:** `grep -c '$state' resolve-cache-client.ts` read 2 and `grep -c 'reportDeadUrl'
  player.svelte.ts` read 3 — in both cases because a comment *named the identifier* while recording the
  convention ("plain fields — never $state", "reportDeadUrl consults its own registry").
- **Fix:** reworded both comments to reference the rule without the literal token ("never reactive
  (C-02)", "it consults its own served-url registry"). The decision records survive; the greps now read
  0 and 2.
- **Files:** `src/lib/services/resolve-cache-client.ts`, `src/lib/stores/player.svelte.ts`
- **Commits:** `d4a870c`, `ceabc3c`

**3. [Rule 3 — Blocking] local `cached` shadowed the imported `cached` from `ttl-cache`**

- **Found during:** Task 2
- **Issue:** `catalog.ts` already imports `cached` (the TTL-cache factory). The plan's `const cached =
  await readResolveCache(...)` would shadow it inside `ensureTrackDetails` — legal, but exactly the
  kind of name collision the "never cache audio URLs in the TTL cache" rule needs to stay legible.
- **Fix:** named the local `cachedEntry`. `grep -c 'cached('` is unchanged at 3, proving the TTL cache
  did not gain a caller.
- **Files:** `src/lib/services/catalog.ts`
- **Commit:** `785ec79`

**4. [Design detail] the cache-bust suite drives the REAL client instead of a mocked one**

- **Found during:** Task 3
- **Issue:** the plan said to mock `$lib/services/resolve-cache-client` in `player.svelte.test.ts`. But
  the required behavior is *"a normally-resolved URL calls `reportDeadUrl` and issues no POST — asserted
  at the SERVICE boundary, not by adding a condition in the player"*. A mocked `reportDeadUrl` can only
  prove the player called it, never that the service self-gated.
- **Fix:** mocked `$lib/services/api-base`'s `apiFetch` (via `importOriginal`, so every other export
  stays real) and let the real client run. The suite primes the served-url registry through a real
  `readResolveCache` call and then asserts POST counts at the wire. Strictly stronger, and no extra
  machinery. `__resetResolveCacheClient()` runs in the suite's `beforeEach` so module state cannot leak.
- **Files:** `src/lib/stores/player.svelte.test.ts`
- **Commit:** `397562f` / `ceabc3c`

**5. [Rule 3 — Type gate] the hoisted `apiFetch` mock needed an explicit signature**

- **Found during:** Task 3
- **Issue:** `vi.fn(async () => new Response(...))` infers a zero-arg tuple, so `mock.calls[0][1]` is a
  type error under `svelte-check` (5 errors).
- **Fix:** `vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(...)` and `String(init?.body)`
  at the one body assertion.
- **Files:** `src/lib/stores/player.svelte.test.ts`
- **Commit:** `ceabc3c`

### Assumption Drift (advisory)

**1. A cache hit yields no lyrics, unlike every other resolve path**

- **Planned:** the adopted Track sets `audioUrl` + `detailsLoaded: true`.
- **Actual:** because `detailsLoaded` is true and the entry carries no `lrc`/`lrcUrl`, the readiness
  guard will treat such a track as complete — so a cache-hit play starts with an empty lyric pane
  where a normal resolve would have filled it (kuwo/qq return `lrc` inline in the detail body).
- **Why it matters:** it is the deliberate trade the plan's field list encodes (instant audio over
  lyrics) and it is written down in the code comment, but it is a user-visible difference between a
  warm and a cold play that nothing in the plan states. Worth a look during 31-06's manual pass; the
  fix, if wanted, is a cache-hit lyric backfill rather than a change to the entry shape.

## Verification

| Check | Result |
|---|---|
| `npx vitest --run src/lib/services/resolve-cache-client.test.ts` | **14 passed** |
| `npx vitest --run src/lib/services/catalog.test.ts` | **43 passed** (was 30 — +13 additions only) |
| `npx vitest --run src/lib/stores/player.svelte.test.ts` | **223 passed** (was 218 — +5 additions only) |
| `npx vitest --run src/lib/stores/player.svelte.test.ts -t "cache bust"` | **5 passed**, 218 skipped |
| `npx vitest --run src/lib/stores/player.svelte.test.ts -t "SYSTEMIC"` | **2 passed**, unmodified (D-17) |
| `npx vitest --run src/lib/services/api-base.test.ts` | **12 passed**, unmodified (D-17) |
| `pnpm test` | **95 files, 1725 tests passed** (was 93/1673) |
| `pnpm check` | **0 errors, 0 warnings** (4380 files) |
| `git diff --stat package.json pnpm-lock.yaml wrangler.jsonc` | **empty** |
| `git diff … src/lib/stores/player.svelte.test.ts \| grep -c '^-[^-]'` | **0 deletions** (rapid-error-storm + redrive-brake suites untouched) |
| `grep -cE '\bfetch\(' src/lib/services/resolve-cache-client.ts` | 0 (raw fetch) |
| `grep -c '\$state\|setTimeout\|setInterval' src/lib/services/resolve-cache-client.ts` | 0 / 0 |
| `grep -n 'readResolveCache' src/lib/services/catalog.ts` | exactly ONE call site (`:318`), after `sig`, before `resolveByName` |
| `grep -c 'cached(' src/lib/services/catalog.ts` | 3 — unchanged from before this plan |
| `grep -c 'reportDeadUrl' src/lib/stores/player.svelte.ts` | 2 (import + the single call site) |
| Guard constants | `FAILURE_CAP=5`, `SYSTEMIC_SKIP_CAP=5`, `RAPID_ERROR_CAP=3`, `STRIKE_CAP=3`, `RESOLVE_WATCHDOG_MS=6000` — all unchanged |

Specifically observed, not inferred: a name-stub cache hit issues **zero** `SOURCES[].search` and
**zero** `SOURCES[].resolve` calls; a songid-mismatched hit still calls `SOURCES[].resolve` exactly
once; a `kuwo: 'dry'` hint leaves `kuwo.search` uncalled while `qq.search` runs once; an all-dry hint
still searches kuwo; an `audio.error` on an unprimed URL issues **zero** requests of any kind; the
primed case issues exactly ONE POST to `/api/resolve` with body `{a:'Jay',t:'Blue'}` and
`runFallback` is called the same number of times with and without it.

**Not verified (deferred to 31-06's manual pass, per 31-VALIDATION.md):** real Cache API semantics
(`edgeCache()` is `null` under vitest, so hit/miss/PoP scoping is exercised against mocks only), the
actual latency win, and D-11's *trigger* — that a shared URL genuinely 403s for a user in another
region needs two clients in two regions. The *handling* is unit-proven above; the *trigger* is not.

## Known Stubs

None.

## Threat Flags

None beyond the plan's `<threat_model>`, which is implemented:

- T-31-04-01 (wrong-song adoption) — mitigated + tested: source AND songid equality for a
  source-bearing track; two explicit mismatch tests assert the adapter still resolves.
- T-31-04-02 (report storm) — mitigated + tested: self-gated by the served-url registry (zero requests
  for an unserved URL), one-shot per URL via a capped plain `Set`, routed through `apiFetch`.
- T-31-04-03 (added `/api/*` load) — mitigated: one governed GET per COLD resolve, 400ms-bounded,
  deduped by `apiFetch`, skipped by the readiness guard; no second throttle added (`api-base.test.ts`
  passes unmodified).
- T-31-04-04 (a new playback failure mode) — mitigated + tested: 404 / 500 / malformed JSON / abort /
  timeout / open-breaker each have their own null-sentinel test, and a null is indistinguishable from
  a miss at the catalog seam.
- T-31-04-05 (hostile cached URL) — transferred as planned: every cached URL is derived server-side by
  `resolveOnEdge`; no client write path was added.
- T-31-04-06 (artist/title to the edge) — accepted as planned.
- T-31-04-SC — zero packages installed; `package.json`, `pnpm-lock.yaml`, `wrangler.jsonc` diffs empty.

## Self-Check: PASSED

- `src/lib/services/resolve-cache-client.ts` — FOUND
- `src/lib/services/resolve-cache-client.test.ts` — FOUND
- `src/lib/services/catalog.ts` — FOUND
- `src/lib/services/catalog.test.ts` — FOUND
- `src/lib/stores/player.svelte.ts` — FOUND
- `src/lib/stores/player.svelte.test.ts` — FOUND
- commit `fc94edf` — FOUND
- commit `d4a870c` — FOUND
- commit `2aaf0e3` — FOUND
- commit `785ec79` — FOUND
- commit `397562f` — FOUND
- commit `ceabc3c` — FOUND
