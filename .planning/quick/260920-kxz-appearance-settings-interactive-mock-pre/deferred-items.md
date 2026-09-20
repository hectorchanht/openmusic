# Deferred items — quick-260920-kxz

## Orphaned i18n keys (out of scope, no user impact)

The Appearance rewrite left 10 keys with zero call sites outside `src/lib/i18n/`:
`settings.appearanceText`, `settings.appearanceLayout`, `settings.rowButtons`,
`settings.rowButtonsDesc`, `settings.coverScaleDesc`, `settings.fontSizeTitleDesc`,
`settings.fontSizeArtistDesc`, `settings.fontSizeLyricsDesc`, `settings.fontSizeNpTitleDesc`,
`settings.fontSizeNpArtistDesc` — ~150 lines across 15 dictionaries.

Not removed here: the plan enumerated the exact i18n edits, and key parity is guarded by
`i18n.test.ts`, so they are inert rather than wrong. Worth one sweep next time a locale file is
touched anyway.

## RESOLVED — `pnpm check` was briefly red from a CONCURRENT session (not this task)

`src/lib/components/TrackMenu.svelte` is modified-but-uncommitted in this shared working tree by
quick-260920-l82 (`resolveShareCover` / `shareItunesMemo` refactor) and is mid-edit: 3 svelte-check
errors, all in that one file. Left untouched, not staged, not fixed — it is another session's
in-flight work. See MEMORY "concurrent debug sessions shared-worktree collision".

**Resolved** at the end of this run: that session committed `3697f93` + `c7f2c27` and `pnpm check`
returned to `4577 FILES 0 ERRORS 0 WARNINGS`. Nothing to do.
