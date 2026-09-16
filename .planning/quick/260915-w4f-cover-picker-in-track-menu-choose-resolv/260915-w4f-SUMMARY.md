---
phase: quick-260915-w4f
plan: 01
subsystem: covers
tags: [covers, trackmenu, player, i18n, localStorage]
requires: [cover-cache, cover-version, cover-backfill, row-cover, player]
provides: [cover-pin-store, collectCoverCandidates, cover-picker-sheet]
affects: [TrackMenu, NowPlaying, CompactRow, home, search, library, artist, media-session]
tech-stack:
  added: []
  patterns: [wrap-dont-rewrite, pure-ts-plus-runes-wrapper, opt-in-fanout, generation-guard]
key-files:
  created:
    - .planning/quick/260915-w4f-cover-picker-in-track-menu-choose-resolv/260915-w4f-deferred-items.md
  modified:
    - src/lib/services/cover-cache.ts
    - src/lib/services/cover-cache.test.ts
    - src/lib/stores/cover-version.svelte.ts
    - src/lib/services/cover-backfill.ts
    - src/lib/services/cover-backfill.test.ts
    - src/lib/services/row-cover.ts
    - src/lib/services/row-cover.test.ts
    - src/lib/components/CompactRow.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/TrackMenu.svelte
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
    - src/lib/i18n/*.ts (15 dictionaries)
decisions: [Q1-collector-alongside-chain, Q2-unpin-only-on-dead-url, Q3-separate-pin-key, Q4-bump-via-cover-version, Q5-adoptCover-is-the-seam]
metrics:
  duration: ~25 min
  completed: 2026-09-15
---

# quick-260915-w4f: Cover picker in TrackMenu Summary

A per-song, permanent user override for the first-solid-wins cover chain: a **Change cover** row in
the long-press menu opens a labelled grid of every cover candidate the resolvers know, and tapping
one pins it ahead of every resolver on every surface — rows, tiles, Nowbar, NowPlaying hero and the
OS media-session artwork.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | `72212c6` | pin store + reactive pin API + candidate collector + pin-first row read order (+ caller sweep) |
| 2 | `579fa7b` | player pin-awareness: seeds, Site-A guard, HQ-upgrade gate, adoptCover, heal-unpin |
| 3 | `6f4c778` | TrackMenu Change-cover row + picker sheet + 3 i18n keys x 15 dictionaries |

Nothing pushed. `main` is 3 commits ahead of `origin/main`.

## What was built

**Pin store (`cover-cache.ts`).** `openmusic:cover-pins:v1`, a flat `Record<uid, url>` with its own
reader/writer/remover. Deliberately NOT in the cover cache: the `<matchKey>` name layer is shared
across uids (a pin there repaints every same-named song), and a uid entry inside `CACHE_KEY` would
inherit the 14-day TTL, the 2000-entry LRU and `clearCoverCache()` — three silent wipes. Refuses an
empty uid and a non-https url; `getPinnedCover('')` is null even if a `''` key exists on disk.

**Reactive API (`cover-version.svelte.ts`).** `readPinnedCover` / `pinCover` / `unpinCover`, and
`readCoverByUidOrName` is now pin → uid → name → null.

**`collectCoverCandidates` (`cover-backfill.ts`).** The enumerate-all counterpart to
`resolveTrackChain`'s stop-at-first: three tiers in `Promise.all` (Deezer top-5, iTunes top-1, the
CN `searchAll` interleaved list, each labelled by its own `source`), plus the track's own inline
cover leading. https-filtered, deduped by URL, capped at 12. Runs alongside the chain; called only
from the picker's tap handler.

**Read-order sweep.** `pickRowCover` gained a leading `pinned` rung, and **all 9** call sites pass
`readPinnedCover(uid)`. The four reads that put `track.cover` first rather than going through
`pickRowCover` were swept too: NowPlaying `cellBg`, home `libraryRowCover`, home `librarySongRow`,
home `fallbackSongs` tile. No 10th site exists — `download-track.ts` already reads the cache ahead
of `r.cover`, so the pin reaches embedded artwork for free through the now-pin-first
`readCoverByUidOrName`.

**Player (the substance).** Six edits, each verified by its own test rather than assumed:
`play()` and `restore()` seed `resolvedCover` from the pin ahead of the attached album cover and
`track.cover`; the Site-A `writeCoverBoth` is skipped when pinned; `upgradeCoverAsync` is gated off
for a pinned uid; `adoptCover` refuses any url that is not the pin and skips its cache write when
pinned; a local file's embedded art yields to a pin; `healCover` unpins on a failed probe only.

**TrackMenu.** A `disabled={!track.uid}` Change-cover row, a `trackmenu-cover` overlay sheet with a
3-column grid (`<img src>` attributes, never CSS `url()`), source labels, a tick on the active
cover, spinner and empty states. `doShare`'s cover expression was hoisted into one pin-first
`activeCover` derived — one precedence chain, two consumers.

## The four named risks

1. **Pin must beat `track.cover`, not just the cache** — done at all 9 `pickRowCover` sites plus the
   4 direct `track.cover`-first reads. `grep -rn "pickRowCover(" src --include='*.svelte'` yields 9
   matches, all carrying `readPinnedCover`.
2. **Hero + OS media card read `player.resolvedCover`** — all six player edits landed and each is
   covered by a test that fails if the edit is absent (the pin-seed tests assert `PIN`, which is
   only reachable if `getPinnedCover` is consulted at that site).
3. **Separate pin key** — asserted directly: `clearCoverCache()` leaves the pin intact, and pinning
   writes nothing to `openmusic:cover-cache:v1`.
4. **Only a dead URL unpins** — three tests: unpin on failed probe, no unpin on a loading probe, no
   unpin when the dead URL is not the pin. No resolver path can call `unpinCover`; the HQ upgrade,
   the Last.fm `adoptCover` swap and the Site-A write are all blocked rather than unpinning.

## Gates

- `pnpm check` — **0 errors, 0 warnings**, 4533 files.
- `pnpm test` — **129 files, 2506 tests, all passing.** No pre-existing failures.
- New tests: 7 pin-store, 5 collector, 1 pickRowCover pin rung, 11 player pin — 24 total, all
  confirmed running (`-t "quick-260915-w4f"` verbose run listed each).
- `git diff` on `cover-backfill.ts` removes exactly **one** line (the `deezer` import), so
  `resolveTrackChain` / `resolveCoverForTrack` / `resolveDeezerHQ` / `backfillCovers` have zero diff
  inside their bodies — the single-cover fast path is untouched.
- i18n parity (29 tests) green with the 3 new keys in all 15 dictionaries, double-quoted.

## Verification — what was NOT done

**I have no browser tools in this environment, so the interactive path was not exercised.** No one
opened the menu, tapped Change cover, pinned a candidate, or watched a row and the hero repaint.
Everything above is unit-test and static evidence.

What *was* checked against the live dev server on port 4321, by HTTP:
`GET /api/deezer/search?q=Adele%20Hello&limit=5` returns **5 distinct album covers** (Adele *25*,
Conkarah *Hello (Reggae Cover)*, skyemane, Adele *21*, Joe), so the Deezer tier alone supplies a
multi-candidate grid with real labels. `GET /api/kuwo/search` returned `{"message":"Internal
Error"}` in this sandbox — a CN tier failing here is the sandbox, per the standing note, not a bug
in this change. A thin or CN-less grid in the sandbox is therefore expected.

Still genuinely unobserved: the sheet's layout on a real 375px viewport, the tick placement, whether
the row repaint and the hero repaint both land without a reload, and the reload / clear-cover-cache
persistence path end to end.

## Deviations from Plan

**None that change behaviour.** Two small mechanical departures, both Rule 3:

1. **`{@const}` placement (home fallbackSongs tile).** The plan's snippet put `{@const art = …}`
   inside the `<button>`; Svelte requires it to be the immediate child of the `{#each}`. Moved up
   one level, same value, with a comment saying why.
2. **Check icon wrapper.** The plan offered `.cand :global(svg)` or a `.tick` span. Used the
   `.tick` span — the file's other icons are not styled through `:global`.

## Assumption Drift (advisory)

- **Planned:** the picker's Deezer tier needs `deezerSearchTopN` against an endpoint that may or may
  not be multi-hit. **Actual:** `/api/deezer/search?limit=N` returns a `results` array and is live in
  this sandbox, so the tier really does contribute up to 5 labelled candidates rather than
  degenerating to the same single cover `deezerSongCover` already returns. **Why it matters:** the
  feature's value depends on the grid having more than one plausible choice; it does, even with both
  CN Meting proxies blocked.

## Known Stubs

None.

## Threat Flags

None. No new image origin, no new endpoint, no new dependency. The collector applies the existing
client-side `hasHttpsScheme` gate (T-0bb-01) to every candidate and `setPinnedCover` refuses
non-https, so the pin store cannot hold a value the render path would reject.

## Self-Check: PASSED

All six touched modules exist on disk; all three commits (`72212c6`, `579fa7b`, `6f4c778`) are in
`git log`. Working tree clean apart from pre-existing untracked planning artifacts belonging to
other work. `origin/main..HEAD` is 28 commits — nothing pushed by this task.
