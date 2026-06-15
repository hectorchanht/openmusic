---
slug: charts-tags-same-cover
status: resolved
trigger: "charts/tags/{xxx} pages are showing same cover for all the different songs. cover should always match the song"
created: 2026-06-15
updated: 2026-06-15
---

# Debug: charts/tags pages show same cover for all songs

## Symptoms

- **Expected behavior:** On charts/tags/{xxx} pages, each song row shows its own matching cover art.
- **Actual behavior:** Every song row on the page displays the same (identical) cover image, regardless of the actual song.
- **Error messages:** None reported.
- **Timeline:** Not specified.
- **Reproduction:** Navigate to a charts/tags/{xxx} page (e.g. tag "rock"). Screenshot shows ~14 different songs (Sign of the Times, Everlong, Still Into You, etc.) all rendering the identical cover thumbnail.

## Current Focus

- hypothesis: empty-uid stub rows collapse onto the shared `'uid:'` cover-cache slot (CONFIRMED)
- next_action: (resolved)
- test: lazyCover.test.ts + cover-backfill.test.ts empty-uid regression cases
- expecting: each distinct row resolves + caches under its own {artist,title} identity
- reasoning_checkpoint: (resolved)

## Evidence

- timestamp 2026-06-15: charts/tags/[tag]/+page.svelte:48-54 — `stubTrack(it)` sets `uid: ''` for EVERY row, then passes that stub into `use:lazyCover` (line 192-195).
- timestamp 2026-06-15: lazyCover.ts:47 (original) — cache-first read `getCachedCoverByUid(track.uid) ?? getCachedCover(...)`. With `uid: ''`, `getCachedCoverByUid('')` reads the shared `'uid:'` slot, short-circuiting the correct {artist,title} name lookup.
- timestamp 2026-06-15: lazyCover.ts:64 (original) — in-flight de-dupe `inFlight.has(track.uid)` keys on `''`, so once the first empty-uid row enters the chain, all other rows are skipped.
- timestamp 2026-06-15: cover-backfill.ts:168 (original) — `setCachedCoverByUid(track.uid, cover)` writes the FIRST resolved row's cover to the shared `'uid:'` slot. Every subsequent row's cache-first read returns that same cover → identical thumbnail for all rows. THIS is the poisoning write.
- timestamp 2026-06-15: cover-cache.ts:54 — `uidCoverCacheKey(uid)` = `'uid:' + uid`; an empty uid yields the single key `'uid:'`, a shared identity-less slot.
- timestamp 2026-06-15: charts/countries/[country]/+page.svelte:49-51,192 — IDENTICAL bug (same `uid: ''` stub fed to lazyCover). Fixed by the same shared-layer guard.

## Eliminated

- The page-local `resolvedCovers` map IS correctly keyed by `rowKey(it)` (artist+title), not uid — so the page binding itself was never the cause; the bug was purely cross-row cache poisoning in the uid layer.
- Home page (+page.svelte) discovery shelves are unaffected — they deliberately do NOT use `use:lazyCover` for stubs (resolve via scheduleBackfill keyed by {artist,title}); only real-uid library rows use lazyCover.
- The {artist,title} name cache layer (`getCachedCover`/`setCachedCover`) was always per-song-correct; it was being bypassed by the uid layer's empty-slot hit.

## Resolution

- root_cause: Discovery stub rows on charts/tags/{tag} and charts/countries/{country} are built with `uid: ''`. The uid cover-cache layer is a shared flat localStorage record keyed by `'uid:' + uid`, so an empty uid maps every distinct row to the single `'uid:'` slot. `resolveCoverForTrack` wrote the first resolved row's cover there (`setCachedCoverByUid('', url)`), and `lazyCover`'s cache-first read (`getCachedCoverByUid('')`) then returned that same cover for every other row — and the uid-keyed in-flight de-dupe skipped all but the first row. Net: every song rendered the first row's cover.
- fix: Guard the uid cache layer against empty uids on both read and write. (1) lazyCover.ts — an empty uid skips `getCachedCoverByUid` entirely (reads only the {artist,title} name layer) and de-dupes in-flight by a `name:${artist} ${title}` key instead of the empty uid, so distinct stub rows each resolve. (2) cover-backfill.ts `resolveCoverForTrack` — writes `setCachedCoverByUid` ONLY when `track.uid` is truthy; the {artist,title} name layer is always written, so empty-uid stubs still cache per-song. This fixes both charts/tags and charts/countries via the shared action + helper.
- verification: `npx vitest run` lazyCover.test.ts + cover-backfill.test.ts + cover-cache.test.ts → 60/60 pass, including new regression tests: (a) empty-uid stub never reads the uid layer, (b) distinct empty-uid rows de-dupe per {artist,title} and each resolve, (c) `resolveCoverForTrack` never writes the `'uid:'` empty slot but does write the name layer. `npx svelte-check` → 0 errors, 0 warnings.
- files_changed:
  - src/lib/actions/lazyCover.ts (empty-uid read + in-flight de-dupe guard)
  - src/lib/services/cover-backfill.ts (empty-uid write guard in resolveCoverForTrack)
  - src/lib/actions/lazyCover.test.ts (2 regression tests)
  - src/lib/services/cover-backfill.test.ts (1 regression test)
