---
created: 2026-08-31T19:58:01.811Z
title: Similar songs in Up Next consistently — generated sourcing everywhere except album
area: general
files:
  - src/lib/config/defaults.ts:118 (UPNEXT_DEFAULTS.perContext)
  - src/lib/stores/settings.svelte.ts:485 (effectiveUpnextMode)
  - src/lib/stores/player.svelte.ts:2283 (ensureAhead — the auto-grow engine)
  - src/routes/(app)/artist/[name]/+page.svelte:163,526 (installs the 'artist' queue)
  - src/routes/(app)/settings/playback/+page.svelte:51 (per-context override UI)
---

## Problem

**Goal: tap any song → Up Next is filled with SIMILAR songs, consistently.** Today it depends
on which surface you tapped from, which makes the behaviour feel arbitrary. The only surface
that should keep its own order is an album (users expect "play the rest of the album").

MOST OF THE MACHINERY ALREADY EXISTS — do not rebuild it:
- `UPNEXT_DEFAULTS.mode` is already `'generated'` globally (`defaults.ts:120`, roadmap-locked),
  so `search` / `library` / `history` / `home-discovery` / `liked` / `downloads` / `playlist`
  already fall through to genre-generated sourcing via `effectiveUpnextMode()`.
- Auto-regeneration on exhaustion is already implemented — `ensureAhead()`
  (`player.svelte.ts:2283`), the walk-exhaustion eager-grow path around :2369, plus
  `buildSimilarQueue` / `buildDiversePicks`, all queueGen-guarded.

The known gap is `UPNEXT_DEFAULTS.perContext`, which pins BOTH `album: 'same-list'` AND
`artist: 'same-list'` (`defaults.ts:125`). Tapping a song on an artist page therefore queues
that artist's other songs instead of similar songs — the main inconsistency the user hit.

## Solution

1. Drop `artist: 'same-list'` from `UPNEXT_DEFAULTS.perContext`, leaving `{ album: 'same-list' }`.
   Rewrite the doc comment at :121–124 — it currently justifies artist as a curated collection,
   which is no longer the intent.
2. Migration: a persisted `openmusic:settings:v1` may already carry an explicit
   `upnextPerContext.artist = 'same-list'` written by the old default or the settings UI, which
   would keep old users on the old behaviour. Decide — one-shot migration in `settings.load()`
   vs respect the stored value — and record the choice in a code comment.
3. Then VERIFY consistency across every entry point rather than assuming it (this is the actual
   deliverable): tap a track from search, home, charts, artist, library/liked, downloads,
   history and confirm Up Next holds similar songs in each. Charts in particular — check which
   `QueueContext` its rows install (it is not in the `setQueue`/`setListQueue` grep hits above,
   so it may be passing `null` or riding another surface's context).
4. Confirm the exhaustion refill still fires for a generated artist queue — regression check on
   the existing `ensureAhead` engine, not new code.
5. The per-context override UI stays; only the DEFAULT changes, so a user can still pin artist
   back to same-list. Cover the changed default in the existing defaults/player tests.
