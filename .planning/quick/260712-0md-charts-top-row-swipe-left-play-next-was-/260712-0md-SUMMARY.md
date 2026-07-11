---
quick_id: 260712-0md
slug: charts-top-row-swipe-left-play-next-was-
date: 2026-07-11
status: complete
commit: 47094e4
---

# Summary 260712-0md: charts/top row swipe-left = play next (was like)

## What shipped

`charts/top/+page.svelte` (Top Hits view) was the **last** track list still
binding row swipe-left to a like action. Converted to play next — swipe-left =
play next is now consistent across EVERY track list in the app.

Before: swipe-left = `swipeLike` → `library.toggleLike` + `Heart` `reveal-left` + like toast.
After: swipe-left = `swipeNext` → `player.playNext` + `ListStart` `reveal-left` + "Playing next".

## Changes (single file)

- `swipeLike(it)` → `swipeNext(it)`: resolve the `DiscoveryTrack` stub, then
  `player.playNext(tr)` + `haptics.tick()` + `toast.show(t('toast.playingNext'))`.
  Kept the WR-03 per-row in-flight guard (key `n:${rowKey}`).
- Left reveal `Heart` + `class:on={liked}` → `ListStart` (removed `{@const liked}`).
- `onSwipeLeft: () => swipeLike(it)` → `swipeNext(it)`.
- Removed dead like path: `library`/`Heart` imports, `likedRows` state,
  `.reveal-left.on` CSS. (charts/top has no album-level like, so `library` was
  fully removable — unlike album/[name].)

Out of scope, left untouched: header, `.head`/back-button (concurrent session
owns those), `.reveal-*` background styling, the Artists-tab rows (no swipe).

## Verification

- `pnpm check`: **0 errors** (only the pre-existing unrelated `.warn` warning in
  search/+page.svelte). Verified via **sed** (grep was malfunctioning on this file
  in-shell — returned empty for matching patterns, a binary/NUL suppression quirk):
  no `swipeLike`/`reveal-like`/`class:on`/`likedRows`/`library`/`Heart` residue;
  `swipeNext`/`player.playNext`/`ListStart` present.
- No browser smoke-check: charts/top loads Last.fm chart data + swipe-resolve routes
  through CN proxies, both unreachable in this sandbox (memory: sandbox-no-cn-upstream-network)
  → device UAT for the live gesture.

## App-wide state

swipe-left = play next now holds on ALL swipe-enabled track lists: search, library,
artist, album, charts/countries, charts/tags, **charts/top**, NowPlaying up-next.

## Files

- `src/routes/(app)/charts/top/+page.svelte`

## Commit

- `47094e4` feat(charts): top-page row swipe-left = play next (was like)
