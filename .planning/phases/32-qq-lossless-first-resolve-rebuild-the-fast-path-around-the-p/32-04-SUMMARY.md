---
phase: 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
plan: 04
subsystem: edge-resolve-cache / catalog-resolve-seam
tags: [edge-cache, cache-ttl, qq, song-mid, negative-caching, cache-bust, latency, diagnostics]
requires:
  - "32-D-08's qq-first dedupe (plan 32-02) — it is what makes the skip-when-mid-held guard the common path"
provides:
  - "url-less ResolveEntry: a PERMANENT qq song_mid, RESOLVE_CACHE_VERSION '2'"
  - "payload-driven TTL split — RESOLVE_MID_TTL_S (1y, immutable) for positives, RESOLVE_TTL_S (900s) for negatives"
  - "resolveOnEdge: ONE qq search subrequest (was two kuwo calls)"
  - "catalog skip-when-mid-held guard + mid-hit adoption onto qq"
  - "registerServedResolve — the caller-fed served-url registry that keeps reportDeadUrl → POST bust working"
  - "logAction('resolve.midless') — the mid-less branch is now measurable in Settings → Activity log"
affects:
  - "src/lib/sources/qq.ts (plan 32-05: the mid-hit branch calls SOURCES['qq'].resolve, so the D-05/D-09/D-12 changes land underneath it)"
  - "plan 32-07 — live Cache API semantics (does workerd honour a 1-year max-age) are ITS gate, not verifiable here"
tech-stack:
  added: []
  patterns:
    - "permanence as a property of the PAYLOAD, not the entry (two Cache-Control strings, one entry shape)"
    - "entry-shape version in the cache key as the ONLY migration (cache.delete is PoP-local)"
    - "advisory-cache shortcut: adopt an identifier, never a finished result — failure falls through to the untouched path"
    - "deliberate generation-guard NON-USE, recorded in a comment (edge-side fill, no client write-back)"
key-files:
  created: []
  modified:
    - src/lib/proxy/resolve-cache.ts
    - src/lib/proxy/resolve-cache.test.ts
    - src/lib/proxy/resolve-edge.ts
    - src/lib/proxy/resolve-edge.test.ts
    - src/routes/api/resolve/+server.ts
    - src/routes/api/resolve/resolve-endpoint.test.ts
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
    - src/lib/services/resolve-cache-client.ts
    - src/lib/services/resolve-cache-client.test.ts
    - src/lib/stores/player.svelte.test.ts
decisions:
  - "32-D-10a implemented as a two-string branch inside writeResolveEntry keyed on `entry.songid` — a half-filled entry (source set, songid null) falls to the SHORT TTL, so nothing can sneak into the permanent namespace"
  - "32-D-10: RESOLVE_CACHE_VERSION '1' → '2'; the version in the key is the whole migration, no in-place read of the old shape"
  - "the POST bust, bustResolveEntry and the served-url registry are all KEPT and got MORE load-bearing: a permanent-but-wrong mid has no other repair"
  - "the mid-hit branch gates on `cachedEntry.source === 'qq'`, not on `songid` alone — a trust-boundary check on shared PoP data, one line, so a future non-qq writer can never be mis-adopted"
  - "a mid hit flows through the SAME crossSourceLyric tail as a cold resolve (via `fromMid ?? await SOURCES[...].resolve`) instead of returning early — a hit is then never lyric-poorer than a miss, and the diff is smaller than duplicating the tail"
  - "31's T-31-04-01 source+songid equality gate is superseded, not deleted-and-forgotten: the comment records that a URL entry pinned one VERSION while a MID entry rewriting identity onto qq IS the phase's purpose"
metrics:
  duration: ~22 min
  completed: 2026-08-31
requirements: [D-01, D-06, D-07, D-10, D-10a, D-10b, D-11]
---

# Phase 32 Plan 04: Permanent-mid edge cache + the catalog mid seam Summary

The edge entry now stores a permanent qq `song_mid` instead of an expiring audio URL — positives
written for a year and immutable, negatives still capped at 900s so a flaky 0-row qq search can
never pin a song lossy PoP-wide — filled by ONE qq subrequest instead of two kuwo ones, and
consumed by a catalog seam that skips the lookup entirely when a mid is already in hand.

## What Was Built

**`src/lib/proxy/resolve-cache.ts` — the entry shape (32-D-10 / 32-D-10a).** `ResolveEntry.url` is
gone; `songid` is re-documented as a permanent qq `song_mid`, never a kuwo rid. `RESOLVE_CACHE_VERSION`
went `'1'` → `'2'` because `cache.delete` is PoP-local, so a stored old-shape entry can only be
escaped by changing the key — the file's own doc-block already prescribed exactly this and now
records that this bump is what it was written for. `writeResolveEntry` picks its `Cache-Control`
off the PAYLOAD: `public, max-age=31536000, immutable` when `entry.songid` is set, `public,
max-age=900` otherwise. `RESOLVE_TTL_S = 900`'s comment was NARROWED to negatives-only and now
carries the evidence for why (qq search returns 0 rows intermittently under load with no throw, so
a clean 0-row body is byte-indistinguishable from a genuine "no qq version"; permanent, that would
pin the song lossy for the whole PoP forever and unrepairably). The fresh-Response two-header
allow-list construction is unchanged, and `bustResolveEntry` is KEPT with a new paragraph on why it
became MORE load-bearing rather than dead.

**`src/lib/proxy/resolve-edge.ts` — the fill, kuwo → qq (32-D-01 / 32-D-10).** `qqProxy.buildUrl('search',
{ msg })` replaces the kuwo search, and the whole `detailUrl`/`detailBody` block is DELETED: `song_mid`
is on every qq search row, so the fill dropped from **two subrequests to one**. The body is parsed
with `sources/qq.ts`'s exact tolerance (bare array or `{data:[…]}`, anything else is a null FAULT);
matching still goes through `matchKey`, never a local fold. The file header now records the 32-D-01
supersession of `Skill("spike-findings-openmusic")`'s kuwo-first rule explicitly — kuwo caps at 320k
mp3 so kuwo-first and lossless are mutually exclusive, the recorded qq flakiness is in SEARCH not
DETAIL and is now capped by the 900s negative, and the kuwo/netease/joox ladder survives as the
FAILURE path. The Phase-31 `limit=10` bound has no tang equivalent and was dropped rather than
faked, with a note saying so.

**`src/routes/api/resolve/+server.ts` — comments only.** `jsonResult`'s `'Cache-Control': 'no-store'`
and the DELETE-only POST are byte-identical; the no-store doc-block gained a paragraph noting that a
year-long entry makes that rule stricter, not obsolete. The fill comments follow the new shape (one
subrequest, a mid not a url, and where the TTL split actually happens).

**`src/lib/services/catalog.ts` — the client seam (32-D-06/07/10/10b/11).**
- **Skip-when-mid-held:** `hasQqMid` (source `'qq'` with a songid, or `songMid`/`qqId` set) composed
  with the existing `lrcUnresolved` bypass into one `needsMidLookup`. A track holding a mid now makes
  **zero** `/api/resolve` calls — post-32-D-08 that is the common path, and it is the largest
  remaining latency win in the resolve chain.
- **`logAction('resolve.midless', { source, uid })`** fires exactly once per cold mid-less resolve,
  behind the readiness guard, never on a churn path.
- **Mid-hit adoption:** a new never-throw `resolveFromCachedMid` rewrites identity onto qq
  (`source`/`songid`/`uid = makeUid('qq', mid)`/`qqId`/`songMid`, `audioUrl` and `detailsLoaded`
  cleared, stale `lrcUrl` dropped) and completes it with ONE `SOURCES['qq'].resolve` — url + lyrics +
  duration together, so **no `lrcUnresolved` flag** on this path (`grep -c "lrcUnresolved: true"` in
  catalog.ts is now 0). On success the resolved url is registered so `reportDeadUrl` → POST bust
  still repairs a wrong mid. A rejection, an abort or a url-less resolve returns null and the
  pre-existing path runs untouched.
- The result threads through the same `crossSourceLyric` tail as a cold resolve via
  `fromMid ?? (await SOURCES[track.source].resolve(...))`.
- Two decision records added inline: the deliberate **generation-guard NON-USE** (32-D-06/32-D-07 —
  the fill is edge-side `waitUntil` with no client write-back, so `myGen` would be dead code;
  `prewarm.ts` is the precedent) and why `resolveNameStub` stays **kuwo-first** (32-D-01 — it is the
  failure path and qq SEARCH is the flaky half).

**`src/lib/services/resolve-cache-client.ts`.** `readResolveCache` no longer registers anything (the
url field is gone); the new `registerServedResolve(url, artist, title)` lets the caller feed the same
self-gating registry one hop later, keeping `reportDeadUrl` unchanged for the player.

**Tests (+13 net).** The highest-value new pair is the 32-D-10a TTL split, asserted at BOTH layers:
`resolve-cache.test.ts` reads the stored `cache-control` off the shim for a positive, a negative, and
a half-filled entry; `resolve-endpoint.test.ts` proves the same end-to-end through the route (a
positive fill stores permanent+immutable, a `SEARCH_DRY` fill stores `max-age=900`). `resolve-edge.test.ts`
asserts `fetchSpy.mock.calls.length === 1` on the hit path plus a tang host with `msg=` and no kuwo
host. `catalog.test.ts` gained the skip-lookup cases (spy count 0), the mid-hit identity/completeness
case, the midless-log cases, and three fall-through cases (throwing resolve, url-less resolve,
songid-null entry).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `player.svelte.test.ts`'s `serveFromCache` primed the registry through a cache READ**

- **Found during:** Task 3 (full-suite gate)
- **Issue:** The 31-D-09/31-D-11 cache-bust suite drives the REAL resolve-cache-client and primed its
  served-url registry by mocking a `{hit:true, entry:{url}}` response and awaiting
  `readResolveCache`. Since a read no longer registers anything, both cases failed — the registration
  seam moved, not the behaviour under test.
- **Fix:** the helper now calls `registerServedResolve(url, 'Jay', 'Blue')`, which is exactly what the
  production hit path does; a comment records why. No assertion was weakened (229/229 pass).
- **Files modified:** `src/lib/stores/player.svelte.test.ts` (not in the plan's `files_modified`)
- **Commit:** d824446

### Deliberate implementation choices beyond the literal plan text

- The mid-hit branch gates on `cachedEntry?.source === 'qq'` rather than on `songid` alone (the
  plan's behaviour row said "when `cachedEntry?.songid` is present"). One extra `=== 'qq'` on a
  shared-PoP payload; the plan's own key_link (`makeUid('qq', …)`) hardcodes qq, so without this a
  future non-qq edge writer would be silently mis-adopted.
- `fromMid` short-circuits the dispatch instead of returning early, so the mid path keeps the
  `crossSourceLyric` tail. Returning early would have made a hit lyric-poorer than a miss whenever qq
  detail carries no lrc — the exact class of regression 31-D-08's `lrcUnresolved` flag existed to
  prevent.

## Verification Performed

Both plan-level gates were RUN, with observed output:

- `pnpm test` → **95 test files, 1764 passed, 0 failed** (baseline after 32-02 was 95/1751; +13 tests,
  no file count change).
- `pnpm check` → **0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS** across 4380 files.
- Per-task runs observed green: `resolve-cache.test.ts` 17/17, `resolve-edge.test.ts` +
  `resolve-endpoint.test.ts` 33/33, `catalog.test.ts` + `resolve-cache-client.test.ts` 70/70,
  `player.svelte.test.ts` 229/229.
- Acceptance greps observed: `RESOLVE_CACHE_VERSION = '2'` = 1; `ResolveEntry` is exactly
  source/songid/avail; `kuwoProxy|KuwoSearchRow` in resolve-edge.ts = 0; `qqProxy` = 4; `32-D-01` = 3;
  `resolve.midless` in catalog.ts = 1; `lrcUnresolved: true` in catalog.ts = 0.
- Each task followed RED → GREEN: the failing run was observed and committed before the
  implementation (ce5ac1b→73280fb, 8b5ccdc→6f89a3e, f1d2e9c→d824446). The Task-1 RED pinned exactly
  the two intended lines (`expected '1' to be '2'`, `expected 'public, max-age=900' to be 'public,
  max-age=31536000, immutable'`).

**NOT verified here, deliberately (VALIDATION gate #3):** real Cache API behaviour. `edgeCache()`
returns `null` when `caches` is undefined, so every cache path silently no-ops under `pnpm dev` and
vitest — the in-memory shim proves the LOGIC (which `Cache-Control` string each payload gets), never
that workerd/Cloudflare HONOURS a 1-year `max-age`, nor PoP scoping, nor that `cache.put` accepts the
stored response. Plan 32-07 owns that against `pnpm preview` / the deployed URL. No runtime cache
claim is made in this summary.

## Assumption Drift (advisory)

**1. The `lrcUnresolved` flag's fate**

- **Found during:** Task 3
- **Planned:** the plan's acceptance criterion reads "`grep -c "lrcUnresolved: true"` = 0 in the
  mid-hit branch (the flag may survive elsewhere only if a non-cache path still needs it)".
- **Actual:** zero WRITES of the flag remain anywhere in `catalog.ts`; only the READ (the lyric
  re-resolve bypass) survives. Nothing in the resolve seam can set it any more — the flag is now
  written exclusively by the player's offline/blob path.
- **Why:** under the mid entry BOTH 31 hit branches collapsed into one complete resolve, so neither
  writer had a reason to exist. Recorded because a reader expecting "the flag may survive elsewhere"
  will find its only remaining producer outside this file.

## Threat Flags

None. The upstream host for the edge fill moved kuwo → qq (both auth-free, no `env`, no secret in
scope on this route), and no new endpoint, auth path, file access or schema was introduced. The
register's mitigations were implemented as specified: T-32-06 (POST structurally DELETE-only,
`ownOriginCacheKey` for every key) untouched and still asserted; T-32-07 (bust kept + served-url
registration) implemented via `registerServedResolve`; T-32-08 (negatives keep 900s) is Task 1's
highest-value test at two layers; T-32-09 (`capTerm`) untouched; T-32-10 (two-header allow-list)
untouched and still asserted.

## Known Stubs

None.
