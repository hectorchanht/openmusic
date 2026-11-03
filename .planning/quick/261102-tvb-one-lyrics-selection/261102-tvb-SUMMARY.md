---
quick_id: 261102-tvb
status: complete
---
# Summary — §9 lyrics selection converged

- readLyrics (stores/lyric-pins.svelte.ts: user pin > track.lrc) now decides lyrics on every
  surface: download embed (download-track), Track Detail "Lyrics" row, settings/downloads retag sweep
  (was a re-inlined `getPinnedLyrics ?? d.lrc`), and the player — backfillLyrics no longer walks the
  network for a pinned song and embedLyricsIntoFile writes the pin over the chain LRC.
- Not done (open): pins are uid-keyed, so a pin made on a twin uid (qq) does not reach a file saved
  under another uid (kuwo); "Use automatic" leaves the old pin in the file; the local lyric offset is
  keyed by uid only (applies a chain-tuned offset to a pinned LRC).
- Suite 247 files / 5205 tests pass; svelte-check 0 errors.
