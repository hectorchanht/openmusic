---
quick_id: 260831-jtw
title: Similar songs in Up Next consistently — generated everywhere except album
date: 2026-08-31
status: complete
commit: 648882b
---

# What shipped

Generated (genre-similar) up-next sourcing is now the **real** default for every queue
context except `album`, on a fresh install and after a settings reset alike.

# What the investigation changed

The captured todo assumed a one-line fix: drop `artist: 'same-list'` from
`UPNEXT_DEFAULTS.perContext`. Tracing the code plus a live E2E check showed the diagnosis
was wrong in an important way.

`UPNEXT_DEFAULTS.perContext` was very nearly **dead code** — its only reader was
`settings.resetPlayback()` (`settings.svelte.ts:476`). `upnextPerContext` initialised to
`{}` and `load()` fell back to `{}`, so on a fresh install every context, album included,
resolved to the global `'generated'` mode.

Live confirmation before any edit (`upnext.source` in Settings → Activity log):

| Surface tapped | Log | Meaning |
|---|---|---|
| search result | `upnext.source {"via":"similar","count":20}` | already generating |
| artist page row | `upnext.source {"via":"similar","count":20}` | already generating |

So artist already did what the user wanted. The real defects were:

1. **Fresh install ≠ post-reset.** `{}` on a fresh install (album generates) versus
   `{album,artist} → 'same-list'` after a reset (artist stops generating). One app, two
   behaviours, decided by whether the reset button had ever been pressed.
2. **Album was not protected by the setting.** An album tap ran a full `regenerate()`
   (a Last.fm `track.getSimilar` call + a 20-track tail) that the album page's later
   `setListQueue(all, 'album')` immediately discarded via the `queueGen` guard. Album order
   survived by race, not by design, and paid a wasted round trip per tap.
   `album/[name]/+page.svelte:221` already claimed it relied on "the same-list sourcing
   setting" — which did not apply.

# Changes

**`src/lib/config/defaults.ts`** — `UPNEXT_DEFAULTS.perContext` → `{ album: 'same-list' }`.
`artist` dropped; comment rewritten to record why (an artist-page tap is an ordinary "play
this song" tap) and to note the const is now the actual seed, not just reset fodder.

**`src/lib/stores/settings.svelte.ts`** — `upnextPerContext` `$state` seeded from
`UPNEXT_DEFAULTS.perContext`; `load()` merges `{ ...defaults, ...persisted }` instead of
replacing, so an absent or malformed persisted blob still picks up the album default.

**`src/lib/stores/settings.svelte.test.ts`** — `resetPlayback()` expectation updated to
`{album:'same-list'}`; new suite covering the seeded default (album same-list, artist +
6 other contexts generated), the load-merge shape, persisted-wins, and that an explicit
`album:'generated'` override still defeats the default.

# Persisted-settings decision (todo item 2)

**Respect the stored value; no migration.** A `upnextPerContext` key can only exist because
the user tapped that segment in Settings → Playback (or hit reset) — an explicit choice.
Overwriting it silently is worse than a rare stale preference the user can change in one
tap, and a one-shot migration would need its own persisted version marker; without one it
re-applies on every load and makes `artist='same-list'` impossible to select. Recorded as a
comment at the `load()` merge.

# Verification

- `pnpm test` — 95 files, **1777 tests passed**.
- `pnpm check` — 4380 files, **0 errors, 0 warnings**.
- Live on `localhost:4321`, `openmusic:settings:v1` cleared to simulate a fresh install:
  the Playback settings page renders Album = `same-list`, and Liked / Search / Downloads /
  Playlists / **Artist** / Home / History = `generated`.
- Live album tap (Coldplay → Parachutes → track 2): log shows `grow.added {count:20}` then
  `upnext.source` — the `ensureAhead` grow path (`player.svelte.ts:2326`), **not**
  regenerate (`:3465`, which logs `upnext.source` alone). The throwaway regenerate is gone.

# Not touched

- `ensureAhead` / `regenerate` / `buildSimilarQueue` — the auto-regrow-on-exhaustion engine
  already worked; verified live, left alone.
- The per-context override UI — only the default changed; both toggles still work.
- Charts — uses `playStub(..., 'home-discovery')`, already generated.
- The album page's `playStub` → `resolveAllCached` → `setListQueue` race is pre-existing and
  out of scope. It is why the album tap above still grew a similar tail before the full
  tracklist landed.
