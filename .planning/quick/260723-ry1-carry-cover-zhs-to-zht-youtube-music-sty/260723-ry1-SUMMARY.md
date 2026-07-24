---
quick_id: 260723-ry1
slug: carry-cover-zhs-to-zht-youtube-music-sty
status: complete
date: 2026-07-24
code_commit: 0a86185
title: "Album + artist share cards — cover + zhs→zht + YouTube-Music-style title/desc"
---

# Quick Task 260723-ry1 — Summary

Extended the quick-260723-r4p YouTube-Music-style share card to the ALBUM and ARTIST surfaces.

## What shipped

1. **Cover in the card** — album/artist share links now carry the resolved hero cover via a `?c=`
   carrier → `og:image`/`twitter:image` (album art / artist hero) instead of the `/og.svg` fallback.
   https-gated (`isHttpsUrl`); missing/non-https → `/og.svg`. No SSRF (og:image is emitted into a
   Svelte-escaped meta tag, never fetched server-side).

2. **zhs→zht — resolution-safe** — the album/artist link's authoritative round-trip key is the
   **literal name in the path** (`/album/{name}?artist=`, `/artist/{name}`), resolved by
   `params.name`/`?artist=`. Converting the path (as the song card did with its dual-purpose `n`/`a`)
   would make a Traditional-locale sharer's link resolve against a Traditional query and degrade the
   CJK-catalog tracklist. So the path key stays ORIGINAL and the zhs→zht-converted name/artist ride
   **separate display carriers** (`dn`/`da`) the loader prefers for the OG card ONLY — the card shows
   Traditional, the recipient still resolves against the original CJK name. Conversion via the offline
   deterministic `s2tConvertLines` (`isChineseLine` gate excludes JA/KO), gated on
   `effectiveTarget(settings.titleLang)` (album name) / `effectiveTarget(settings.artistLang)`
   (album artist, artist name); never-throw → original fallback.

3. **Simplified title + description** — album `og:title` = `Album • Artist`, artist `og:title` =
   `Artist`; both `og:description` = `Listen on openmusic` (dropped the bespoke tracklist / artist
   sentences). Consistent with the song card.

## New shared abstraction

`entityCardUrl({ type, name, artist?, cover?, displayName?, displayArtist? })` in `share.ts` — pure,
SSR-guarded. Keeps the literal name in the path (CJK-safe, unlike `entityShareUrl`'s ASCII slug) and
emits only the carriers that apply: `artist` (album), `c` (https cover), `dn`/`da` (only when they
differ from the literal keys, so a non-converting share stays byte-clean). `da` is album-only.

## Files changed (commit 0a86185)

- `src/lib/services/share.ts` — new `entityCardUrl`.
- `src/lib/services/share.test.ts` — +7 `entityCardUrl` cases.
- `src/routes/(app)/album/[name]/+page.ts` — read `c`/`dn`/`da`; `buildOg` with cover + display title;
  dropped the description override.
- `src/routes/(app)/album/[name]/+page.svelte` — `shareAlbum()` s2t + heroImg cover via `entityCardUrl`.
- `src/routes/(app)/artist/[name]/+page.ts` — read `c`/`dn`; `buildOg` with cover + display title;
  dropped the description override.
- `src/routes/(app)/artist/[name]/+page.svelte` — `shareArtist()` s2t + heroImg cover via `entityCardUrl`.

## Verification

- `pnpm test` → **1341/1341** (79 files, +7); `pnpm check` → **0 / 0** (4338 files).
- SSR OG head E2E-verified on the dev server (both routes `ssr = true`; no CN upstream needed):
  - `GET /album/范特西?artist=周杰伦&c=https://cdn.example.com/a.jpg&da=周杰倫`
    → og:title `范特西 • 周杰倫`, og:description `Listen on openmusic`, og:image the cover.
  - `GET /artist/周杰伦?c=https://cdn.example.com/x.jpg&dn=周杰倫`
    → og:title `周杰倫`, og:description `Listen on openmusic`, og:image the cover.
  - `GET /album/Fantasy` (no cover / no artist) → og:title `Fantasy`, og:image `/og.svg`.
- Client `shareAlbum`/`shareArtist` s2t + share-sheet path is client-side (real share gesture +
  tongwen dict) → human UAT; the pure pieces (`entityCardUrl`, `s2tConvertLines`) are unit-tested.

## Notes / out of scope

- The resolution path key is deliberately NOT converted (resolution safety — see above).
- Only zhs→zht (per the request); native share-sheet image files not added.
