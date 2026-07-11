---
phase: 26-minimal-api-click-to-play-redesign
reviewed: 2026-07-11T12:09:44Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - src/lib/services/catalog.ts
  - src/lib/services/catalog.test.ts
  - src/lib/services/cover-backfill.ts
  - src/lib/services/cover-backfill.test.ts
  - src/lib/services/dedupe.ts
  - src/lib/services/dedupe.test.ts
  - src/lib/services/fallback.ts
  - src/lib/services/fallback.test.ts
  - src/lib/services/netease-health.ts
  - src/lib/services/netease-health.test.ts
  - src/lib/services/similar.ts
  - src/lib/services/similar.test.ts
  - src/lib/sources/netease.ts
  - src/lib/sources/netease.test.ts
  - src/lib/sources/registry.ts
  - src/lib/sources/registry.test.ts
  - src/lib/sources/types.ts
  - src/lib/stores/player.svelte.ts
  - src/lib/components/VersionPicker.svelte
  - src/routes/(app)/search/+page.svelte
  - src/routes/api/lastfm/similar-tracks/+server.ts
  - src/routes/api/lastfm/similar-tracks/similar-tracks-endpoint.test.ts
  - src/lib/i18n/en.ts
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-07-11T12:09:44Z
**Depth:** standard
**Files Reviewed:** 23 (22 in scope + `src/lib/i18n/en.ts` as reference locale; 15 sibling locale dictionaries excluded per workflow scope note)
**Status:** issues_found

## Summary

Reviewed the click-to-play API-call-reduction redesign: kuwo-first resolve order (registry.ts,
catalog.ts's `resolveNameStub`/`crossSourceLyric`), the `track.getSimilar` Up-Next rewrite
(similar.ts + the new `/api/lastfm/similar-tracks` route), the lazy Deezer-only cover upgrade
(cover-backfill.ts's `resolveDeezerHQ` + player.svelte.ts's `upgradeCoverAsync`), the netease
health gate (netease-health.ts), and the version picker (VersionPicker.svelte +
search/+page.svelte's `groupVariants` wiring). All 319 existing/added unit tests pass and
`pnpm check` is clean.

The core mechanics (kuwo-first single-source walks, per-tier never-throw cover chains, the
Last.fm key never reaching the client, generation-guarded async cover lands) are solid and well
tested at the service-seam level. However, tracing the NEW `buildSimilarQueue` rewrite against
its only caller that runs on literally every fresh click-to-play (`player.svelte.ts`'s
`regenerate()`, the default 'generated' Up-Next mode) surfaces a reproducible bug where the
auto-generated Up-Next can silently end up completely empty even though a working fallback path
sits unused in the same function (see CR-01, proven with a throwaway repro test, not committed).
Two further robustness gaps involve state that is deliberately shared across module-scope
(netease-health.ts — fine) versus state that ISN'T persisted where the project's own conventions
say it should be (the version-picker's `variantGroups` after a `searchSession` restore), plus a
test-hermeticity gap where the new player-level cover-upgrade path is exercised by existing tests
but never mocked or asserted.

## Critical Issues

### CR-01: `buildSimilarQueue`'s primary-path gate uses the pre-filter count, so a thin similar-track response can silently return an empty Up-Next with a working fallback sitting right there, unused

**File:** `src/lib/services/similar.ts:164-177` (interacts with `src/lib/stores/player.svelte.ts:2965-2992`, the `regenerate()` caller that runs on every fresh click-to-play in the default `'generated'` Up-Next mode)

**Issue:** The PRIMARY (`track.getSimilar`) branch is gated on the RAW, pre-filter `stubs.length`,
not on the actual number of USABLE candidates left after dropping the seed song, the
`excludeUids` set, and same-song dupes:

```ts
const stubs = await fetchSimilarTracks(track.artist, track.title);
if (stubs.length) {                       // <-- gates on the UNFILTERED count
    ...
    for (const s of stubs) {
        if (matchKey(s.artist, s.title) === seedKey) continue;
        if (excludeUids.has(s.uid)) continue;
        if (seen.has(s.uid)) continue;
        seen.add(s.uid);
        out.push(s);
    }
    return out;                            // <-- can be [] even though stubs.length > 0
}
// FALLBACK (artist.getSimilar) is never reached when stubs.length > 0, no matter how `out` turned out.
```

When the upstream `track.getSimilar` response is thin (a realistic case for less-mainstream
songs — the file's own docstring already documents "some newer CN songs have thin Last.fm
scrobble data") and every returned pair happens to be the seed itself or already in
`excludeUids` (very plausible in a longer single-artist/genre listening session, since
`excludeUids` accumulates played/queued/swiped history and `track.getSimilar` candidates for one
song skew toward the SAME artist's other tracks), `out` ends up `[]` while the artist-hop
FALLBACK branch below — which explicitly exists to cover exactly this "route is dry" scenario —
is never attempted, because the guard checks `stubs.length`, not `out.length`.

This directly regresses the project's own "never-stop" invariant for auto-continuation: unlike
`ensureAhead()` (`player.svelte.ts:1978-1981`), which has an explicit safety net
(`if (!more.length) more = await buildDiversePicks(8, have);`), `regenerate()`
(`player.svelte.ts:2965-2992`) — the function invoked on **every fresh click-to-play** when the
default `'generated'` Up-Next mode is active — has no such fallback and just installs whatever
`buildSimilarQueue` returns, including `[]`.

Verified with a standalone repro (written to `src/lib/services/__scratch_similar_repro.test.ts`,
run, and removed — not part of this diff): a seed with exactly one Last.fm-similar pair that is
already in `excludeUids` returns `out.length === 0` even though the `/api/similar` (artist-hop)
fallback stub was configured to return a usable artist name in the same test. A prior version of
this function (`git show 9aa5e22^:src/lib/services/similar.ts`) had the identical
"gate-on-pre-filter-length" shape, but the OLD primary path drew top tracks from 8 DIFFERENT
similar ARTISTS (much more diversity, much lower collision odds with `excludeUids`), while the
NEW primary path draws up to 20 candidates for the SAME seed SONG (skewed toward the same
artist/album — the case explicitly most likely to already be in a listening session's history).
The rewrite therefore makes an already-latent gate bug measurably more likely to trigger in
exactly the flow this phase optimizes.

**Fix:**
```ts
const stubs = await fetchSimilarTracks(track.artist, track.title);
if (stubs.length) {
    const seedKey = matchKey(track.artist, track.title);
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const s of stubs) {
        if (matchKey(s.artist, s.title) === seedKey) continue;
        if (excludeUids.has(s.uid)) continue;
        if (seen.has(s.uid)) continue;
        seen.add(s.uid);
        out.push(s);
    }
    if (out.length) return out;   // only short-circuit when the primary actually produced something
    // else fall through to the artist.getSimilar fallback below
}
```
Additionally, consider giving `regenerate()` in `player.svelte.ts` the same
`buildDiversePicks` safety net `ensureAhead()` already has, so a total miss on BOTH
`buildSimilarQueue` paths still leaves the queue non-empty.

## Warnings

### WR-01: VersionPicker's `variantGroups` is not persisted in `searchSession`, so the version-picker affordance silently disappears after a session restore

**File:** `src/routes/(app)/search/+page.svelte:62, 390-419`; `src/lib/stores/searchSession.svelte.ts` (whole file — `save()`/`SearchSession` fields)

**Issue:** `variantGroups` (the uid → cross-source-variant lookup driving the new "Layers" /
version-picker button) is a page-local `$state` rebuilt only inside `run()`/`loadMore()`
(`buildVariantGroups(interleaved)`). `searchSession.svelte.ts`'s `SearchSession.save()`/fields
persist `q`, `results`, `page`, `hasMore`, `searched`, `artistTiles`, `artistTilesFor` — but
never the raw pre-dedupe `interleaved` set or `variantGroups` itself. On `onMount` (lines
390-419), when `searchSession.hasPrior` restores a prior search instantly (the documented D-02
behavior — "the Search tab restores INSTANTLY"), `results` is repopulated but `variantGroups`
stays at its freshly-mounted default `{}`. Since the "Layers" trigger is gated on
`(variantGroups[t.uid]?.length ?? 0) > 1` (line 595), it silently never renders for any row after
a tab-away-and-back restore, even though every one of those rows may genuinely have multiple
source variants — until the user runs a brand-new search. This is a real, user-visible
regression of the just-shipped VERSIONS-01 feature that the project's own service-layer test
suite cannot catch (per CLAUDE.md, there is no jsdom/component test harness), so it will not
surface in `pnpm test`.

**Fix:** Either persist the raw pre-dedupe `interleaved` array (or the already-computed
`variantGroups` record) alongside `results` in `SearchSession`/`save()`, and restore + rebuild it
in the `onMount` hydration branch, e.g.:
```ts
// searchSession.svelte.ts
interleaved = $state<Track[]>([]);
// save({ ..., interleaved })  /  this.interleaved = s.interleaved ?? [];

// +page.svelte onMount, inside the hasPrior branch:
variantGroups = buildVariantGroups(searchSession.interleaved);
```

### WR-02: New `upgradeCoverAsync` player path has no dedicated test coverage and is exercised un-mocked by existing player tests

**File:** `src/lib/stores/player.svelte.ts:2694-2701, 2783-2820`; `src/lib/stores/player.svelte.test.ts:38-90`

**Issue:** `player.svelte.test.ts` explicitly mocks `resolveCoverForTrack` (the sibling
full-chain resolver) so `resolveCoverAsync`'s generation guard / cache-write-skip /
MediaMetadata-refresh behavior is observable and controllable (see the
`player.resolvedCover — single-field artwork guarantee` describe block, ~line 1993). The new
`resolveDeezerHQ` (and the `deezerSongCover` it calls) is **not** mocked anywhere in this file.
Since many existing tests construct tracks with `cover: 'https://...'` (e.g. lines 2044, 2106,
2128-2130, 2323) and then call `player.play(...)`, every one of those now fires the new
`else if (httpsOnly(this.resolvedCover)) void this.upgradeCoverAsync(resolved, myGen);` branch
added in this phase, invoking the REAL `resolveDeezerHQ → deezerSongCover → apiFetch → fetch('/api/deezer/search?...')`
with a relative URL in the Node/vitest environment (no `document`/`location`, no `fetch` mock for
this path). The call is swallowed by `resolveDeezerHQ`'s own never-throw wrapper, so tests
currently still pass, but:
  - the new `upgradeCoverAsync` integration (generation-guard bail, `url === this.resolvedCover`
    dedupe, mutual exclusivity with `resolveCoverAsync`, fresh `MediaMetadata` re-fire) has **zero**
    assertions at the player-store level — only the underlying `resolveDeezerHQ` service function
    is unit-tested (`cover-backfill.test.ts`);
  - every cover-bearing `play()` test now performs an unmocked, real (if immediately-failing)
    network attempt as an untracked side effect, which is a test-hermeticity regression that could
    turn into flakiness or noisy rejections if the fetch/URL environment ever changes.

**Fix:** Add `resolveDeezerHQ` to the existing `vi.mock('$lib/services/cover-backfill', ...)`
block in `player.svelte.test.ts` (mirroring how `resolveCoverForTrack` is already mocked), and add
a describe block exercising `upgradeCoverAsync` the same way the existing
`resolvedCover — single-field artwork guarantee` suite exercises `resolveCoverAsync` (miss / hit /
supersede / same-URL no-op / MediaMetadata refresh).

### WR-03: `resolveNameStub`'s exhaustive single-source walk and `tryFallback`'s independent walk duplicate work on a genuine miss, undercutting the phase's own call-reduction goal

**File:** `src/lib/services/catalog.ts:228-272` (`resolveNameStub`); `src/lib/services/fallback.ts:32-110` (`fallbackOrder`/`tryFallback`); `src/lib/stores/player.svelte.ts:2590-2596, 3165-3231` (`runFallback`)

**Issue:** When a `resolveByName` stub (the Up-Next lazy stub from `similar.ts`) fails to
resolve, `resolveNameStub` has already walked and exhausted **every enabled source** in
kuwo-first order (`catalog.ts:256-270`) before returning `null`. `ensureTrackDetails` then
returns the original, still-unresolved stub (`catalog.ts:300-301`), whose `source` field is only
ever the never-dispatched PLACEHOLDER chosen by `similar.ts`'s `primarySourceId()` (typically
`'kuwo'`). `player.play()` treats this as `!resolved.audioUrl` and calls `runFallback(resolved)`
(`player.svelte.ts:2595`), which seeds `fallbackAttempted` with only `failed.source` (the
placeholder) and then calls `tryFallback`, whose `fallbackOrder` excludes just that one source
(`fallback.ts:37-43`). Since the placeholder was never actually dispatched as a real attempt, but
happens to coincide with the FIRST source `resolveNameStub` already tried, `tryFallback` re-walks
essentially every OTHER source `resolveNameStub` already exhausted (qq/netease/joox/…), doubling
the network cost of a genuine Up-Next resolve miss — directly counter to the phase's own
~59→~3 call-budget goal (spike-003).

**Fix:** Either (a) have `ensureTrackDetails`/`resolveNameStub` surface which sources were
actually tried (e.g. return the exhausted `Set<SourceId>` alongside the null, or attach it to the
returned stub) so `runFallback`/`tryFallback` can seed `attempted` with the FULL set instead of
just the placeholder, or (b) short-circuit `player.play()`/`runFallback` to skip the fallback
entirely for a `resolveByName` miss (since `resolveNameStub` already IS the fallback walk for that
class of track) and surface the total-failure path directly.

### WR-04: `groupVariants`'s blank-key guard is incomplete — it only catches a FULLY blank title+artist, not a partially-blank one, despite its docstring's claim

**File:** `src/lib/services/dedupe.ts:31-41` (`key()`, unchanged/inherited), `79-90` (`groupVariants`, new in this phase)

**Issue:** `groupVariants`'s docstring states it "mirrors the blank-key guard: an untitled stub
keys by its own `uid` so two blank stubs never merge into one group." The guard actually used
(`!k || k === '|'`, inherited verbatim from `dedupeBest`) only catches the case where BOTH title
AND artist normalize to empty. A stub with a blank title but a REAL artist (or vice versa)
produces a key like `"|someartist"`, which is truthy and not literally `'|'`, so it is NOT routed
through the per-uid fallback key. Two distinct untitled tracks by the same artist (e.g. two
different unnamed bonus/interlude entries from one source) would therefore incorrectly collapse
into a single `groupVariants` entry (and, since `key()` is shared, into a single `dedupeBest`
winner too — a pre-existing exposure in `dedupeBest` now also inherited by the new picker
feature). Verified: `key({title:'',artist:'Some Artist'})` and a second identical stub both
produce `"|someartist"`, which passes the `!k || k==='|'` guard as "not blank."

**Fix:** Broaden the guard to catch a partially-blank identity too, e.g.:
```ts
const blankTitle = !norm(t.title); // norm() would need factoring out, or check t.title.trim()
const gk = !t.title?.trim() || !t.artist?.trim() ? t.uid : k;
```
or simplify to "key by uid whenever EITHER normalized half is empty," and mirror the same fix in
`dedupeBest`'s identical check for consistency (both currently share the same underprotective
guard).

### WR-05: `netease.ts`'s health-gate check-then-act is not atomic across concurrent `search()` calls right at the window boundary

**File:** `src/lib/sources/netease.ts:45-53`; `src/lib/services/netease-health.ts:64-70`

**Issue:** `isGated()` is read synchronously at the top of `search()`, before any `await`. If two
or more `netease.search()` calls are in flight at (or just after) the moment `GATE_WINDOW_MS`
elapses (e.g. a full-catalog fan-out search overlapping with a concurrent `resolveNameStub`/
`crossSourceLyric` single-source walk that also happens to target netease), more than the
intended "exactly ONE probe per window" can slip through, since each caller's `isGated()` check
happens independently before either has issued its network call. This is a minor deviation from
the documented "1 wasted call per window" guarantee (`netease-health.ts:29-33`) rather than a
functional defect — the gate still trips again immediately if the extra probes are also dry — but
worth noting since the design comment states the stronger guarantee.

**Fix:** Low priority given the graceful degradation; if the stronger guarantee matters, gate the
"one probe" behind a plain in-flight flag (`let probing = false`) alongside the timestamp so a
second concurrent caller during the open window also short-circuits to `[]` until the first
probe settles.

## Info

### IN-01: An inline cover that is non-null but not `https:` triggers neither the miss-chain nor the Deezer upgrade

**File:** `src/lib/stores/player.svelte.ts:2693-2701`

**Issue:** `if (!this.resolvedCover) void this.resolveCoverAsync(...); else if (httpsOnly(this.resolvedCover)) void this.upgradeCoverAsync(...);` leaves a narrow gap: a `resolvedCover` that is truthy but fails `httpsOnly` (e.g. a stray `http:`/`data:` URL from an inline source field) fires neither branch, so it can never self-heal to a Deezer HQ cover nor fall through to the full chain. Given the project's stated convention that sources should always emit https covers, this is a low-likelihood edge case, but it is a silent dead end if it ever occurs (no cache write, no upgrade attempt, ever, for that track).

**Fix:** Consider `else if (!httpsOnly(this.resolvedCover)) void this.resolveCoverAsync(resolved, myGen); else void this.upgradeCoverAsync(resolved, myGen);` so a non-https inline value gets a chance at the full chain instead of being permanently stuck.

### IN-02: Synthetic Up-Next stub uid embeds a live-settings-dependent placeholder source, cached for 6h

**File:** `src/lib/services/similar.ts:62-79` (`fetchSimilarTracks`, cached 6h), `87-89` (`primarySourceId`), `105-139` (`nameStub`)

**Issue:** `nameStub()`'s synthetic uid is `${primarySourceId()}:similar-${matchKey(artist,title)}`, where `primarySourceId()` reads the live `getEnabledAdapters({})[0]`. The whole stub list this produces is memoized for `TTL_SIMILAR` (6h) keyed only on `{artist,title}`. If a user toggles their enabled-sources setting mid-session, a cache hit within the 6h window keeps serving stubs whose uid prefix reflects the OLD primary source, while a fresh (post-expiry) build for the same song would compute a DIFFERENT uid prefix — a transient identity mismatch that could let a "same song" reappear as a distinct Up-Next entry across that boundary. Low likelihood (requires a settings change mid-session) and self-heals once the cache entry expires.

**Fix:** Derive the synthetic uid from a fixed, source-independent prefix (e.g. `similar:<matchKey>` with no real `SourceId` namespace) instead of the live primary source, since the `source` field is documented as "never dispatched" anyway.

---

_Reviewed: 2026-07-11T12:09:44Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
