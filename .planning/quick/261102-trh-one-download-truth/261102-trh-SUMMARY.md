---
quick_id: 261102-trh
status: complete
---
# Summary — §11 download truth converged

- `library.downloadUidFor` uses isSameShelfSong (script-folded, alias-aware, same version) — the
  identity addDownload / otherDownloadOf already used; versionedMatchKey gone from the library.
- RowBadges takes the row's track and shows ✓/ring/⚠ for the song's download record (a twin under
  another source's uid counts — the player plays it offline). Every row host passes `track`.
- DownloadControl, TrackMenu radio/detail/remix fast paths: song-level via downloadUidFor.
- download-album: the held record comes from library.downloadUidFor (its local sameSongKey match
  let a live cut reuse the studio file).
- Not done (open): TrackMenu's own blob probe (file presence) and the settings pages' blob sweeps
  still read blob-store directly; the offline queue trusts the list.
- Suite 247 files / 5204 tests pass; svelte-check 0 errors.
