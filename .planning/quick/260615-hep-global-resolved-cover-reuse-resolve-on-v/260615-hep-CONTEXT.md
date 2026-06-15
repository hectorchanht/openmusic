# Quick Task 260615-hep: Global resolved-cover reuse + resolve-on-view - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Task Boundary

A song cover resolved on the now-playing page is NOT reused when the same song is shown/clicked on the
homepage (still empty there). Make resolved covers globally shared and resolved-on-view, building on the
EXISTING cover pipeline (do NOT reinvent):
- `src/lib/services/cover-cache.ts` — localStorage store, dual-keyed: `uidCoverCacheKey(uid)` + name/`matchKey` via `coverCacheKey(artist,title)`; `getCachedCoverByUid`/`getCachedCover` + setters.
- `src/lib/services/cover-backfill.ts` — `resolveCoverForTrack` resolves (Deezer→iTunes→CN) and writes BOTH uid + name cache keys.
- `src/lib/actions/lazyCover.ts` — IntersectionObserver resolve-on-view; reads cache (uid→name), probes/repairs, runs the shared chain, fires `onResolved(uid,url)`.
- `src/lib/stores/player.svelte.ts` — now-playing `resolvedCover` ($state); reads `track.cover ?? getCachedCoverByUid ?? getCachedCover`, async-resolves via `resolveCoverForTrack`.

Root-cause gaps found:
1. The now-playing **`track.cover` path** (player.svelte.ts ~line 1590, `if (!this.resolvedCover) this.resolvedCover = resolved.cover;`) displays a cover that may NEVER be written to the shared cache → other surfaces can't reuse it.
2. Homepage tiles read **name-key only** (`getCachedCover(artist,title)` at +page.svelte ~lines 258/582/818), evaluated at render time, with **no `lazyCover`** and **no reactive dependency** on the cache → they don't resolve-on-view and don't repaint when a cover lands later.
</domain>

<decisions>
## Implementation Decisions

### Authoritative cross-surface match key — BOTH, name as bridge
- On EVERY resolve/landed cover, WRITE both `setCachedCoverByUid(uid,url)` AND `setCachedCover(artist,title,url)`.
- READ uid-first, then name: `getCachedCoverByUid(uid) ?? getCachedCover(artist,title)`.
- The normalized **name key (matchKey) is the cross-surface bridge** — a homepage stub and the now-playing track can carry different uids for the same song, so the name key is what makes "resolved once → shown everywhere" work. Always write the name key even when uid is present.
- Preserve the existing `matchKey` normalization in cover-cache.ts; do not change key formats.

### Cross-render reactivity — GLOBAL cache-version signal
- Add a reactive signal (a `$state` "version"/generation counter, exported from cover-cache or a small reactive wrapper) that is bumped on every cache WRITE (`setCachedCover`/`setCachedCoverByUid`/artist setters as appropriate).
- Tiles/surfaces read covers through a helper that DEPENDS on that signal, so every mounted tile repaints LIVE the instant any cover resolves anywhere (now-playing, lazyCover, backfill). This is what delivers "if a song cover is resolved, the same song gets that cover everywhere."
- Keep the store pure/SSR-safe; the reactive signal must not break the existing pure localStorage functions or their tests (wrap, don't rewrite — cover-cache.ts + cover-backfill.ts tests must stay green).

### Resolve-on-view coverage — ADD to all song tiles
- Wire `lazyCover` (IntersectionObserver resolve-on-view) into the homepage song tiles/hot-picks and any other song surface that currently renders a cover WITHOUT it, so every cover resolves when it scrolls into view.
- Reuse the existing `lazyCover` action + its `onResolved` contract (which already writes both cache layers via the shared chain). Honor lazyCover's existing guards (once-per-row, in-flight de-dupe, SSR guard, broken-URL repair).

### Now-playing must feed the cache
- Whenever now-playing has a displayed cover (including the `track.cover` path), write it to the shared cache (both keys) so other surfaces reuse it. The async `resolveCoverForTrack` path already writes; the gap is the synchronous `track.cover` / `resolved.cover` assignments — those must also `setCachedCover*`.

### Claude's Discretion
- Exact shape of the reactive signal (a `$state` counter in a `.svelte.ts` reactive module that wraps cover-cache, vs. a Svelte store) — planner/executor's call, as long as cover writes bump it and reads subscribe, and the pure cover-cache.ts functions + tests stay intact.
- Which specific tile/row components get lazyCover (homepage hot-picks tiles at minimum; extend to other coverless song surfaces consistently).
</decisions>

<specifics>
## Specific Ideas

- Cover read order everywhere: `track.cover ?? getCachedCoverByUid(uid) ?? getCachedCover(artist,title) ?? fallbackCover(seed)`. Homepage currently skips the uid layer (only name) — add uid-first.
- Surfaces that already use lazyCover (CompactRow, search, library, album, artist, charts) are the pattern to mirror for the homepage tiles.
- The now-playing fix is in `src/lib/stores/player.svelte.ts` around the `resolvedCover` assignments (~1498, ~1590, ~1656 resolveCoverAsync).
- Verification: `npm run check` 0 errors; keep `cover-cache.test.ts`, `cover-backfill.test.ts`, `lazyCover.test.ts`, and `player.svelte.test.ts` green.
</specifics>

<canonical_refs>
## Canonical References

Lineage: Phase 21 (Search & Cover Pipeline Polish) established the cover-cache / cover-backfill / lazyCover pipeline and the COVER-01/02/D-13/D-15 invariants. This task extends that pipeline's reach (now-playing write-back + global reactivity + homepage resolve-on-view). No external specs.
</canonical_refs>
