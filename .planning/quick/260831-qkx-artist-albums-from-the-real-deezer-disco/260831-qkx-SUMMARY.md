---
quick_id: 260831-qkx
title: Artist albums from the real Deezer discography — newest first, typed, full discography page, real tracklists
date: 2026-09-01
status: complete
commit: e70ea20
---

# What shipped

The artist page's album shelf now comes from the artist's real, complete Deezer discography:
newest first, albums + EPs only, each labelled with its type and year. A "See all" link opens a
full discography page (every release, filter chips preset to Albums & EPs). Clicking any album
loads its real ordered tracklist.

# Root causes (two, independent)

**The shelf was fed the wrong artist.** `/api/deezer/artist-albums` resolved the artist with
`search/artist?q=<name>&limit=1` and took `data[0].id` — the **fourth** caller of the
namesake-shell bug fixed for `/related`, `/artist` and `/radio` in
`debug/upnext-diverse-fallback-kuwo-dead`, and missed there. For "Coldplay", `data[0]` is
id 316813311 (91 fans) whose album list is **empty**, so the page silently fell through to
Last.fm `getArtistTopAlbums` — a popularity-ranked *sample*. That is precisely why the shelf
read as non-exhaustive and full of non-official releases. The real Coldplay (id 892) has 123
releases: **17 albums, 5 EPs, 101 singles**.

**"Empty inside" was separate.** The shelf rendered `{name, image}` and threw the album id away;
the album page then re-resolved by NAME through Last.fm `album.getInfo`, which returns nothing
when the name does not match. Name matching is genuinely unreliable, not merely slower — a Deezer
album *search* for `artist:"Coldplay" album:"Parachutes"` returns a single by a different act
("bEzii"). Fetching by the id from the artist's own discography returns the real record.

# Changes

**`src/routes/api/deezer/artist-albums/+server.ts`** — `pickBestArtistId` (the shared fix), and
pagination: Deezer caps a page at 50, so the old single `limit=50` call truncated any deeper
catalogue. Now pages up to 3×50, stopping early on a short page, and keeps partial results if a
later page fails. Returns `id`, `release_date`, `record_type` alongside `title`/`cover`, each
guarded (ISO date, `[a-z]{1,20}` type, positive-integer id).

**`src/routes/api/deezer/album-tracks/+server.ts`** (new) — `album/{id}/tracks` → ordered
`{artist,title,position}`. Positive-integer id validation before the id reaches the fixed
upstream path; never-throws; success-only edge cache. Deliberately offers **no** name fallback,
since a name search is the failure mode it exists to remove.

**`src/lib/services/discography.ts`** (new, pure) — `sortByReleaseDesc`, `filterByType`,
`isMainRelease`, `typeLabelKey`, `releaseYear`, `albumHref`, `fallbackCoverSeed`. Both surfaces
share it, so "what order" and "what counts as an album" have exactly one definition.
`fallbackCoverSeed` was hoisted out of the artist page rather than copied into the new one.

**Artist page** — newest-first, shelf filtered to albums + EPs, type + year label per card,
"See all" link. The Last.fm fallback path is untouched: those entries carry no id/date/type, so
they keep their incoming order and render with the generic label exactly as before.

**`/artist/[name]/albums`** (new) — full discography, newest first, type labels, filter chips
**preset to Albums & EPs** per the user's decision. Nothing is hidden — just de-noised.

**Album page** — prefers the carried `dzid` for the tracklist; falls back to the existing Last.fm
path when it is absent (deep links, Last.fm-sourced albums) or returns empty. The resolve-on-tap
stub contract is unchanged; only the source of the ordered list moved.

**i18n** — 10 new keys across all 15 dictionaries, double quotes.

# Decisions (user, 2026-09-01)

- Sort by release date, descending.
- Shelf: albums + EPs. Discography page: everything, preset to albums + EPs. Labels on both.
- Deliver both click-throughs (real tracklist AND full discography page).

# Verification

Live on the dev server:

| Check | Result |
|---|---|
| `/api/deezer/artist-albums?q=Coldplay` | 123 entries, all with id + date, `{album:17, ep:5, single:101}` |
| `/api/deezer/album-tracks?id=301663` | 10 Parachutes tracks in album order |
| `id=../../evil`, `id=-5` | `{"tracks":[]}`, no upstream call |
| Artist shelf | 22 cards — "Moon Music (Full Moon Edition) Album · 2024" first, "Parachutes Album · 2000" last |
| Artist header | **18,367,526 Fans · 123 Albums** (was 91 Fans · 0 Albums) |
| Discography page | preset 22 · Singles 101 · All 123 |
| `/album/Parachutes?…&dzid=301663` | 10 tracks; without `dzid` the Last.fm fallback still returns 10 |

`pnpm test` 97 files / **1811 tests** (+21 new); `pnpm check` 4390 files, 0 errors 0 warnings.

The +21 cover the pure helpers on real Coldplay data: descending order including *within* a year
(Moon Music vs its Full Moon Edition, two days apart), undated Last.fm rows sorting last in stable
order, the main/single filters being exact complements, untyped entries being KEPT so a
Last.fm-only artist never renders a blank shelf, and `albumHref` encoding + `dzid` presence.

# Follow-up

The namesake-shell bug has now been found in four separate callers. `/api/deezer/search` and
`/api/deezer/album` resolve by search too and are worth an audit — they were not touched here
because neither feeds the album list.
