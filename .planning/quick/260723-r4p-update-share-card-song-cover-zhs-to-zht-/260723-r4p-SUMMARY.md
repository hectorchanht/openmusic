---
quick_id: 260723-r4p
slug: update-share-card-song-cover-zhs-to-zht-
status: complete
date: 2026-07-24
code_commit: dad37e2
title: "Share card — YouTube-Music-style: song cover + zhs→zht + simplified title/desc"
---

# Quick Task 260723-r4p — Summary

Made the SONG share card (the OG/Twitter link-preview crawlers unfurl) mimic YouTube Music.

## What shipped

1. **Song cover in the card** — the song share link now carries the resolved cover as a readable
   `?c=` carrier, so `og:image` / `twitter:image` shows the album art instead of the `/og.svg`
   fallback. Gated to an absolute `https://` URL (`isHttpsUrl`) — a missing / non-https cover falls
   back to `/og.svg` (D-07). No SSRF: `og:image` is emitted into a Svelte-escaped meta tag, never
   fetched server-side.

2. **zhs→zht at share time** — in `doShare()`, when the sharer's title/artist target resolves to
   Traditional (`effectiveTarget(settings.titleLang / artistLang) === 'zh-Hant'`), the Chinese
   title/artist is converted to Traditional via the existing deterministic offline s2t
   (`s2tConvertLines`, `isChineseLine` gate — JA/KO excluded). The shared card now matches what the
   sharer sees on-screen (`names.dnTitle/dnArtist`). Never-throw; falls back to the original.

3. **Simplified title + description (user choice)** — `og:title` = `Song • Artist` (bullet; drops
   the artist when absent), `og:description` = `Listen on openmusic` (short tagline, replacing the
   old marketing sentence). Scoped to the SONG surface — album/artist loaders pass no artist and
   override the description, so they are unaffected.

## Files changed (commit dad37e2)

- `src/lib/services/share.ts` — `buildOg` (bullet title + tagline desc); `songShareUrl` accepts an
  optional `cover` and appends `&c=` only when https.
- `src/lib/services/share.test.ts` — updated buildOg title/desc expectations; +2 songShareUrl cover cases.
- `src/routes/(app)/song/[slug]/+page.ts` — reads `?c=`, passes `cover` to `buildOg`; comment refreshed.
- `src/lib/components/TrackMenu.svelte` — `doShare()` s2t-converts title/artist (zh-Hant setting) +
  resolves the best cover from the shared cover cache before building the link; native-share title
  string now `Song • Artist`.

## Verification

- `pnpm test` → **1334/1334** (79 files); `pnpm check` → **0 errors / 0 warnings** (4338 files).
- SSR OG head E2E-verified on the dev server (song route is `ssr = true`; no CN upstream needed):
  - `GET /song/dao-xiang?n=稻香&a=周杰倫&c=https://cdn.example.com/cover.jpg`
    → `og:title` = `稻香 • 周杰倫`, `og:description` = `Listen on openmusic`,
      `og:image` = `https://cdn.example.com/cover.jpg` (twitter:* match), `<title>` = `稻香 • 周杰倫`.
  - non-https `c` → `og:image` = `/og.svg`; no `c` → `/og.svg`; no artist → title `Solo` (no dangling bullet).
- The `doShare()` s2t + best-cover path is client-side (needs a user share gesture + the tongwen
  dict); the pure pieces it composes (`s2tConvertLines`, `readCoverByUidOrName`, `songShareUrl`) are
  unit-tested / already in production. Real-device share-sheet behavior is human UAT.

## Notes / out of scope

- Album & artist share cards do not carry covers (task was song-focused).
- Only zhs→zht conversion (per the literal request) — other translation targets are not applied to
  share text.
- Native share-sheet image files (`navigator.share({files})`) were not added — this is the
  link-preview OG card.
