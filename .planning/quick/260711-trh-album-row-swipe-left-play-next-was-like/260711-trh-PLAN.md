---
quick_id: 260711-trh
slug: album-row-swipe-left-play-next-was-like
date: 2026-07-11
status: ready
---

# Quick Task 260711-trh: album row swipe-left = play next (was like)

## Problem

`album/[name]/+page.svelte` song rows bind **swipe-left** to a **like** action
(`swipeLike` → `library.toggleLike`, `Heart` `reveal-like`). Every other track
list (search, library, artist, NowPlaying up-next, and now charts/countries +
charts/tags via 260711-t51) uses swipe-left = **play next**. Album is the last
odd-one-out. swipe-right = add to queue is already consistent.

## Fix (single file)

Convert the row swipe-left path from "like" to "play next". Mirror the row's own
`swipeQueue` (stub-resolving) structure and the search-page `swipeNext` semantics.

**IMPORTANT — narrower than the charts fix:** `library` and `Heart` are NOT
removed. They are still used by the album-level like button (`likeAlbum`,
`albumLiked`, the header `Heart`) and the like-all logic. Only the ROW swipe-left
changes.

1. Line 25 import: `import { ListEnd }` → `import { ListEnd, ListStart }`.
2. Replace `swipeLike(stub)` with `swipeNext(stub)`: resolve the stub, then
   `player.playNext(tr)` + `globalToast.show(t('toast.playingNext'))` + `hapticTick()`.
   Keep the WR-03 in-flight guard; key `n:${stubUid(stub)}`.
3. Row reveal: `<span class="reveal reveal-like"...><Heart .../></span>` →
   `<span class="reveal reveal-next"...><ListStart size={20} /></span>`.
4. Binding: `onSwipeLeft: () => swipeLike(track)` → `onSwipeLeft: () => swipeNext(track)`.
5. CSS: rename `.reveal-like { right: 0; ... }` → `.reveal-next { right: 0; ... }`.
6. Update the swipe-action doc comment (line 224 block) + the line-76 key comment:
   "toggle like" → "play next", "swipeQueue/swipeLike" → "swipeQueue/swipeNext".

## Tasks

- [ ] T1: Convert album row swipe-left → play next in `album/[name]/+page.svelte`

## Verify

- `pnpm check` passes (0 errors). `library`/`Heart` remain (album-level like intact).
- Row swipe-left reveal shows `ListStart`, fires `player.playNext` + "Playing next"
  toast — identical semantics to search/library/artist.

## Done

Album song-row swipe-left = play next. Album-level like button unchanged.
No `swipeLike`/`reveal-like` remaining.
