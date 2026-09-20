# Deferred items — quick-260920-nyq

## Two more now-playing-adjacent surfaces still lead with `player.resolvedCover`

Found while verifying T3. Out of this plan's scope (it named the hero, the Nowbar and the OS media
card), and both are behaviour changes rather than refactors, so they were NOT touched.

| File | Line | Expression |
|------|------|------------|
| `src/lib/components/TrackMenu.svelte` | 168 | `readPinnedCover(uid) ?? (current?.uid === track.uid ? player.resolvedCover : null) ?? readCoverByUidOrName(...) ?? track.cover` |
| `src/lib/services/download-track.ts` | 225 | `(current?.uid === r.uid ? player.resolvedCover : null) ?? readCoverByUidOrName(...) ?? r.cover` |

Both keep the OLD precedence (resolvedCover ahead of the shared cache) for the playing song. After
nyq the hero paints cache-first, so when the two disagree:

- TrackMenu's `activeCover` can pre-select / highlight a picker tile that is not the cover the hero
  is showing.
- A download can embed a different cover into the file than the app displays.

Neither is a regression introduced here (the divergence window existed before, just on the other
side), and both already read the PIN first, so a user's explicit choice is consistent everywhere.

Fix, when someone decides the behaviour: swap both to `player.displayCover` for the playing song —
one-line each, same getter. It needs a decision because it changes which art gets written into
downloaded files.
