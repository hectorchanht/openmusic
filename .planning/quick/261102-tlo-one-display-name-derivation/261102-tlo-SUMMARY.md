---
quick_id: 261102-tlo
status: complete
---
# Summary — §8 display names converged

- Both song pages: names.dnTitle/dnArtist (translation + rescued aliases + lock) replace the bare
  zhLock, so a song reads the same on its page as in the Nowbar.
- Skip toast: the notice carries RAW title + artist; the layout renders names.dnTitle (was raw).
- SyncReviewModal, settings/downloads retag list: names.dn* (were raw catalog text).
- SongRow default subtitle: album via dnTitle(album, artist), artist via dnArtist (album used to go
  through the artist translator).
- Artist page: share text, <title>, loading and empty states use the header's displayName
  (fullestDisplayName — canonical never shrinks display) instead of the raw route segment.
- Earlier in §6: the Netease-override MediaMetadata now uses dn* too.
- Not done (open): per-segment (NowPlaying, smart SongRow) vs whole-string dnArtist (Nowbar,
  MediaSession, share) can still differ for multi-artist credits whose alias is keyed per segment.
- Suite 246 files / 5200 tests pass; svelte-check 0 errors.
