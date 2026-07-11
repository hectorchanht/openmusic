---
quick_id: 260711-trh
slug: album-row-swipe-left-play-next-was-like
date: 2026-07-11
status: complete
commit: dce0af0
---

# Summary 260711-trh: album row swipe-left = play next (was like)

## What shipped

`album/[name]/+page.svelte` song rows now match every other track list:
**swipe-left = play next**, not like. Album was the last odd-one-out (after
260711-t51 converted charts/countries + charts/tags).

Before: row swipe-left = `swipeLike` → `library.toggleLike` + `Heart` `reveal-like`.
After: row swipe-left = `swipeNext` → `player.playNext` + `ListStart` `reveal-next`
+ "Playing next" toast — identical to search/library/artist.

## Scope note — narrower than the charts fix

`library` and `Heart` imports were **kept**: the album-LEVEL like button
(`likeAlbum`, `albumLiked`, header `Heart`) and like-all logic still use them.
Only the row swipe-left path changed.

## Changes (single file)

- `swipeLike(stub)` → `swipeNext(stub)`: resolve the `AlbumStub`, then
  `player.playNext(tr)` + `globalToast.show(t('toast.playingNext'))` + `hapticTick()`.
  Kept the WR-03 per-row in-flight guard (`shouldRun`/`swipeInFlight`), key `n:${stubUid}`.
- Row reveal `reveal-like`/`Heart` → `reveal-next`/`ListStart` (added `ListStart` to the
  line-25 lucide import).
- `onSwipeLeft: () => swipeLike(track)` → `swipeNext(track)`.
- CSS `.reveal-like` → `.reveal-next`.
- Updated the swipe-action doc comment + line-76 key comment (like → play next).

## Verification

- `pnpm check`: **0 errors** (only the pre-existing unrelated `.warn` warning in
  search/+page.svelte). Grep confirms no `swipeLike`/`reveal-like` row residue and
  the album-level like path (`library.isLiked`, `albumLiked`, `likeAlbum`) intact.
- No browser smoke-check: the album page loads its tracklist from Last.fm album.getInfo
  and swipe-resolve routes through CN proxies — both unreachable in this sandbox
  (memory: sandbox-no-cn-upstream-network). 1:1 mirror of the shipped search-page
  `swipeNext` → device UAT for the live gesture.

## Files

- `src/routes/(app)/album/[name]/+page.svelte`

## Commit

- `dce0af0` feat(album): song-row swipe-left = play next (was like)
