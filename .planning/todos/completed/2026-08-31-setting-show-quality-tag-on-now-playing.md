---
created: 2026-08-31T19:58:01.811Z
title: "Setting: show the music-quality tag on the Now Playing page"
area: general
files:
  - src/lib/components/NowPlaying.svelte
  - src/routes/(app)/settings/playback/+page.svelte
  - src/lib/config/defaults.ts:84 (PLAYBACK_DEFAULTS)
  - src/lib/stores/settings.svelte.ts
  - src/lib/sources/types.ts:43 (quality / qualityLabel on Track)
---

## Problem

The resolved track already carries a quality tag (`Track.quality` + `Track.qualityLabel`,
`src/lib/sources/types.ts:43`), and it is surfaced in `TrackMenu.svelte:429` (song detail
sheet) and `VersionPicker.svelte:58`. It is NOT shown on the Now Playing page, so the user
has to open a menu to see whether the thing currently streaming is FLAC / 320 / 128.

Wanted: an opt-in setting that renders that tag on Now Playing. It must be a toggle (some
users do not want the chrome), not an unconditional badge.

## Solution

1. New boolean in `PLAYBACK_DEFAULTS` (`src/lib/config/defaults.ts`) — e.g.
   `showQualityTag: false` — surfaced as a `$state` field + load()/reset group entry in
   `settings.svelte.ts`. WR-10: default literal lives ONLY in defaults.ts.
2. Toggle row on the Playback settings page (`settings/playback/+page.svelte`) near the
   existing quality/source rows. New `TranslationKey` → add the key to ALL 16 dictionaries
   in `src/lib/i18n/*.ts` (DOUBLE QUOTES convention; `i18n.test.ts` guards key-set parity).
3. Render in `NowPlaying.svelte` gated on the setting. Position is the implementer's call —
   the natural spot is a small pill next to the title/artist line or beside the source badge.
   Read `player.current.qualityLabel || player.current.quality`; render nothing when both are
   null (a stub that has not resolved yet, or a source that reports no tier).

Placement/style is deliberately left open. Keep it a small muted pill, consistent with the
existing badge styling on that page.
