---
quick_id: 261115-inj
mode: quick
---
# Quick 261115-inj: desktop Nowbar track menu + Like/Download; two-up Now Playing

1. `src/lib/components/Nowbar.svelte` — on the desktop bar (`desktopBar`), right-click or long-press on `.np-open` opens a TrackMenu for `player.current`; add Like (Heart) + `DownloadControl` beside the track info.
2. `src/lib/components/NowPlaying.svelte` — new `mid` rung `(min-width: 768px)` below `wide` (1280): two columns, Up Next | tabbed (Lyrics · Comments · Related · About). `split = wide || mid` replaces `wide` in the sheet-open and Up-Next-visibility decisions.

Verify: `pnpm check` (0 errors), `pnpm test`.
