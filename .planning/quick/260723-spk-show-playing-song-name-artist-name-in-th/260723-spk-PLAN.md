---
quick_id: 260723-spk
slug: show-playing-song-name-artist-name-in-th
status: planned
title: "Show playing Song • Artist in the browser tab (document.title)"
---

# Quick Task 260723-spk — Now-playing browser tab title

Make the browser tab show the current track as `Song • Artist` (Spotify / YouTube-Music style),
priority over each route's own `<title>`, reverting to the route/app title when nothing is current.

## Design

- ONE global client `$effect` in the app-wide singleton host `src/routes/+layout.svelte` (where the
  single `<audio>` + `player.attach()`/`restore()` already live).
- While `player.current` exists → `document.title = "${dnTitle(title)} • ${dnArtist(artist)}"`, using
  the TRANSLATED display names (`names.dnTitle`/`dnArtist`) so the tab matches the on-screen text and
  honors the zhs→zht setting; `•` matches the share-card style the user chose.
- Depends on `page.url.pathname` so it RE-ASSERTS after a client navigation (a route's
  `<svelte:head><title>` overwrites document.title on nav; this effect runs after and wins while a
  track is current). `dnTitle`/`dnArtist` read `names.rev`, so it also re-runs when a lazy
  translation resolves (no Simplified→Traditional flash).
- When `!player.current` → do nothing, leaving the route/app `<title>` in place.

## Safety / correctness

- The effect WRITES `document.title` (a DOM property), NEVER `$state` — so it cannot self-invalidate
  like the adjacent `attach()`/`restore()` effect did (that one mutated player `$state`, hence its
  `untrack`). No loop risk here.
- `$effect` never runs under SSR, so crawlers still get each route's SSR `<title>`; `browser`-guarded
  per house style for defense-in-depth.
- `restore()` sets `player.current` synchronously on load (no autoplay), so a reload shows the
  restored track in the tab — matching Spotify web. (Keying on `current`, not `playing`.)

## Tasks

### Task 1 — global tab-title effect in the root layout
- **files:** `src/routes/+layout.svelte`
- **action:** import `{ browser }` from `$app/environment` and `{ names }` from `$lib/stores/names.svelte`;
  add a `$effect` that sets `document.title` to `Song • Artist` (translated) when `player.current`,
  re-asserting on `page.url.pathname`. Fall back (no-op) when nothing is current.
- **verify:** `pnpm check`; E2E: seed `localStorage['openmusic:player:v1']` with a `current`, reload,
  assert `document.title === "稻香 • 周杰倫"` (Traditional under a zh-Hant setting) / `"稻香 • 周杰伦"` otherwise.
- **done:** tab shows Song • Artist while a track is current; route/app title stands otherwise; check clean.

## Verification
- `pnpm check` 0/0, `pnpm test` green (no test touched; regression guard).
- Browser E2E via a persisted-player seed (CN playback unreachable in sandbox — real playback is human UAT).

## Out of scope
- A play/pause glyph prefix in the title; favicon changes; media-session (already handled elsewhere).
