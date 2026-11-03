---
quick_id: 261102-tdc
status: complete
---
# Summary — §6 cover resolution converged

- `song-variant.isCoverOf(song, cand)`: sameArtistCredit (whole segment / script-run alias —
  product call: was ≥2-char containment in /api/og) + identity title keys (folded, brackets
  dropped, either bilingual half) after a bare explicit/clean/remaster/live/acoustic tail. New
  `dedupe.titleKeys`.
- Gated rungs: itunesSongCover (scans 5 results), deezerSongCover (scans 5 hits), deezerArtistCover
  (top hit's artist must match), cover race CN tier, qqSongCover, ytmusicSongCover,
  /api/deezer/album hero (scans 5), /api/og (ogTitleKey/ogArtistMatches deleted; the s2t wants
  widening deleted — folded keys cover both scripts).
- Readers: lazyCover reads name-first (was the one uid-first reader); NowPlaying neighbour cells,
  home fallback grid and home discovery tiles read readCoverByUidOrName; chart shelf reads cache
  before seed; NowPlaying share URL uses displayCover like TrackMenu. readCoverByName deleted.
- Writers: preferItunesOverNetease, lazyCover's Netease branch and library.adoptCover write via
  writeCoverBoth (iTunes override now visible on hero/Nowbar; media metadata uses display names).
- Not done (open): /api/og requests from native media session / download embed / share carry
  display names as the resolve identity.
- Suite 246 files / 5200 tests pass; svelte-check 0 errors.
