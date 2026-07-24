---
quick_id: 260723-spk
slug: show-playing-song-name-artist-name-in-th
status: complete
date: 2026-07-24
code_commit: 914ab3e
title: "Show playing Song • Artist in the browser tab (document.title)"
---

# Quick Task 260723-spk — Summary

The browser tab now shows the current track as `Song • Artist` (Spotify / YouTube-Music style).

## What shipped

A single global client `$effect` in `src/routes/+layout.svelte` (the app-wide singleton host where
the one `<audio>` + `player.attach()`/`restore()` already live):

- While `player.current` exists → `document.title = "${dnTitle(title)} • ${dnArtist(artist)}"`, using
  the TRANSLATED display names (`names.dnTitle`/`dnArtist`) so the tab matches the on-screen text and
  honors the zhs→zht setting; `•` matches the share-card style.
- Reads `page.url.pathname` so it RE-ASSERTS after a client navigation (each route's
  `<svelte:head><title>` overwrites `document.title` on nav; this effect runs after and wins while a
  track is current). `dnTitle`/`dnArtist` read `names.rev`, so it also re-runs when a lazy
  translation resolves (no Simplified→Traditional flash).
- No `player.current` → no-op, leaving the route/app `<title>` in place.
- `restore()` sets `player.current` synchronously on load (no autoplay), so a reload/PWA reopen shows
  the restored track — matching Spotify web (keyed on `current`, not `playing`).

## Correctness

- The effect WRITES `document.title` (a DOM property), NEVER `$state`, so it cannot self-invalidate
  like the adjacent `attach()`/`restore()` effect (which mutates player `$state`, hence its
  `untrack`). No loop risk.
- `$effect` is SSR-inert, so crawlers still get each route's SSR `<title>`; `browser`-guarded per
  house style.

## Files changed (commit 914ab3e)

- `src/routes/+layout.svelte` — import `{ browser }`, `{ names }`; add the tab-title `$effect`.

## Verification

- `pnpm check` → **0 / 0** (4338 files); `pnpm test` → **1354 / 1354** (79 files, no test touched —
  regression guard).
- Browser E2E on the dev server via a persisted-player seed (`openmusic:player:v1`) + a fresh tab
  (CN playback is unreachable in-sandbox, so `restore()` is the seam that sets `current` without
  network — real playback remains human UAT):
  - default settings → `document.title === "稻香 • 周杰伦"` (Simplified original).
  - `appLang: zh-Hant` (title/artist `auto` → Traditional) → `document.title === "稻香 • 周杰倫"`
    (伦→倫 converted, matching the on-screen name).
  - Nowbar simultaneously rendered the track, confirming `current` drove both.
  - Test-harness note: a full reload in the SAME tab fires the outgoing page's `pagehide`→`persist()`
    (with null `current`) which removeItem's the seed before the reload reads it — a harness artifact,
    NOT a code bug; opening a fresh tab (old tab keeps the seed intact) is the reliable path.

## Out of scope

- A play/pause glyph prefix in the title; favicon changes; media-session (handled elsewhere).
- "While playing only" semantics — the tab reflects the current track even when paused/restored
  (Spotify-web behavior); trivially switchable to `player.playing` if desired later.
