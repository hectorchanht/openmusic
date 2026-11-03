---
quick_id: 261102-twq
status: complete
---
# Summary — §10 Up-Next window converged

- `upnext-scroll.upNextWindowStart`: the list starts at the anchor but never after the current
  song. NowPlaying's local anchorIdx/upNextStart computation is gone; prev(), playNext on the
  anchor row, anchor-less restore and late list installs can no longer hide the playing song.
- Not done (open, biggest remaining §10 item): list SOURCING is still four install idioms
  (setQueue / setListQueue / playStub+setListQueue / play(context)) with a stale-tap guard only on
  album rows and Home shelves installing no list; the plan's single `player.startList` is unbuilt.
- Suite 248 files / 5209 tests pass; svelte-check 0 errors.
