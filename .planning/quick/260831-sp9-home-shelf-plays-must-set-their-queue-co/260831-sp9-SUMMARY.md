---
quick_id: 260831-sp9
title: Home shelf plays must set their queue context so Up-Next regenerates
date: 2026-09-01
status: complete
commit: 6c457fa
---

# What shipped

Tapping a song in a home shelf (liked / downloads / history / playlists) now regenerates Up-Next,
while leaving hand-queued songs alone.

# Cause

The home library shelves call `player.play(track, { fresh: true })` directly and deliberately do
NOT install a queue — a simple tap is meant to *generate* a new Up-Next, not snapshot the shelf.
But `queueContext` is what decides generated-vs-same-list, and nothing was setting it, so the play
inherited whatever the **previous** play left behind.

The repro: play an album (`queueContext = 'album'`), go Home, tap a liked song. The context was
still `'album'` → `effectiveUpnextMode` → `'same-list'` → the fresh-play branch skipped
`regenerate()` entirely, and Up-Next still showed the album's remaining tracks.

# Changes

**`player.play()`** gains an optional `context`, applied as a bare field assignment.

Deliberately **not** `setQueue()`: that replaces the queue, which would discard the user's
`Play next` / `Add to queue` entries — the explicit exception in the request. `regenerate()`
already preserves manual entries (it re-emits `manualEntries` around the new tail), so the only
thing missing was an accurate context. `queueGen` is left alone as well; a fresh play's
regenerate is supposed to run, not be invalidated by a generation bump.

**`libraryShelf`** (home) takes the context and threads it through all three density branches —
CompactRow, grid tile and album row — wired per shelf: `liked` / `downloads` / `history` /
`playlist`.

# Verification

End-to-end on the dev server, reproducing the exact report:

| step | Up-Next |
|---|---|
| play the Parachutes album | the 10 album tracks (context `album`) |
| Home → tap the liked row | **21 entries of generated similar songs** — Keane, Radiohead, Stereophonics, The Verve, Travis |

Getting there needed one detour worth recording: the home library shelves render from a **cached
picks snapshot**, so a freshly-liked track does not appear until the cache refreshes (the
Randomize button forces it). That is existing behaviour, not something this task changed, but it
is why the Liked shelf looked empty at first.

4 unit tests: context adoption, regenerate firing where the stale `album` context previously
suppressed it, hand-queued entries surviving the rebuild, and omitting the option leaving the
existing context untouched (so nothing else changed behaviour).

`pnpm test` 100 files / **1866 tests** (+4); `pnpm check` 4404 files, 0 errors 0 warnings.

# Note

`player.play()` callers that already install a queue (search, artist, album, home-discovery,
library page) are untouched — `setQueue`/`setListQueue` set the context themselves, and omitting
the new option is a no-op.
