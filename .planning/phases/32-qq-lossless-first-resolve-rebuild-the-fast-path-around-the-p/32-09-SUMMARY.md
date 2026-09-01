---
phase: 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
plan: 09
subsystem: edge-resolve-cache / catalog-resolve-seam
tags: [edge-cache, cache-ttl, qq, playable-url, latency, cache-bust, poisoned-hit, quality-tier]
requires:
  - "32-04's v2 permanent-mid entry + payload-driven TTL split — D-20 keeps both and adds a second payload beside them"
  - "32-05's rebuilt sources/qq.ts pickBestPlayUrl — the CLIENT rung authority the edge mirror cross-refs"
  - "32-01's effectiveQuality() — the 'auto' → concrete-tier seam both new gates read"
provides:
  - "v3 ResolveEntry: permanent songid + short-TTL url/urlExp/urlQuality, RESOLVE_CACHE_VERSION '3'"
  - "RESOLVE_URL_TTL_S (900s) + pure urlIsFresh() — url lifetime lives IN the payload, not in a second Cache-Control"
  - "resolveUrlOnEdge(mid) — the ONE server-side url producer (one tang detail call, lossless rungs, https upgrade)"
  - "GET refresh-on-read: a stale/absent url is nulled in the view and refilled via waitUntil"
  - "client read order url → songid → cold walk, with a reported-dead strip at the ONE read seam"
  - "narrowed SKIP-WHEN-MID-HELD: lossless mid-holders read, '320'/'128' mid-holders still skip"
affects:
  - "plan 32-07 — must execute AFTER this plan (conceptually wave 4); its live-workerd checks now cover the url layer, see 'Handoff to 32-07' below"
  - "every warm qq play in a PoP — a tier-matching url hit now costs zero tang subrequests"
tech-stack:
  added: []
  patterns:
    - "mixed-lifetime cache entry: one Cache-Control decided by the PERMANENT payload, the short-lived payload carrying its own in-payload expiry"
    - "refresh-on-read as the single producer for three cases (initial absence, expiry, post-bust refill)"
    - "one freshness authority — the edge nulls a stale field out of the VIEW so the client never interprets a timestamp"
    - "client-side reported-dead strip at the single read seam, closing an async PoP-local bust race"
    - "deliberate small server-side mirror of a client ladder, with the client named as authority and both exclusions justified"
key-files:
  created: []
  modified:
    - src/lib/proxy/resolve-cache.ts
    - src/lib/proxy/resolve-cache.test.ts
    - src/lib/proxy/resolve-edge.ts
    - src/lib/proxy/resolve-edge.test.ts
    - src/routes/api/resolve/+server.ts
    - src/routes/api/resolve/resolve-endpoint.test.ts
    - src/lib/services/resolve-cache-client.ts
    - src/lib/services/resolve-cache-client.test.ts
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
decisions:
  - "32-D-20 implemented as a mixed-lifetime entry: writeResolveEntry's TTL branch is BYTE-IDENTICAL (songid alone still picks the Cache-Control) and the url's 900s lives as an in-payload urlExp the edge checks at read time"
  - "RESOLVE_CACHE_VERSION '2' → '3' — a shape change is a KEY change even when the old shape reads survivably; the rule is categorical because there is no remediation after deploy"
  - "the own-mid equality guard was extended to cover the MID adoption as well as the url adoption — with a lossless mid-holder now reading the cache, a colliding entry could otherwise rewrite the identity of a track that already knows which song it is"
  - "the edge rung walk excludes accom (32-D-18) AND the bare song_play_url fallback (unknown tier, and this url is tier-tagged); both exclusions only cost a cache miss on that song, since the client ladder still reaches them via the mid path"
  - "the poisoned-hit fall-through is asserted at three layers rather than one: the strip (resolve-cache-client.test.ts), the catalog fall-through (catalog.test.ts 'POISONED HIT'), and the unmodified player 31-D-11 suite"
metrics:
  duration: ~28 min
  completed: 2026-08-31
requirements: [D-20]
---

# Phase 32 Plan 09: Restore the playable-url cache layer Summary

The edge resolve entry now carries a short-lived, tier-tagged `url` beside its permanent `song_mid`
— restoring the Phase-31-measured 0.44s-to-playable path that 32-04 removed — with the poisoned-hit
fall-through (403/dead/expired url → mid path → plays, no user-visible error) asserted at three
layers as the primary acceptance criterion rather than the fast hit.

## What Was Built

**`src/lib/proxy/resolve-cache.ts` — the v3 entry (32-D-20).** `RESOLVE_CACHE_VERSION` `'2'` → `'3'`,
with the doc-block recording *why the bump happened even though a v2 entry reads survivably as v3*:
the file's own rule is categorical because `cache.delete` is PoP-local and there is no remediation
after deploy. `ResolveEntry` gained `url` / `urlExp` (epoch ms, edge-clock bookkeeping) /
`urlQuality`, each with its own doc comment. New `RESOLVE_URL_TTL_S = 900` — the same *number* as
`RESOLVE_TTL_S` under a deliberately different *name*, because `RESOLVE_TTL_S` now means "how long a
NEGATIVE is pinned" and the two must stay independently tunable. New pure
`urlIsFresh(entry, now)` (fails closed on a missing `urlExp`). **`writeResolveEntry`'s TTL branch is
byte-identical**: the `songid` alone still decides the stored `Cache-Control`, and a sentence was
added saying the url deliberately does NOT influence it. `bustResolveEntry` untouched.

**`src/lib/proxy/resolve-edge.ts` — `resolveUrlOnEdge`.** `resolveOnEdge` and the `DRY` constant
gained the three null fields and are otherwise unchanged: **the search fill is still exactly ONE
subrequest**, with a comment saying the url producer lives elsewhere on purpose. The new never-throw
`resolveUrlOnEdge(mid, signal)` builds the tang detail URL through `qqProxy.buildUrl('detail', {mid})`
(mid alone, no `msg` — 32-D-09), guards liveness on `!d.song_mid` rather than `res.ok` (the all-null-200
bad-mid body), walks `sq → pq → hq → standard → fq` via a named `LOSSLESS_RUNGS` array,
https-upgrades the winner (32-D-05) and stamps `urlExp = now + RESOLVE_URL_TTL_S * 1000` with
`urlQuality: 'lossless'`. Its comment block names `sources/qq.ts pickBestPlayUrl` as the client
authority, explains why importing it is impossible (it drags the settings runes store and the client
`apiFetch` governor edge-side, which this file's standing rule forbids), and justifies both
exclusions — `accom` (32-D-18: 伴奏 / `.ogg`, undecodable on iOS Safari) and the bare
`song_play_url` fallback (unknown tier, while this url is tier-tagged).

**`src/routes/api/resolve/+server.ts` — refresh-on-read.** On a hit with a `songid` whose url is not
fresh, the route schedules one bounded `waitUntil(resolveUrlOnEdge(...))` that rewrites the entry,
and answers *this* request with the url/urlExp/urlQuality nulled out. One mechanism covers three
cases (initial absence, 900s expiry, post-bust refill). A null refresh writes nothing, mirroring the
fill's FAULT rule. `jsonResult` and its `'Cache-Control': 'no-store'` doc-block are byte-identical,
the POST bust is untouched, and the file still exports only `GET`/`POST`/`OPTIONS`.

**`src/lib/services/resolve-cache-client.ts` — the reported-dead strip.** `readOrThrow` nulls
`entry.url` when the module's `reported` set already contains it. The POST bust is async and
PoP-local, so a re-resolve inside the race window would otherwise re-adopt the exact url it just
reported dead; this one line at the single read seam is what makes "a poisoned hit is
indistinguishable from a miss" **deterministic rather than eventual**. It reads `reported`, never
`servedUrls`, because `reportDeadUrl` evicts from the latter on the way past — a test pins that.

**`src/lib/services/catalog.ts` — read order and the narrowed gate.**
- **SKIP-WHEN-MID-HELD narrowed** per the plan: `tier = effectiveQuality(quality ?? settings.defaultQuality)`,
  and the read gate is now `!lyricBypass && (!hasQqMid || tier === 'lossless')`. A `'320'`/`'128'`
  mid-holder keeps 32-04's zero-read path exactly (the url is lossless-only by construction, so it
  can gain nothing); a lossless mid-holder pays ≤400ms bounded for a chance at saving 2.0-3.8s. The
  `resolve.midless` log keeps its **exact 32-04 condition**, so the Activity-log signal's meaning is
  unchanged even though the read condition moved.
- **URL-HIT branch** ahead of the mid adoption: adopts only when the entry is qq, has a songid, has a
  url, `urlQuality === tier`, and the track's own mid (if any) equals the entry's. It registers the
  url first, then returns the Phase-31 hit shape rebuilt for qq identity with `lrcUnresolved: true`,
  bypassing the `crossSourceLyric` tail (a serial lyric search would eat the 0.44s this branch exists for).
- **The mid adoption stays byte-identical below it**, except for the own-mid guard noted under
  Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] The own-mid guard was extended to the MID adoption, not just the url adoption**

- **Found during:** Task 2
- **Issue:** The plan put the `(!ownMid || ownMid === cachedEntry.songid)` guard on the url branch
  only, with the stated rationale "a matchKey collision must not play the wrong song for a track that
  already knows its identity". But the narrowed gate now lets a *lossless mid-holder* read the cache
  for the first time, and the mid-hit adoption sitting one branch lower would then rewrite that
  track's identity onto the colliding entry's mid — playing exactly the wrong song the url guard was
  written to prevent, via the other branch. Guarding only the branch the plan named would have left
  the sibling caller broken.
- **Fix:** `cachedMid` is now gated on the shared `entryMatchesOwn` predicate, so both adoptions
  refuse a colliding entry for a track that already knows its identity. One shared const, two call
  sites, 32-D-20-commented at the mid site.
- **Files modified:** `src/lib/services/catalog.ts`
- **Commit:** dc63b19
- **Coverage:** the `MID GUARD` case asserts the netease path runs and `SOURCES.qq.resolve` is never
  called; its sibling asserts a *matching* own mid still adopts.

### Intended assertion changes (not weakenings)

- **`resolve-endpoint.test.ts`: "a SECOND identical GET is a HIT with ZERO subrequests" → "…is a
  HIT".** The search fill writes a url-LESS positive, so that second read is now precisely the
  refresh-on-read trigger and spends one bounded background detail call. The zero-subrequest property
  did not disappear — it **moved to the url-warm read**, which is the one a user's repeat play
  actually hits, and is now asserted explicitly (third GET: fresh url, zero subrequests, no
  `waitUntil`). Both halves are commented in the test.
- **`catalog.test.ts`: the 32-04 "a mid-holder makes zero reads" cases were re-scoped to `'320'`/`'128'`**
  and pin their tier explicitly (`ensureTrackDetails(track, undefined, '320')`) instead of relying on
  the ambient default. A new lossless counterpart asserts the read DOES happen. This is D-20's
  narrowing landing in the assertions, and the describe block carries a comment saying so.

## Assumption Drift (advisory)

**1. `grep -c "lrcUnresolved: true"` in `catalog.ts` returns 2, not the plan's 1**

- **Found during:** Task 2 acceptance greps
- **Planned:** the acceptance criterion reads `grep -c "lrcUnresolved: true" src/lib/services/catalog.ts → 1`.
- **Actual:** 2 — line 455 is the single actual WRITER, line 431 is the `32-D-20` comment that quotes
  the flag name while recording the deliberate reversal of 32-04's "zero writes remain" outcome.
- **Why:** the plan asked for both the writer and a comment naming it, and the grep cannot tell them
  apart. Exactly ONE writer exists (`grep -n` confirms), which is what the criterion meant.

## Verification Performed

Both plan-level gates were RUN, with observed output:

- `pnpm test` → **101 test files, 1916 passed, 0 failed** (baseline after 32-06 was 101/1891; +25 tests,
  no file-count change).
- `pnpm check` → **0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS** across 4406 files.
- Per-task runs observed green: task 1's three files 65/65, task 2's two files 80/80.
- `pnpm vitest --run src/lib/stores/player.svelte.test.ts` → **241 passed, 0 failed, with ZERO edits
  to that file in this plan's commits** (`git log 202685d..HEAD -- player.svelte.test.ts` shows only
  32-06 and two pre-phase quick tasks). The 31-D-09/31-D-11 cache-bust suite therefore passes
  unmodified — the seam this plan touched did not move under it.
- Each task followed RED → GREEN with the failing run observed and committed first: 20968a8 (19
  failed) → eae8955, d5ba4ed (5 failed) → dc63b19.
- Acceptance greps observed: `RESOLVE_CACHE_VERSION = '3'` = 1; `RESOLVE_MID_TTL_S = 31_536_000` = 1
  (32-04 pin); `RESOLVE_URL_TTL_S` in resolve-cache.ts = 2; `urlIsFresh` in +server.ts = 2;
  `resolveUrlOnEdge` in resolve-edge.ts = 3 / +server.ts = 2; `'Cache-Control': 'no-store'` = 1
  (32-04 pin, byte-identical); `bustResolveEntry` in +server.ts = 2 (POST retained);
  `registerServedResolve(cachedEntry.url` = 1; `effectiveQuality` in catalog.ts = 2;
  `resolve.midless` = 1. `grep -cE "export (async )?function"` in +server.ts returns 1, which is a
  COMMENT (`grep -n '^export'` shows only `GET`/`POST`/`OPTIONS`) — the pre-existing 32-04 state, and
  `jsonResult` is still private.
- `song_play_url_accom` appears once in resolve-edge.ts, in the comment that NAMES the exclusion; the
  walk array `LOSSLESS_RUNGS` contains only sq/pq/hq/standard/fq, and a test asserts a body carrying
  only `accom` + the bare fallback resolves to `null`.
- D-16: `git diff dc63b19~4..HEAD -- src/lib/stores/player.svelte.ts` is **empty** — this plan made
  zero player edits. (The `202685d..HEAD` phase diff is not empty, but every hunk in it belongs to
  32-06 and to the pre-phase `quick-260831-t2g` cover fix, not to 32-09.)

**NOT verified here, deliberately (VALIDATION gate #3):** any runtime cache behaviour. `edgeCache()`
returns `null` when `caches` is undefined, so every cache path silently no-ops under `pnpm dev` and
vitest — the in-memory shim proves the LOGIC (which header each payload gets, that a stale url is
nulled and refilled), never that workerd honours the headers, that `waitUntil` lands, or that the v3
key rolls over cleanly. No runtime claim is made in this summary.

## Handoff to 32-07 (execute it AFTER this plan — conceptually wave 4)

32-07 is frontmattered wave 3 alongside this plan, but it must ASSEMBLE this plan's output, so run it
last. Its live-workerd verification now also covers the url layer. Two NEW walks to add against
`pnpm preview` / the deployed URL:

1. **stale-url → refresh.** GET a song twice. The first GET after the search fill should return
   `entry.url === null` with `entry.songid` set; the SECOND GET (a moment later, same PoP) should
   return a populated, https `entry.url` with `urlQuality: "lossless"`. That proves the
   `waitUntil(resolveUrlOnEdge(...))` refresh actually lands in workerd — the single thing unit tests
   structurally cannot show.
2. **bust → miss → mid-only → url-warm.** POST the bust for that song (`{busted:true}`), then GET
   three times: expect `{hit:false}` (miss), then a hit with `songid` set and `url: null` (the search
   fill re-ran, mid-only), then a hit with a fresh `url` (the refresh warmed it). That walks the full
   repair contract end to end and is the live proof that a poisoned entry self-heals.

Also worth confirming while there: a v3 key (`v=3` in the `/api/resolve/_k?` namespace) is what gets
written, and the rewritten entry still comes back with `public, max-age=31536000, immutable`.

## Deliberate reversals of 32-04 (decisions, NOT regressions)

For `/gsd:verify-work` reading 32-04's SUMMARY alongside this one:

1. **`ResolveEntry.url` is back**, under v3. 32-04 removed it on the reasoning recorded at
   `resolve-cache.ts` — *"it was the only reason this entry had to expire"* — which was true under a
   SINGLE-TTL entry and was obsoleted minutes later by 32-D-10a's per-payload TTL split. 32-D-20
   reconciles the two: the mid keeps its year, the url keeps its own 15 minutes as an in-payload
   `urlExp`. Motive: a mid still costs a 2.0-3.8s tang detail RTT to become playable; a cached url is
   the 0.44s path. The 31-D-11 403 risk is knowingly re-accepted for that, with all three mitigations
   retained and tested.
2. **The `lrcUnresolved: true` writer is back in `catalog.ts`.** 32-04's SUMMARY recorded "zero
   writes of the flag remain in catalog.ts" as an outcome; the url-hit branch reinstates exactly one,
   because a cached url carries no lyrics — the 31 flag's original reason — and the early return must
   bypass the lyric tail. The mid path still writes none.
3. **"A repeat GET costs zero subrequests" is now "a url-WARM GET costs zero subrequests."** See
   Intended assertion changes above.

## Known Stubs

None.

## Threat Flags

None new. The register's mitigations were implemented as specified: T-32-09-01 (url derived ONLY by
`resolveUrlOnEdge`, both fill and refresh edge-executed; POST still structurally DELETE-only, no
client write path) — implemented and asserted; T-32-09-02 (the accepted 403 risk) — all three
mitigations shipped, with the fall-through asserted at three layers; T-32-09-03 (matchKey collision)
— own-mid equality guard, widened to cover both adoptions; T-32-09-04 (no in-flight marker on the
refresh) — accepted and recorded in the route comment, bounded by `waitUntil` + `FILL_TIMEOUT_MS` +
one subrequest; T-32-09-05 (stale-url leak) — the edge nulls a stale url in the view, one clock, one
authority, and the client never reads `urlExp`. No new endpoint, auth path, file access or schema.
Zero packages installed.

## Self-Check: PASSED

All five modified source files exist on disk; all four claimed commits (20968a8, eae8955, d5ba4ed,
dc63b19) resolve in `git log`. Spot greps confirmed `RESOLVE_CACHE_VERSION = '3'`, `urlIsFresh` and
`RESOLVE_URL_TTL_S` are exported from `resolve-cache.ts`, `resolveUrlOnEdge` is exported from
`resolve-edge.ts`, and `jsonResult`'s `'Cache-Control': 'no-store'` is still present exactly once.
