---
quick_id: 260831-k5y
title: Setting to show the music-quality tag on the Now Playing page
date: 2026-08-31
status: complete
commit: d434e6a
---

# What shipped

An opt-in setting that renders the currently-playing track's quality tag (FLAC / 320 / …)
on the Now Playing page. Off by default.

# Changes

**`src/lib/config/defaults.ts`** — `PLAYBACK_DEFAULTS.showQualityTag: false`. Off by
default because it is extra chrome and the same value already reaches the user through the
song detail sheet for occasional checks.

**`src/lib/stores/settings.svelte.ts`** — the store's four touch points, mirroring
`autoExpandOnPlay` exactly: `$state` field init (`:181`), `load()` `typeof === 'boolean'`
guard so a tampered value falls back (`:301`), `save()` (`:401`), `resetPlayback()` (`:498`).
WR-10 respected — the literal lives only in `defaults.ts`.

**`src/routes/(app)/settings/playback/+page.svelte`** — toggle row plus `.muted` helper
paragraph in the existing "Playback & motion" section, directly under Auto-expand, reusing
that section's `.row-toggle` / `.sw` markup. `BadgeCheck` icon added to the lucide import.

**`src/lib/i18n/*.ts`** — `settings.showQualityTag` and `settings.showQualityTagDesc` added
to all 15 dictionaries (en ar de es fr hi id it pt ru th tr vi zh-Hans zh-Hant). Double
quotes for every key and value per the manual convention; `en` defines `TranslationKey`, so
a gap would be a compile error, and `i18n.test.ts` guards key-set parity.

**`src/lib/components/NowPlaying.svelte`** — a `qualityTag` `$derived` reading
`player.current?.qualityLabel || player.current?.quality || null` (the same order
`TrackMenu.svelte:429` and `VersionPicker.svelte:58` already use), and a `.quality-tag`
pill under the title/artist rows inside `.meta`.

Two placement decisions worth keeping:

- The pill sits **outside** the `{#key player.current?.uid}` block. The value arrives
  asynchronously after `ensureTrackDetails`, so keeping it out of the key block lets it
  repaint in place instead of remounting with the title/artist crossfade.
- It renders nothing at all when the track has no tag, so an unresolved stub — or a source
  that reports no tier — leaves no empty pill.

Pill font size is `calc(0.7rem * var(--fs-np-artist, 1))`, so it tracks the Now-Playing
artist appearance scale and stays smaller than the line above it.

# Verification

- `pnpm test` — 95 files, **1777 tests passed** (includes the i18n key-set parity suite).
- `pnpm check` — 4380 files, **0 errors, 0 warnings**.
- Live on `localhost:4321`:
  - Fresh state → toggle renders in Playback & motion, **off**.
  - Toggling on → `openmusic:settings:v1.showQualityTag === true`, switch on.
  - Now Playing → `.quality-tag` present, text `LOSSLESS`, under Shiver / Coldplay.
  - Toggling off + reload → switch off AND pill absent (both directions survive a reload).

# Not touched

- How adapters produce `quality` / `qualityLabel`.
- The TrackMenu and VersionPicker renderings — unchanged.
