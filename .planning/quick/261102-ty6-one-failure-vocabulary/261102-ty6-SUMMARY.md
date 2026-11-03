---
quick_id: 261102-ty6
status: complete
---
# Summary — §13 failure vocabulary (first pass)

- runFallback budget expiry: the skip is now named in the batched skip toast (was silent); still
  outside failoverSkips by the documented 31-D-17 rationale.
- play() catch: sets the `toast.playbackStopped` key and logs the raw message (`play.throw`) — no
  untranslatable text crosses store → UI.
- `album.unplayable` deleted from all 16 locales; the album page uses `home.unplayable` (identical
  text everywhere).
- Not done (open): stall-skip and budget-expiry still don't count toward the systemic cap (a run of
  timeouts never stops playback); the batched toast `{count} songs skipped` carries no names;
  exhaustion (up-next-dry) and systemic stop share `toast.playbackStopped`; list starts (pack /
  album / discography Play) abort on track 0 instead of skipping to the next stub; ~20 caller
  toast gates remain inline.
- Suite 248 files / 5209 tests pass; svelte-check 0 errors.
