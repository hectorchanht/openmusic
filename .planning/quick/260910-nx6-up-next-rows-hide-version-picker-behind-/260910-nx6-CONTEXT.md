# Quick Task 260910-nx6: Up Next directional swipe reveal - Context

**Gathered:** 2026-09-10
**Status:** Ready for planning

<domain>
## Task Boundary

The NowPlaying "Up Next" tab list (`tab === 'queue'`) in `src/lib/components/NowPlaying.svelte`.
Follow-on to quick-260910-k45, which fixed the same bleed class on the sibling "Related" list.

</domain>

<decisions>
## Implementation Decisions

### Resting state
- The always-visible `.ver` version-picker button (Layers icon, left of every row) is HIDDEN at rest.
- The `.grip-handle` (GripVertical, right of every row) STAYS VISIBLE at rest. User chose this
  explicitly over hiding it — drag-to-reorder must keep a grabbable handle.

### Swipe semantics — split by direction
- Replaces the current `use:swipeRemove` (which removed on a swipe in EITHER direction).
- Swipe LEFT  -> reveals remove; commits removal on release.
- Swipe RIGHT -> reveals the version picker; commits opening it on release.
- Mirrors the Related list's `use:swipeAction` pattern (`onSwipeLeft` / `onSwipeRight`).

### Currently-playing row
- `swipeRemove` was gated `enabled: track.uid !== player.current?.uid` — the playing track
  cannot be removed. Preserve that: swipe-LEFT on the current row must be a no-op.
- Swipe-RIGHT (version picker) stays available on the current row.

### Bleed fix (folded in)
- The row must carry an opaque background so the reveal layers behind it stay masked at rest and
  the grip does not show through the title mid-swipe — the quick-260910-k45 root cause, confirmed
  live on Up Next before this task (grip dots rendered through the title text at translateX(80px)).

### Claude's Discretion
- Exact reveal icons for each side, the reveal spans' markup/CSS, and whether the removal keeps a
  fade. Note `swipeAction` deliberately drops `swipeRemove`'s opacity fade.

</decisions>

<specifics>
## Specific Ideas

The Related list at NowPlaying.svelte ~line 1531 is the reference implementation: a
`<li class="swipe-wrap related-swipe">` holding two absolutely-positioned `.reveal` spans behind an
opaque `.row`, driven by `use:swipeAction={{ onSwipeRight, onSwipeLeft }}`.

</specifics>

<canonical_refs>
## Canonical References

- `src/lib/actions/swipeAction.ts` — the generalized action (no opacity fade).
- `src/lib/actions/swipeRemove.ts` — the action being replaced on this list.
- `src/routes/(app)/search/+page.svelte` — the original opaque-row + reveal pattern.

</canonical_refs>
