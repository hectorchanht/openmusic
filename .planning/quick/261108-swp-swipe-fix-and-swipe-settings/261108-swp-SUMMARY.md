---
quick_id: 261108-swp
status: complete
---
# Quick 261108-swp: touch swipes inside Now Playing fixed + configurable swipe actions

## Bug (commit e9b7cb93)
Cover carousel, Up Next and Related row swipes sprang back after a few px on Android Chrome / APK.
`lostpointercapture` bubbles: on touch the implicit capture sits on the child under the finger
(cover <img>, title span); the gesture's `setPointerCapture` moved it to the action node, the
child fired lostpointercapture, it bubbled to the node and was read as the node's own capture
loss -> cancel. Every lostpointercapture handler (coverSwipe, swipeAction, dragClose,
chipReorder, scrub, NpUpNext grip, RowActionsConfig, TrackMenu) now ignores non-own targets.
Reproduced + verified in headless Chrome (CDP touch) and on the Pixel_3a_API_34 emulator APK
with real `adb input swipe`.

## Feature
- Defaults in `config/defaults.ts` PLAYBACK_DEFAULTS: `swipePlayer {left:'next', right:'prev'}`,
  `swipeRow {left:'playNext', right:'like'}`; types `SwipeAct` / `SwipeMap` / `SWIPE_ACTS`.
- settings store: `swipePlayer` / `swipeRow`, validated load (`readSwipeMap`), save, resetPlayback.
- `components/swipe-act.ts`: `rowSwipe()` (row executor, stub resolve, in-flight guard, toast,
  haptic) + `playerSwipe()` (coverSwipe slots for Nowbar + NP cover; off/playNext/queue rubber-band).
- `SwipeReveal.svelte`: reveal glyphs follow the map; replaces hard-coded pairs on 8 surfaces.
- Charts ×4 + album per-page swipeLike/swipeNext/swipeQueue boilerplate removed (SongRow default now
  resolves through the row's resolver). Album right-swipe queued under a Heart icon — now consistent.
- Settings → Playback: two sections (playing song: next/prev/like/off; song rows: all six).
- i18n: 5 new keys in all 15 locales; labels reuse nowplaying.next/previous, menu.like/playNext/addToQueue, settings.optOff.
- Up Next rows keep their own swipes (versions / remove).

## Verify
vitest: all new tests pass; 5 failures pre-existing on base (settings-persist showSourceTag ×3,
track-menu-order ×2). pnpm check 0 errors. Headless E2E: default Nowbar next/prev, left=like
likes the current song, right=off rubber-bands, settings page renders at 390px.
