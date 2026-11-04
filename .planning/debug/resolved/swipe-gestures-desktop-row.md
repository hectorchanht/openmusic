---
status: resolved
trigger: "fix swipe GUESTURE ON song row 去APPEND TO UP NEXT LIST AND COVER SWIPE TO PREVIOUS/NEXT SONG. and FIX COVER SWIPE IN NOW PLAYING PAGE AND SWIPE IN NOW PLAYING BAR. 目前desktop web app cover/BAR 可以滑動但唔會轉歌. SWIPE SONG ROW 要滑動到好遠先成功,時不時失敗. 另外目前從右向左swipe song row係append to up next list which is good to keep, 左向右係append to end of up NEXT LIST 但依個功能好似無乜用"
created: 2026-11-04
updated: 2026-11-04
---

## Symptoms

1. **NowPlaying cover swipe + Nowbar swipe (desktop web):**
   - expected: horizontal swipe/drag on the NowPlaying cover or the Nowbar changes to previous/next song.
   - actual: on desktop web the cover/bar visibly drags/slides but the song never changes.
2. **Song row swipe:**
   - expected: a moderate swipe reliably triggers the row action.
   - actual: must drag very far before it succeeds; fails intermittently.
3. **Product change (decided by user 2026-11-04):**
   - right-to-left row swipe = insert into Up Next (play next) — KEEP.
   - left-to-right row swipe currently = append to END of Up Next (not useful) — CHANGE to 收藏 / add to Library (like/save), with toast + undo.

- errors: none reported
- timeline: unknown; desktop cover/bar swipe never confirmed working
- reproduction: desktop browser (mouse drag) on NowPlaying cover / Nowbar; mobile + desktop on song rows in lists

## Hints

- src/lib/actions/coverSwipe.ts and other swipe actions in src/lib/actions/*
- Nowbar.svelte, NowPlaying.svelte, CompactRow, per-page swipeQueue/swipeNext row boilerplate
- library store (like/save API)
- memory: touch hold pointercancel fires on scroll takeover; Svelte delegated onpointerdown cannot stopPropagation a native ancestor listener; mouse drag may need pointer events (touch-only listeners never fire on desktop)

## Current Focus

reasoning_checkpoint:
  hypothesis: "Item 1: coverSwipe's commit distance is 0.28 × element width with NO cap; on desktop the Nowbar .np-open is ~800-1400px wide (rail-to-window) and the open-sheet cover (.np.reflow) spans the sheet width, so a mouse drag needs 225-400px (and mouse/trackpad releases rarely exceed the 0.5 px/ms flick), so the surface slides and springs back without firing prev/next. Item 2: tapBounce adds a 0.22s CSS `transform` keyframe animation on the SAME .srow node swipeAction writes its inline translateX to — a CSS animation beats inline style in the cascade, so the first 220ms of every row swipe is visually masked (short flicks show nothing, longer drags jump late), which reads as 'need to drag very far / sometimes nothing happens'."
  confirming_evidence:
    - "Headless Chrome 156 + CDP mouse drag on the LIVE app at 1280x813 (desktop media query true): .np-open width 804px → commitDist 225px; a 402px drag DID fire player.next/prev (so listeners/capture/pointerup order are fine on mouse), event order pointerdown→gotpointercapture→[commit]→pointerup→lostpointercapture."
    - "Isolated mount of both actions on 400px scratch divs: 200px slow mouse drag commits, 150px row drag commits, 60px fast flick commits — gesture logic itself is sound with pointerType=mouse."
    - "app.css .tap-bouncing { animation: tap-bounce 0.22s } keyframes animate `transform`; SongRow mounts use:tapBounce AND use:swipeAction on the same .srow wrapper."
  falsification_test: "After capping commitDist at 120px, a 130px mouse drag on an 804px-wide .np-open must fire player.next (CDP re-run). After tapBounce drops its class on >8px pointer movement, the row's inline translateX must be the computed transform during a drag."
  fix_rationale: "Cap the proportional commit at an absolute thumb-length (min(0.28×width, 120px)) in ONE shared helper used by both horizontal gestures; make tapBounce cancel the bounce once a press becomes a drag (a drag is not a tap) so the swipe is visible from the first frame."
  blind_spots: "User's desktop browser is unknown (Safari/Firefox not driven here); only Chrome verified. Flick velocity still uses the 2-sample tracker — a decelerating finger at lift can still read < 0.5 px/ms, which the distance path covers."

next_action: none — resolved; device verification by Hector (desktop mouse on Nowbar/cover; phone row swipe)

## Evidence

- timestamp: 2026-11-04
  checked: knowledge-base.md for 'swipe' entries
  found: none
  implication: no prior pattern; investigate from scratch

- timestamp: 2026-11-04
  checked: src/lib/actions/coverSwipe.ts, swipeAction.ts (full read) + git log (8ecfcf0e quick-261102-u05 added lostpointercapture→cancel)
  found: both use pointer events (mouse fires them), capture in move() after 8px slop, commit on release when |dx| ≥ commitDist OR |v| > 0.5 px/ms. coverSwipe commitDist = 0.28 × getBoundingClientRect().width with no upper bound.
  implication: on wide desktop surfaces the required drag is hundreds of px

- timestamp: 2026-11-04
  checked: headless Chrome 156 via CDP, actions mounted on 400px scratch divs (served by Vite dev)
  found: cover 200px slow drag → NEXT; row 150px → RIGHT; row 60px fast flick → LEFT. Event order: pointerdown, gotpointercapture, pointerup, lostpointercapture (then commit for the row because it is deferred to the settle frame).
  implication: ELIMINATES 'mouse pointerType filtered', 'pointerup lost', 'lostpointercapture-before-pointerup cancels the gesture' for Chrome

- timestamp: 2026-11-04
  checked: live app at 1280x813 with a synthetic 4-track queue; CDP mouse drags on .np-open (804px wide) and .cover-strip (298px)
  found: 50% drags fire player.next/prev; .np-open commitDist = 225px at this width (would be ~400px on a 1920 monitor); open-sheet cover gets `.np.reflow .cover { width:auto; margin:0 -18px }` = sheet-wide.
  implication: ROOT CAUSE item 1 = uncapped proportional commit on wide desktop surfaces (+ mouse rarely flicks > 0.5 px/ms)

- timestamp: 2026-11-04
  checked: src/lib/actions/tapBounce.ts + src/app.css .tap-bouncing / @keyframes tap-bounce; SongRow.svelte mounts both actions on .srow
  found: pointerdown adds a 0.22s `transform: scale()` keyframe animation on the swiped node; CSS animations override inline `style.transform`, so swipeAction's translateX is invisible for the first 220ms of every row swipe (a <220ms flick shows no movement at all).
  implication: ROOT CAUSE item 2 (visual): the swipe does not follow the finger at first → users drag further than needed / read a flick as 'nothing happened'

- timestamp: 2026-11-04
  checked: call sites of the row swipe convention
  found: SongRow default (queueTrack/nextTrack); charts top/tags/countries/shelf pass their own swipe={{swipeQueue, swipeNext}} over DiscoveryTrack stubs; NpRelated has relatedSwipeQueue/Next; reveal glyphs ListEnd/ListStart in search, library (x4), album, NpRelated, 4 charts pages. i18n has no swipe-describing strings; toast.liked / toast.unliked / toast.undo already exist in all locales.
  implication: item 3 = one shared likeWithUndo helper + 6 handler sites + 11 icon sites; no new i18n keys needed

- timestamp: 2026-11-04 (post-fix)
  checked: CDP re-run on the live app (804px .np-open, 320px .cover-strip) with 60s silent audio so auto-advance cannot confound
  found: slow 137px drag left → player.next; slow 80px drag → NO commit (spring back); slow 137px drag right → player.prev; cover ±160px → next/prev. Before the fix the same bar needed 225px.
  implication: item 1 fix verified in Chrome; `pnpm check` 0 errors; `pnpm test` 5260/5261 (the 1 failure is device-filename.test.ts's 2000ms regex-timing budget under load — unrelated, passes in isolation)

## Eliminated

- hypothesis: coverSwipe/swipeAction only listen for touch events (mouse never fires)
  evidence: both attach pointerdown/move/up; CDP mouse drag fires them (pointerType=mouse logged)
  timestamp: 2026-11-04
- hypothesis: lostpointercapture fires before pointerup in Chrome so quick-261102-u05's cancel path springs back without committing
  evidence: logged order pointerup → lostpointercapture; commit fired
  timestamp: 2026-11-04
- hypothesis: pointer capture missing / pointerup lost outside the element
  evidence: gotpointercapture logged after slop; pointerup delivered to the captured node at 402px away from start
  timestamp: 2026-11-04

## Resolution

root_cause: |
  (1) coverSwipe commit distance = 0.28 × measured width with no ceiling. Desktop surfaces are wide (Nowbar .np-open spans rail-to-window = 804px at 1280, ~1400px at 1920; the open sheet's cover is reflowed sheet-wide), so a mouse drag needed 225-400px and mouse/trackpad releases rarely reach the 0.5 px/ms flick — the surface slid and sprang back without prev/next.
  (2) tapBounce's `.tap-bouncing` 0.22s keyframe animates `transform` on the same `.srow` node swipeAction writes its inline translateX to; CSS animations outrank inline styles, so the first 220ms of every row swipe was invisible (a quick flick showed nothing; a drag only started following the finger late) — perceived as "needs a very long drag / sometimes does nothing". The commit maths itself (96px or flick) was sound.
  (3) Product: right-swipe appended to the end of Up Next.
fix: |
  - New pure `src/lib/gestures/swipeCommit.ts`: `swipeCommitDistance(width) = min(0.28×width, 120px)` + `shouldCommitSwipe(dx, v, commitDist)` (far drag OR a flick in the drag direction past slop). coverSwipe and swipeAction both use it (one commit rule, shared SLOP/FLICK constants).
  - tapBounce drops `tap-bouncing` once the pointer travels >8px (a drag is not a tap) so the co-mounted swipe's inline transform is the computed transform from the first dragged frame.
  - New `src/lib/components/like-with-undo.ts` `likeWithUndo(track)`: like via library.toggleLike (never un-likes; already-liked just confirms) + toast.liked with an Undo action (existing toast action slot; existing i18n keys toast.liked/toast.unliked/toast.undo — no new keys). SongRow default right-swipe → likeTrack (resolves stubs via the same path as the Like button), NpRelated → relatedSwipeLike, charts top/tags/countries/shelf swipeQueue → swipeLike. Reveal glyph ListEnd → Heart on search, library (x4), album, NpRelated, 4 charts pages. Left-swipe = play next unchanged.
verification: |
  vitest: new swipeCommit.test.ts (10), coverSwipe cap test (804px wide, 130px slow drag commits), tapBounce drag-cancel test; full suite 5260 passed (1 unrelated timing-budget flake in device-filename.test.ts, passes in isolation). `pnpm check` 0 errors. CDP on the live app in headless Chrome 156 at 1280x813: Nowbar 137px slow mouse drag → next/prev, 80px → spring back; cover strip ±160px → next/prev. Needs Hector's device check: desktop browser of choice (Safari/Firefox not driven here) on Nowbar + cover; phone row swipe feel + Heart reveal + Undo toast.
files_changed: [src/lib/gestures/swipeCommit.ts, src/lib/gestures/swipeCommit.test.ts, src/lib/actions/coverSwipe.ts, src/lib/actions/coverSwipe.test.ts, src/lib/actions/swipeAction.ts, src/lib/actions/tapBounce.ts, src/lib/actions/tapBounce.test.ts, src/lib/components/like-with-undo.ts, src/lib/components/SongRow.svelte, src/lib/components/NpRelated.svelte, "src/routes/(app)/search/+page.svelte", "src/routes/(app)/library/+page.svelte", "src/routes/(app)/album/[name]/+page.svelte", "src/routes/(app)/artist/[name]/+page.svelte", "src/routes/(app)/charts/top/+page.svelte", "src/routes/(app)/charts/tags/[tag]/+page.svelte", "src/routes/(app)/charts/countries/[country]/+page.svelte", "src/routes/(app)/charts/shelf/[kind]/[id]/+page.svelte"]
