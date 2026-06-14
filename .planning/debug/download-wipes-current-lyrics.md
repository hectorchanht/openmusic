---
status: resolved
trigger: "after download, the lyrics of current song is wiped off which should not happen"
created: 2026-06-15
updated: 2026-06-15
---

# Debug Session: download-wipes-current-lyrics

## Symptoms

- **Expected:** Triggering a download of the current track leaves the now-playing lyrics view intact.
- **Actual:** After download, the lyrics of the current song are wiped off.
- **Errors:** (none reported)
- **Timeline:** present in current build; download flow predates the d744f63 picker commit.
- **Reproduction:** Play a track with lyrics → trigger download of current track → lyrics view clears.

## Current Focus

- hypothesis: A "rebuild current as a fresh stub" path nulls `lrc` and the offline/re-resolve branch surfaces that lrc-less object as `player.current`, so the lyrics `$derived` (which reads `player.current?.lrc`) renders empty.
- next_action: preserve `lrc`/`lrcUrl` on every current-track rebuild instead of nulling them.
- reasoning_checkpoint:
- tdd_checkpoint:

## Evidence

- timestamp: 2026-06-15 — NowPlaying lyrics are derived purely from the live current track:
  `src/lib/components/NowPlaying.svelte:80-82` → `lines = $derived(player.current?.lrc ? ... : [])`.
  So the ONLY way the view wipes is `player.current.lrc` going null/empty.
- timestamp: 2026-06-15 — The now-playing options menu passes the LIVE `player.current` reference
  into TrackMenu: `src/lib/components/NowPlaying.svelte:847` → `openMenu(player.current)`.
- timestamp: 2026-06-15 — `doDownload` re-resolves on a SPREAD COPY
  (`src/lib/components/TrackMenu.svelte:107-111`: `{ ...resolved, detailsLoaded:false, audioUrl:null, lrc:null }`),
  so the download path itself does NOT mutate `player.current`. Confirmed isolated.
- timestamp: 2026-06-15 — Source adapters netease/qq/joox MUTATE the passed track IN PLACE and return it
  (`netease.ts:83-122`, `qq.ts:185-248`, `joox.ts:211-277`); kuwo returns a fresh object (`kuwo.ts:96-124`).
  In-place mutation only ever reaches the throwaway copy in `doDownload`, never `current`.
- timestamp: 2026-06-15 — Every "rebuild current track" path nulls lyrics:
  - `player.svelte.ts:359` (restore reshape) sets `lrc: null` / `lrcUrl: null`.
  - `player.svelte.ts:392` (restore offline-blob branch) sets `this.current = { ...target, detailsLoaded:true }`
    WITHOUT re-resolving — so the lrc-less reshape is surfaced directly.
  - `player.svelte.ts:440` (`reresolveCurrent`) builds `stub = { ...current, detailsLoaded:false, audioUrl:null, lrc:null }`.
  - `player.svelte.ts:1399` (`play()` offline-blob branch) sets `this.current = { ...track, detailsLoaded:true }`.
- timestamp: 2026-06-15 — Once a track is downloaded (`library.addDownload` → `isDownloaded(uid)` true +
  `blobStore.put`), the offline-blob branches above become reachable for THAT uid. A stale-URL
  `audio.error` on the currently-playing element (the download fetch hits the same CDN) routes into
  `reresolveCurrent()`, whose `stub` nulls `lrc`; the best-effort lyric re-fetch can fail (proxy busy),
  leaving `current.lrc = null` → lyrics wipe. The offline-blob `play()`/restore branches likewise
  surface an lrc-less object as current.

## Eliminated

- TrackMenu `doDownload` directly mutating `player.current` — ruled out: it operates on a spread copy.
- `library.save()` stripping lrc — ruled out: `save()` JSON.stringifies the live objects without
  mutating and without stripping `lrc`.
- `adoptCover` in-place mutation — ruled out: only fills the empty `cover` field, never `lrc`.

## Resolution

- root_cause: Lyrics in NowPlaying derive solely from `player.current.lrc`. Several player paths
  rebuild the current track as a "fresh stub" with `lrc`/`lrcUrl` explicitly nulled (restore reshape,
  the restore + `play()` offline-blob branches, and `reresolveCurrent`). Lyrics are a stable per-song
  attribute, but these rebuilds discard them, and the offline/re-resolve branches either skip lyric
  re-resolution entirely or rely on a best-effort re-fetch that can fail — surfacing an lrc-less object
  as `current` and wiping the lyrics view. Downloading the current track makes `isDownloaded(uid)` true,
  which arms those offline-blob branches for the playing song.
- fix: Preserve `lrc`/`lrcUrl` when rebuilding the current track instead of nulling them — the audio URL
  is the only volatile field that must be refreshed. (1) restore reshape keeps persisted `lrc`/`lrcUrl`;
  (2) the restore offline-blob branch and the `play()` offline-blob branch carry the track's existing
  `lrc` forward; (3) `reresolveCurrent`'s stub keeps `lrc`/`lrcUrl` so a URL refresh never drops lyrics.
- verification: `pnpm test` (player + track-menu suites) green; lyrics survive download of the current track.
- files_changed:
  - src/lib/stores/player.svelte.ts
</content>
</invoke>
