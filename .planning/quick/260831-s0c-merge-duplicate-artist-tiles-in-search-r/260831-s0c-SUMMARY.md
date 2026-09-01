---
quick_id: 260831-s0c
title: Merge duplicate artist tiles in search results via the Last.fm canonical name
date: 2026-09-01
status: complete
commit: 9dbb116
---

# What shipped

Searching "jay chow" showed **three** artist tiles — 周傑倫, Jay Chou, 周杰倫 — for one artist.
Now it shows **one**, named per the artist-language setting.

# Cause

`deriveArtistTiles` groups by lowercased `track.artist`. Those strings come raw from each source,
and sources spell the same artist differently, so every spelling became its own tile.

# The key was already in flight

Last.fm resolves every spelling to ONE entity. Measured 2026-09-01 — identical listener counts
prove it:

| Query | Listeners |
|---|---|
| 周傑倫 · 周杰倫 · 周杰伦 · Jay Chou | 122,572 |
| 陳奕迅 · Eason Chan | 69,834 |

And the search page **already** calls `artist.getinfo` per tile for its avatar — the reshape was
just dropping `entity.name`. So the merge costs **zero extra requests**, and needs no
per-tile MusicBrainz lookup (which would be one request each against a ~1 req/s budget).

# Changes

**`src/routes/api/lastfm/info/+server.ts`** — surfaces the canonical `name`, for `artist.getinfo`
ONLY. Track and album entities also carry a `name` (the title); exposing it there would change
their long-standing response shape, which the album EMPTY deep-equal test caught immediately. The
field is gated on the entity actually being the artist rather than the test being relaxed.

**`src/lib/services/artist-tiles.ts`** (new, pure) — `mergeArtistTiles` + `pickTileName`.
Grouping falls back to the tile's own lowercased name when Last.fm has no canonical, so an
unknown artist keeps one tile per spelling instead of over-merging. Counts sum, the first
resolved avatar wins, and the row re-sorts on the summed count so a merged artist can overtake a
single-spelling one.

**Display name** follows `settings.artistLang`, resolved LOCALLY from spellings already present
in the results: a candidate whose detected script matches the setting → the Last.fm canonical →
the most-represented spelling. `'auto'`/`'off'` are app sentinels and fall through, so users who
never set a preference see exactly today's behaviour.

**Search page** merges AFTER enrichment; the row still paints immediately with names + gradients,
so nothing became slower.

# Verification

Live, query "jay chow":

- before — 周傑倫 · Jay Chou · 周杰倫 as three tiles
- after — **one** tile, first in the row (summed count promotes it)
- 26 tiles total; the rest are genuinely distinct (cover channels, lyric channels, a
  "Marcela Mangabeira/Marcia Motta Almeida/Jay Chow" joint credit) — no over-merging
- `artistLang=en` → the same merged tile renders **Jay Chou**

`pnpm test` 99 files / **1844 tests** (+15); `pnpm check` 4402 files, 0 errors 0 warnings.

# Note

The tile links to `/artist/{chosen name}`, which is safe in either script because the artist page
now resolves identity through MusicBrainz (quick-260831-re9) — every spelling lands on the same
canonical artist.
