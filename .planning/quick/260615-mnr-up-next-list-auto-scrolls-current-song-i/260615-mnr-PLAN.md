---
phase: quick-260615-mnr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
autonomous: false
requirements: [QUICK-260615-mnr]
must_haves:
  truths:
    - "User can scroll the Up Next queue freely and it STAYS where they scrolled it"
    - "The currently-playing row is NOT yanked back into view when the queue mutates (track advance, remove, reorder, retry)"
    - "Tap-to-play still plays the tapped track"
    - "Swipe-to-remove, long-press menu, and grip drag-reorder still work"
    - "The .skipped ✗ retry row still retries on tap"
    - "Lyrics auto-scroll is unchanged"
  artifacts:
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Queue scroll container that does not re-anchor to the playing row"
      contains: "overflow-anchor"
  key_links:
    - from: ".panel (queue scroller)"
      to: "browser scroll-anchoring"
      via: "overflow-anchor: none"
      pattern: "overflow-anchor:\\s*none"
---

<objective>
Fix the Up Next queue auto-scroll bug: the currently-playing row keeps getting yanked back into view, so the user cannot freely scroll the queue to see upcoming tracks.

Purpose: Restore free scrolling of the Up Next list while playback continues.
Output: A single CSS change (plus optional focus hardening) in NowPlaying.svelte, confirmed by reasoning about the real scroll mechanism first.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/lib/components/NowPlaying.svelte

<diagnosis>
A pre-flight grep of `src/` confirms what is NOT happening:
- NO `scrollIntoView`, NO `scroll-snap`, NO `scroll-margin`, NO `.scrollTo` targeting the QUEUE list.
- The only programmatic scroll is the LYRICS `$effect` (~lines 189-224), scoped to `lyricsEl.closest('.panel')` and gated on `tab !== 'lyrics'`. It NEVER touches the queue. Leave it alone.

Relevant markup/CSS (current line numbers, may shift):
- Scroll container: `.panel { flex: 1; overflow-y: auto; overscroll-behavior-y: contain; }` (~line 1352). It has NO `overflow-anchor` declaration, so it inherits the browser default `overflow-anchor: auto`.
- Queue list: `<ul class="list" bind:this={queueListEl}>` (~line 1092) with a KEYED each: `{#each player.queue as track, i (track.uid)}` (~line 1093).
- Each row: `<button class="row q-row" class:playing={track.uid === player.current?.uid} class:skipped ...>` (~line 1104). It is a focusable `<button>`. `.row.playing` gets a distinct background (`rgba(124,92,255,0.15)`, ~line 1358).
- The same `.panel` class is reused for the lyrics and related tabs; the queue tab is the `{#if tab === 'queue'}` branch.

Most-likely root cause (CSS scroll-anchoring): `.panel` defaults to `overflow-anchor: auto`. On every queue mutation — track advance moving the played song to history, `removeFromQueue`, `retryUnplayable`, reorder — the keyed `{#each}` adds/removes/reorders rows ABOVE the viewport, changing layout height above the fold. The browser's scroll-anchoring then re-pins the scroll position to an anchor node; the visually-distinct, freshly re-rendered `.playing` row is the natural anchor, so it gets dragged back into view. This re-asserts "constantly" precisely because it fires on every queue change, with no user interaction required.

Secondary contributor (focus): tapping a `.row` focuses the `<button>`; a focused element can be scrolled into view by the browser on subsequent re-render/relayout. The longpress path already calls `(e.currentTarget).blur()` before opening the menu, so the menu path is covered, but a plain tap-to-play leaves focus on the playing row.
</diagnosis>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Confirm the scroll mechanism, then disable scroll-anchoring on the queue scroller</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
FIRST confirm the mechanism by reasoning about THIS exact markup (do not assume blindly):
1. Re-read the `.panel` rule and verify it has no `overflow-anchor` declaration (so it is `auto`, the value that re-pins scroll to an anchor when content above the fold changes height).
2. Re-read the queue each-block and confirm it is keyed by `track.uid` and that the played track leaving the queue / `removeFromQueue` / `retryUnplayable` / reorder all mutate rows that can sit ABOVE the current scroll position.
3. Confirm the distinct `.row.playing` background makes the playing row the natural scroll-anchor candidate.
4. Confirm NO code path explicitly scrolls or focuses the queue on its own (only the gated lyrics $effect scrolls, and it cannot run while `tab === 'queue'`).

If, and only if, that reasoning holds (scroll-anchoring is the constant yanker), apply the MINIMAL fix:
- Add `overflow-anchor: none;` to the `.panel` rule (the shared scroll container, ~line 1352). This disables scroll-anchoring for all three tabs. The lyrics tab does its own explicit `container.scrollTo(...)` so it is unaffected; the related tab does not auto-scroll. Document WHY inline: a one-line comment that scroll-anchoring was re-pinning the `.playing` queue row into view on every queue mutation, and that the lyrics auto-scroll is explicit/manual so it does not rely on anchoring.

Defensive focus hardening (apply ONLY if the tap path leaves focus on the playing row and you can verify it cheaply): in the queue row's `onclick` play branch, blur the tapped button after play so a re-render does not later scroll the focused playing row into view — mirror the existing longpress `(e.currentTarget).blur()` idiom (`(e.currentTarget as HTMLElement)?.blur()`). Do NOT add `el.focus({ preventScroll: true })` anywhere new — there is no existing explicit focus call to harden, so adding focus calls would be net-new behavior. Keep this change tiny and only if it does not interfere with swipe/longpress/drag.

Do NOT touch: the lyrics auto-scroll `$effect`, `swipeRemove`, `longpress`/`openMenu`, the grip drag handlers (`gripDragDown/Move/Up`), the `.skipped` retry branch, or the keyed `(track.uid)` each.
  </action>
  <verify>
    <automated>grep -n "overflow-anchor:\s*none" src/lib/components/NowPlaying.svelte</automated>
    <automated>npm run check</automated>
  </verify>
  <done>`.panel` declares `overflow-anchor: none` with an inline comment explaining the re-anchoring cause; `npm run check` passes; lyrics/swipe/longpress/grip/skipped-retry code is untouched.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>Disabled CSS scroll-anchoring on the Now Playing `.panel` scroller so the Up Next queue no longer yanks the playing row back into view.</what-built>
  <how-to-verify>
1. `npm run dev` and open the app on a phone-sized viewport (or device).
2. Queue up several tracks so the Up Next list overflows the panel and is scrollable.
3. Start playback, then scroll the Up Next queue DOWN past the currently-playing row. Let a track finish (or skip) so the queue advances.
   - EXPECT: the list stays where you scrolled it; the playing row is NOT dragged back into view.
4. Tap a track in the queue to play it — EXPECT: it plays.
5. Swipe a non-playing row to remove it — EXPECT: removal still works.
6. Long-press a row — EXPECT: the track menu opens.
7. Drag the grip handle to reorder — EXPECT: reorder still works.
8. If a `.skipped` ✗ row is present, tap it — EXPECT: it retries.
9. Switch to the Lyrics tab during playback — EXPECT: lyrics still auto-scroll/center the active line as before.
  </how-to-verify>
  <resume-signal>Type "approved" or describe what still misbehaves (which gesture / which tab).</resume-signal>
</task>

</tasks>

<verification>
- Queue scrolls freely and holds position across track advance / remove / reorder / retry.
- `overflow-anchor: none` present on `.panel`; `npm run check` clean.
- All four queue gestures (tap, swipe-remove, long-press, grip-reorder) and the skipped-retry row still function.
- Lyrics auto-scroll unchanged.
</verification>

<success_criteria>
User can scroll the Up Next queue to inspect upcoming tracks and it stays put while a song is playing, with no regression to tap-to-play, swipe-to-remove, long-press menu, drag-reorder, skipped-retry, or lyrics auto-scroll.
</success_criteria>

<output>
Create `.planning/quick/260615-mnr-up-next-list-auto-scrolls-current-song-i/260615-mnr-SUMMARY.md` when done.
</output>
