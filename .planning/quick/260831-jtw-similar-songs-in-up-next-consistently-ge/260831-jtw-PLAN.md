---
quick_id: 260831-jtw
title: Similar songs in Up Next consistently — generated everywhere except album
date: 2026-08-31
status: planned
---

# Goal

Tap any song → Up Next holds SIMILAR songs, consistently, on every surface. Album is the
only exception (keeps its own order). The generated list auto-regenerates when exhausted.

# Investigation (done before planning — it changed the task)

The captured todo assumed the fix was "drop `artist: 'same-list'` from
`UPNEXT_DEFAULTS.perContext`". Tracing the code plus a live E2E check on the dev server
shows the real situation is different.

**`UPNEXT_DEFAULTS.perContext` is very nearly dead code.** Only ONE thing reads it:
`settings.resetPlayback()` (`settings.svelte.ts:476`). It is NOT the initial value —
`upnextPerContext` initialises to `{}` (`settings.svelte.ts:122`) and `load()` falls back
to `{}` (`:239-242`). So on a fresh install every context, album and artist included,
resolves to the global `'generated'`.

E2E on `localhost:4321`, reading `upnext.source` from Settings → Activity log:

| Surface tapped | Activity log |
|---|---|
| search result (`'search'`) | `upnext.source {"via":"similar","count":20}` |
| artist page row (`'artist'`) | `upnext.source {"via":"similar","count":20}` |

Artist already generates similar songs. Auto-regrow already works (`ensureAhead`,
`player.svelte.ts:2283`, plus regenerate's own `buildDiversePicks` net at `:3459`).

**The actual inconsistency has two sources:**

1. **Fresh install ≠ post-reset.** A fresh user gets `{}` (album generates). A user who
   taps Settings → reset playback gets `{album:'same-list', artist:'same-list'}` — their
   artist taps stop generating. Same app, two behaviours, decided by whether a button was
   ever pressed.
2. **Album is not actually protected by the setting.** An album tap runs a full
   `regenerate()` (a Last.fm `track.getSimilar` call + a 20-track tail) that the album
   page's later `setListQueue(all, 'album')` immediately throws away via the `queueGen`
   guard. Album order survives by race, not by design — and pays a wasted round trip on
   every album tap. `album/[name]/+page.svelte:221` already claims it relies on "the
   same-list sourcing setting", which today does not apply.

# Tasks

## T1 — Make `UPNEXT_DEFAULTS.perContext` the real default, album-only

**Files:** `src/lib/config/defaults.ts`, `src/lib/stores/settings.svelte.ts`

- `perContext` → `{ album: 'same-list' }`. Drop `artist` (the user wants artist taps to
  generate). Rewrite the stale doc comment that justifies artist as a curated collection.
- Seed `upnextPerContext` from it at `$state` init so a fresh install matches a reset.
- `load()` merges `{ ...UPNEXT_DEFAULTS.perContext, ...persisted }` — an explicitly stored
  per-context choice still wins; absent keys pick up the default.

**Verify:** `settings.effectiveUpnextMode('album')` → `'same-list'`;
`effectiveUpnextMode('artist')` / `('search')` → `'generated'`.

**Done:** album taps no longer fire a throwaway regenerate; every other surface generates.

## T2 — Persisted-settings decision (todo item 2)

**Decision: respect the stored value, no migration.** An entry in `upnextPerContext` can
only exist because the user tapped that segment in Settings → Playback (or hit reset).
Silently overwriting an explicit choice is worse than a rare stale preference, and it is
one tap to change. A one-shot migration would also need a persisted version marker, and
without one it would re-apply on every load and make artist=`same-list` unselectable.
Record this as a code comment at the `load()` merge.

**Verify:** a persisted `{artist:'same-list'}` still resolves `'same-list'` after load.

## T3 — Cover the changed default in tests

**Files:** `src/lib/stores/settings.svelte.test.ts`

- Update the `resetPlayback()` expectation (currently asserts
  `{album:'same-list', artist:'same-list'}`).
- Add: the seeded default gives album `'same-list'` and artist `'generated'`.
- Add: the load-merge shape — persisted keys win, absent keys fall back to the default.

**Verify:** `pnpm test` + `pnpm check` pass.

# Out of scope

- `ensureAhead` / `regenerate` / `buildSimilarQueue` — already working, verified live.
- The per-context override UI — only the DEFAULT changes; the toggles stay.
- Charts: uses `playStub(..., 'home-discovery')`, which already generates. No change.
