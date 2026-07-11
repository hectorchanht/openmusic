---
quick_id: 260711-te4
slug: relax-album-list-pre-gate-that-requires-
description: relax album list pre-gate that requires all songs resolvable
date: 2026-07-11
status: complete
commit: 6bbf009
---

# Quick Task 260711-te4 — Summary

## What shipped

Relaxed the artist-page Albums shelf so it renders **every album that exists**,
dropping the "trackless-album" pre-gate that only showed a card after verifying
its tracks were resolvable.

**File:** `src/routes/(app)/artist/[name]/+page.svelte`

- **Path A (Deezer):** removed the `&& a.nb_tracks > 0` filter. The Deezer album
  list renders directly; only obvious stub names (`isStubAlbumName`) are dropped.
- **Path B (Last.fm fallback):** removed the CAPPED per-album
  `mapWithConcurrency(... getAlbumTracklist ...)` verification. Previously each
  Last.fm album triggered its own tracklist fetch purely to decide whether to draw
  the card (N per-album fetches). Now the album list maps straight to render shape.
- Removed the now-unused `getAlbumTracklist` import (still used by the album page,
  not here). `mapWithConcurrency` and `DiscoveryAlbum` remain — used elsewhere.
- Rewrote the load-bearing comment block to record the relaxation (quick-260711-te4).

Song resolution is unchanged and remains the album *detail* page's job: tapping an
album opens `/album/[name]`, which loads the real tracklist and resolves each song
lazily on tap (`resolveStub`, D-05). The pre-gate was redundant with that path.

## Why

The pre-gate coupled album *visibility* to song *resolvability* at browse time,
hiding albums whose tracks weren't verifiable in that moment and spending N
per-album fetches on Path B. Per the request, album existence is enough to show
the card; resolution is deferred to the song resolver.

## Verification

- `pnpm check` (svelte-check) — **0 errors**. The single remaining warning
  (`.warn` unused CSS selector in `search/+page.svelte`) is pre-existing and
  unrelated to this change.
- Live UI (more album cards appearing for artists with previously-unverifiable
  albums) requires Deezer/Last.fm upstream data → **device UAT**. Browser
  smoke-check not viable in-sandbox (upstream network + a conflicting dev server
  on strictPort 4321). Consistent with the sandbox-no-CN-upstream pattern.

## Follow-ups / notes

- `albumsLoading` skeleton logic is untouched and still settles correctly (faster
  now — no per-album fetches on Path B).
- Deezer proxy `nb_tracks` passthrough left intact (harmless metadata; no longer
  gates the UI).
- An album with genuinely no resolvable tracks now shows a card that opens to the
  album page's graceful "no tracks" empty state — accepted trade-off per the
  request ("resolve the song within would be count on the song resolver").
