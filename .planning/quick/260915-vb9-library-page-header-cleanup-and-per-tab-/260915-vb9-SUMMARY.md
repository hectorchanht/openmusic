---
phase: quick-260915-vb9
plan: 01
subsystem: library-ui
tags: [library, ui, i18n, queue, up-next]
requires: [library.svelte.ts, player.svelte.ts, discovery.shuffle, overlays.svelte.ts]
provides:
  - "library.clearLiked / clearDownloads / clearFavArtists / clearPlaylistTracks"
  - "player.play({ sameList }) — pin the same-list up-next branch for an explicit whole-list play"
  - "Library per-tab action row (Play / Shuffle / Edit / ⋯) + inline list sheet"
affects:
  - "src/routes/(app)/library/+page.svelte"
  - "src/lib/stores/player.svelte.ts"
tech-stack:
  added: []
  patterns:
    - "inline bottom sheet copying the album page's playlist-picker idiom (overlays single-dismiss)"
    - "per-call intent option on play() instead of a new QueueContext token or a settings override"
key-files:
  created: []
  modified:
    - src/lib/stores/library.svelte.ts
    - src/lib/stores/library.svelte.test.ts
    - src/lib/stores/player.svelte.ts
    - src/lib/stores/player.svelte.test.ts
    - "src/routes/(app)/library/+page.svelte"
    - "src/lib/i18n/*.ts (15 dictionaries)"
decisions:
  - "Play/Shuffle pass play({ sameList: true }) — a per-call intent flag, not a new context token"
  - "The playlist folder's own Play button got the same flag, so two Play buttons on one page agree"
  - "Shuffle installs a Fisher-Yates copy; player.shuffle mode is untouched"
metrics:
  duration: ~25m
  completed: 2026-09-15
---

# quick-260915-vb9: Library header cleanup + per-tab action row Summary

The Library page heading is now the active tab's label alone, and every tab carries a
Play / Shuffle / Edit / ⋯ action row whose ⋯ opens an inline per-tab sheet (Add to queue,
Play next, Delete playlist, Clear all) with both destructive rows `confirm()`-gated. Play and
Shuffle leave the tab's songs sitting in Up Next — which required a player fix, see below.

## The amendment: Play/Shuffle must populate Up Next

**What I found (read, then proved with a test — not assumed):**

The `upNextAnchorUid` stale-anchor pitfall (quick-260712-hm9) is **not** the problem on this path.
`setListQueue` re-anchors to the current track (`player.svelte.ts:2485`), and then the following
`play(first, { fresh: true })` re-anchors again to the freshly-played track in `postPlayQueue`
(`upNextAnchorUid = resolved.uid`, after `weaveFreshHistory` has installed the woven queue). So the
anchor is always a uid that is present in the new queue. No anchor reset was needed.

**The actual blocker was the up-next sourcing mode.** `postPlayQueue`'s fresh branch chooses between
`regenerate()` and keeping the installed list based on
`settings.effectiveUpnextMode(this.queueContext)`. `UPNEXT_DEFAULTS.perContext` pins **only** `album`
to `'same-list'`; `liked` / `downloads` / `playlist` / `history` all fall through to the global
default `'generated'`. So `playList()` installed the tab's list, and `regenerate()` then replaced
everything after the seed with genre-similar songs. Tapping Play on Liked would have left Up Next
showing one liked track plus a generated tail — exactly what the amendment forbids.

**What I did:** added an optional `sameList` flag to `player.play()` that pins the same-list branch
(`player.svelte.ts`, three lines plus the rationale comment). It is a per-call flag deliberately, not
a new `QueueContext` token and not a settings override: the *call* carries the intent ("play this
whole list"), while an ordinary row tap on the same surface must keep resolving through the user's
per-context preference (the quick-260831-jtw rationale — a tap means "play this song"). The library
page threads it through `playList(list, seed, { wholeList: true })`, used by the action row's Play
and Shuffle and by each playlist folder's own Play button.

**Verified by:** two new tests in `player.svelte.test.ts` that drive the REAL `play()` (no spy on
`regenerate`) and assert on exactly the expression `NowPlaying.svelte:588-594` renders from,
`queue.slice(indexOf(upNextAnchorUid))`:
- with `sameList`, Up Next is `['Song 0', 'Song 1', 'Song 2']` — the whole installed list;
- the control case without it keeps only the seed and loses the list's other tracks.

The shuffled order survives the install: `dedupeBest` preserves first-seen order, and
`discovery.shuffle` returns a non-mutating Fisher-Yates copy.

**What was NOT verified:** I have no browser-driver tool in this session, so I did not physically tap
Play on the Liked tab and read the Up Next pane. Verification is the two store-level tests above
(real player, real queue, the exact slice the pane uses) plus a dev-server smoke: `/library`
returned 200 and Vite compiled `+page.svelte` with no errors. A device/browser check of the visual
sheet layout and the hardware-Back gesture is still outstanding.

## What Was Built

**Task 1 — store + i18n**
- Four per-list clears on `Library`, each a single `save()`. The naive `removeX` loop re-serialises
  the entire library payload once per row (300 downloads = 300 localStorage writes on a phone).
  `clearDownloads` keeps the delete **per-uid** so `blobStore.del`'s `device:` refusal (Plan 34-01)
  still protects imported files, and empties the `unavailable` marks in the same write.
- 5 RED specs first (committed failing), then the implementation. Assertions include
  `setItem` called exactly once and `blobDel` called once per former uid.
- 3 new keys (`library.clearList`, `library.clearListConfirm`, `library.deletePlaylistConfirm`) in
  all 15 dictionaries, double-quoted, `{name}` token preserved in every translation.

**Task 2 — the page**
- Header is `<h1>{tabLabel}</h1>`; `.tab-sub` CSS and the header's Edit / Clear-history buttons are gone.
- `tabList` derived (empty on fav-artists and on the Playlists tab with no `?playlist` pin),
  `playAll`, `shuffleAll`, `listMenuHasItems`, `clearCurrentList`, `deleteDetailPlaylist`,
  `queueWholeList`, `playListNext`.
- `playEntry` is now a one-line delegate to `playList`, and `playList` grew the `'history'` context,
  so the two paths cannot drift.
- Inline sheet on the `library-list-menu` overlay id (distinct from TrackMenu's `trackmenu-*`, both
  are mounted here), `untrack`-wrapped effect keyed on the open flag only so scrim / X / drag / Back
  converge on one history pop.

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] `play({ sameList })` added to the player**
- **Found during:** Task 2, while verifying the amendment.
- **Issue:** The plan (and the amendment's own hypothesis) assumed the anchor was the risk. The real
  blocker was `regenerate()` discarding the installed list for every non-album context.
- **Fix:** an optional `sameList` flag on `play()`/`postPlayQueue`, plus two tests.
- **Files:** `src/lib/stores/player.svelte.ts`, `src/lib/stores/player.svelte.test.ts`
- **Commit:** b7d6702 (test assertion hardened in 4bff19a, see deviation 4)

**2. [Scope, deliberate] The playlist folder's own Play button also passes `wholeList`**
- Not named in the plan. Left alone it would be the second Play button on the same page behaving
  differently from the action row's Play. One extra argument.

**3. [Dropped] The `@media (max-width: 359px)` icon-only fallback**
- The plan's selector (`.actions .edit-btn > :not(svg)`) cannot match — the button labels are bare
  text nodes, which CSS cannot select, so the rule would have been dead code. Replaced with
  `min-width: 0; overflow: hidden` on the pills, which actually lets a long translated label shrink
  instead of pushing ⋯ off the edge.

**4. [Test hygiene] Control-test assertion relaxed to an absence**
- The control test passed in isolation but failed in the full suite: a prior test leaves
  `buildSimilarQueue` mocked to a "Generated Pick", so the exact tail is order-dependent. Rewritten
  to assert the list's own tracks are gone, which is the order-independent claim.

## Assumption Drift (advisory)

- **Planned:** the amendment's stated risk was a stale `upNextAnchorUid` truncating Up Next.
  **Actual:** the anchor path is already correct on this flow; the truncation came from the
  up-next *sourcing mode* defaulting to `generated`. **Why it matters:** a reader who checks only
  the anchor would conclude the feature works when it does not.

## Verification

- `pnpm check` — 4533 files, **0 errors, 0 warnings**.
- `pnpm test` — **129 files, 2479 tests, all passing.** No pre-existing failures.
- Plan greps: `library-list-menu` ×2, `t('library.heading')` ×0, both `confirm(` guards ×1 each.
- Dev server smoke: `/library` → 200, page module compiles, no errors in the Vite log.
- **Not run:** interactive tap-through of the sheet, the hardware-Back gesture, and the 360px
  layout — no browser driver available in this session.

## Commits

| Hash | Message |
|------|---------|
| a2e4dbf | test(quick-260915-vb9): add failing specs for per-list library clears |
| f42087b | feat(quick-260915-vb9): per-list clear methods on the library store |
| 3675b09 | feat(quick-260915-vb9): i18n keys for the library list menu |
| b7d6702 | feat(quick-260915-vb9): play({ sameList }) keeps an explicitly-played list as Up Next |
| ef6805b | feat(quick-260915-vb9): library heading cleanup + per-tab action row and list menu |
| 4bff19a | test(quick-260915-vb9): assert the control case as an absence, not an exact tail |

**NOT PUSHED.** All commits are local on `main`.

## Known Stubs

None.

## Self-Check: PASSED
