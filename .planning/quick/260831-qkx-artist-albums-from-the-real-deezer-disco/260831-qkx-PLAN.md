---
quick_id: 260831-qkx
title: Artist albums from the real Deezer discography — newest first, typed, full discography page, real tracklists
date: 2026-09-01
status: planned
---

# Goal

Reported: the artist page's album shelf is "not reliable and not exhaustive, many of the time
are empty inside or not official album". Wanted: albums in descending order, and a click-through
to a real list of albums under that artist.

# Investigation

**The shelf is fed by the wrong artist.** `/api/deezer/artist-albums` resolves the artist with
`search/artist?q=<name>&limit=1` then takes `data[0].id`
(`src/routes/api/deezer/artist-albums/+server.ts:136,145`) — the SAME namesake-shell bug fixed in
`debug/upnext-diverse-fallback-kuwo-dead` for `/related`, `/artist` and `/radio`. This is its
fourth caller and was missed there.

Measured 2026-09-01:

| Artist id used | Albums returned |
|---|---|
| 316813311 — the shell `data[0]` for "Coldplay" (91 fans) | **0** |
| 892 — the real Coldplay (18,367,520 fans) | **123** |

With Deezer returning 0, the page silently falls through to Path B, Last.fm
`getArtistTopAlbums` — a popularity-ranked *sample*, which is exactly why the shelf reads as
non-exhaustive and full of non-official releases.

The real Deezer discography also carries the metadata the request needs:
`release_date` (sort key), `record_type`, and `id`. Coldplay's 123 break down as
**album 17 · ep 5 · single 101** — so a type filter removes 82% of the noise.

**"Empty inside" is a second, separate defect.** The shelf renders albums as `{name, image}`
only (`RenderAlbum`, artist page :82), discarding the id. The album page then re-resolves by
NAME through Last.fm `album.getInfo` (`album/[name]/+page.svelte:148`). That name round-trip is
what comes back empty. Carrying the Deezer album id fixes it directly — `album/301663/tracks`
returns all 10 Parachutes tracks in order, whereas a Deezer album *search* for
`artist:"Coldplay" album:"Parachutes"` matches a different record entirely (a track by "bEzii").
So the id must come from the artist's own discography, never from an album search.

# Decisions (user, 2026-09-01)

- Sort **by release date, descending** (newest first).
- Artist-page shelf: **albums + EPs only**.
- Discography page: **everything**, filter **preset to albums + EPs**.
- **Show type labels** on both surfaces.
- Deliver **both** click-throughs: real tracklist inside an album, AND a full discography page.

# Tasks

## T1 — Fix the fourth decoy caller + return the metadata

**Files:** `src/routes/api/deezer/artist-albums/+server.ts`, `src/lib/services/deezer.ts`

- Use `pickBestArtistId` + `DEEZER_ARTIST_SEARCH_LIMIT` (`$lib/proxy/deezer-pick`), same as the
  other three callers.
- Paginate: Deezer caps `limit` at 50 and exposes `index`. Fetch up to 3 pages (150 albums) so a
  deep discography is genuinely exhaustive; stop early when a page is short or `total` is reached.
- Widen the reshape to carry `id`, `release_date`, `record_type`, `nb_tracks` alongside
  `title`/`cover`. Extend `DeezerArtistAlbum` to match.

**Verify:** `/api/deezer/artist-albums?q=Coldplay` returns 123 entries with ids and dates.

## T2 — Shelf: real source, newest first, albums+EPs, labelled

**File:** `src/routes/(app)/artist/[name]/+page.svelte`

- `RenderAlbum` gains `id`, `releaseDate`, `type`.
- Sort by `release_date` descending (undated entries last, stable).
- Filter to `record_type` ∈ {album, ep} for the shelf.
- Render the type label on each card instead of the fixed `artist.albumLabel` string.
- Navigate with the Deezer album id in the query so the album page can use it.
- Path B (Last.fm) unchanged as the fallback when Deezer has no artist — those entries carry no
  id/date/type, so they render unlabelled and unsorted, exactly as today.

**Verify:** Coldplay shelf shows 22 entries (17 albums + 5 EPs), Moon Music first.

## T3 — Full discography page

**Files:** `src/routes/(app)/artist/[name]/albums/+page.svelte` (new), artist page ("See all" link)

- Lists the complete discography, newest first, with type labels.
- Filter chips (All / Albums & EPs / Singles), **preset to Albums & EPs**.
- Reuses the same fetch + sort helpers as the shelf — no second source of truth.

**Verify:** the page lists all 123 Coldplay releases; the preset filter shows 22; All shows 123.

## T4 — Real tracklist by album id

**Files:** `src/routes/api/deezer/album-tracks/+server.ts` (new), `src/lib/services/deezer.ts`,
`src/routes/(app)/album/[name]/+page.svelte`

- New proxy: `?id=<numeric>` → `album/{id}/tracks?limit=…` → `{ tracks: [{artist,title,position}] }`.
  Numeric-only id validation (never a user-supplied path segment), never-throws, edge-cached.
- Album page: when the incoming id is present, load the tracklist from Deezer by id; fall back to
  today's Last.fm `getAlbumTracklist(name, artist)` when it is absent (deep links, Path B albums)
  or returns nothing. The existing resolve-on-tap stub contract is unchanged — only where the
  ordered {artist,title} list comes from.

**Verify:** Parachutes opened from the artist page lists 10 tracks in album order.

## T5 — i18n + tests

- New keys (type labels, "See all", filter chips) in **all 15** dictionaries, double quotes;
  `en` defines `TranslationKey` and `i18n.test.ts` guards parity.
- Unit tests for the pure sort/filter helper (descending, undated last, type filtering) and for
  the new proxy's id validation + reshape.
- `pnpm test` + `pnpm check` green.

# Out of scope

- The resolve-on-tap path (`resolveStub`) — unchanged.
- The Last.fm enrichment/bio sections — unchanged.
- Removing kuwo from the registry (tracked in the debug session's follow-up).
