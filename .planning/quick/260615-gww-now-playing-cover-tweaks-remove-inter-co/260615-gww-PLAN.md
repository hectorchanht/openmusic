---
phase: quick-260615-gww
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
autonomous: true
requirements: [GWW-01, GWW-02, GWW-03]

must_haves:
  truths:
    - "Adjacent covers touch flush again during a swipe (no inter-cover gutter)"
    - "The title/artist/cover crossfade on track change still runs (unchanged)"
    - "Tapping the cover with the sheet CLOSED toggles play/pause"
    - "Tapping the cover with the sheet HALF-OPEN does nothing (no collapse, no toggle)"
    - "Tapping the cover with the sheet FULL behaves as before (no-op for collapse)"
    - "Sub-slop taps still reach the cover onclick; swipe/drag gestures are undisturbed"
  artifacts:
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "Cover-tap behavior (closed→toggle, half→nothing) + flush neighbor covers"
      contains: "player.toggle()"
  key_links:
    - from: "tapCoverCollapse"
      to: "player.toggle"
      via: "sheetState === 'closed' branch"
      pattern: "player\\.toggle\\(\\)"
    - from: ".cover-cell.prev/.next"
      to: "flush positioning"
      via: "left: -100% / 100% (no calc/var)"
      pattern: "left: (-100%|100%)"
---

<objective>
Three small, mechanical tweaks to the now-playing cover, all in `src/lib/components/NowPlaying.svelte`:

1. Remove the inter-cover positional gap added in 260615-fva (drop `--cover-gap` and revert neighbor cells to flush `-100%` / `100%`). KEEP the 260615-fva title/artist/cover crossfade — only the positional gutter goes.
2. A cover TAP toggles play/pause (`player.toggle()`) when the sheet panel is CLOSED.
3. The existing `tapCoverCollapse` (260615-gcy half→closed-on-tap) must have NO effect at the half-open sheet state — a half-open tap does nothing.

Net cover-tap behavior after this change: sheet CLOSED → toggle play/pause; sheet HALF-OPEN → tap does nothing; sheet FULL → unchanged (no-op).

Purpose: Restore flush cover-to-cover touching during swipes while giving the closed-cover a useful play/pause tap target, and stop the surprising half-open collapse-on-tap.
Output: Edited `src/lib/components/NowPlaying.svelte`.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<!-- Source-of-truth file being edited. Read these exact spans before editing. -->
@src/lib/components/NowPlaying.svelte

<interfaces>
<!-- Exact current code the executor edits. Do NOT explore the codebase — these are the spans. -->

Cover-tap handlers (src/lib/components/NowPlaying.svelte, ~lines 764-783):
```ts
// NP-03 / D-04: a sub-slop TAP on the cover collapses the sheet to `closed` — but ONLY in the
// `half` state (no-op in `closed` and `full`). [...comment...]
function tapCoverCollapse() {
	if (sheetState !== 'half') return;
	sheetDragging = false;
	sheetDragY = 0;
	sheetState = 'closed';
}
// Keyboard parity for the cover's role="button" (Enter/Space) [...]
function tapCoverKey(e: KeyboardEvent) {
	if (e.key !== 'Enter' && e.key !== ' ') return;
	e.preventDefault();
	tapCoverCollapse();
}
```

Cover CSS (src/lib/components/NowPlaying.svelte, ~lines 1229, 1238-1241):
```css
.cover-strip { position: absolute; inset: 0; --cover-gap: 14px; will-change: transform; transition: transform 0.32s cubic-bezier(.22,1,.36,1); }
.cover-cell { position: absolute; top: 0; width: 100%; height: 100%; background-size: cover; background-position: center; }
.cover-cell.prev { left: calc(-100% - var(--cover-gap)); }
.cover-cell.cur { left: 0; }
.cover-cell.next { left: calc(100% + var(--cover-gap)); }
```

player.toggle() is the existing play/pause API (src/lib/stores/player.svelte.ts ~line 1744); already used by the transport `.play` button onclick={() => player.toggle()} in this same file (~line 1041).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Flush covers + closed-toggle / half-noop cover tap</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
Make all edits in `src/lib/components/NowPlaying.svelte` (the only file that may change).

CHANGE 1 — remove the inter-cover positional gap (per GWW-01):
- On the `.cover-strip` rule (~line 1229) delete the `--cover-gap: 14px;` declaration. Leave the rest of that rule (position, inset, will-change, transition) byte-unchanged so the 0.32s commit-settle transition still runs.
- `.cover-cell.prev` (~line 1239): change `left: calc(-100% - var(--cover-gap));` to `left: -100%;`.
- `.cover-cell.next` (~line 1241): change `left: calc(100% + var(--cover-gap));` to `left: 100%;`.
- `.cover-cell.cur` stays `left: 0;`.
- Do NOT touch the `{#key uid}` meta block, the `in:fade`/`out:fade` on `.title`/`.artist`, `xfadeMs`, or the `.cover-cell.cur` `effectiveCover` crossfade — the 260615-fva crossfade is KEPT; ONLY the positional gutter is removed. Optionally tidy the now-stale "gutter" wording in the nearby comments at lines ~361-364, ~972-978, and ~1230-1233 so they no longer describe a `--cover-gap`, but do not change behavior.

CHANGE 2 — closed→toggle, half→nothing cover tap (per GWW-02, GWW-03):
- Rewrite `tapCoverCollapse()` so it dispatches on `sheetState`:
  - `sheetState === 'closed'` → call `player.toggle()` (the same play/pause API the transport `.play` button uses). This is the new GWW-02 behavior.
  - `sheetState === 'half'` → return early, do NOTHING (no collapse, no toggle). This removes the 260615-gcy half→closed behavior per GWW-03.
  - `sheetState === 'full'` → unchanged (no-op; tap does nothing).
  - Net: only the `closed` branch acts (toggle); `half` and `full` are no-ops.
- `tapCoverKey()` already delegates to `tapCoverCollapse()` after the Enter/Space guard — leave that delegation as-is so keyboard parity inherits the new closed→toggle / half→noop behavior automatically. Update the stale NP-03 comment above the functions to describe the new behavior (closed = toggle play/pause; half/full = no-op) instead of "collapse in half".

CONSTRAINTS (do not violate):
- Preserve the sub-slop-tap-reaches-onclick invariant: do NOT add any movement guard, setPointerCapture, or pointerdown logic. The onclick={tapCoverCollapse} / onkeydown={tapCoverKey} / role="button" / tabindex="0" wiring on `.cover` (~lines 963-971) stays unchanged.
- Do NOT touch the swipe/drag gestures: coverSwipe (use:coverSwipe on `.cover-strip`), npTopDown/npTopMove/npTopUp, startGripFromCover, the grip snap machine, or the trailing-click suppressor. Left/right=prev/next, up=expand, down=layered-collapse all stay as-is.
- coverSwipe.ts and its test MUST stay byte-untouched.
- Only `src/lib/components/NowPlaying.svelte` may change.
  </action>
  <verify>
    <automated>npm run check 2>&1 | tail -5 && npx vitest --run src/lib/actions/coverSwipe 2>&1 | tail -15</automated>
  </verify>
  <done>
- `npm run check` reports 0 errors and 0 warnings.
- `npx vitest --run src/lib/actions/coverSwipe` stays green (all coverSwipe tests pass).
- `.cover-strip` no longer declares `--cover-gap`; `.cover-cell.prev` is `left: -100%;` and `.cover-cell.next` is `left: 100%;` (no `calc`/`var`).
- `tapCoverCollapse()` calls `player.toggle()` only when `sheetState === 'closed'` and is a no-op when `sheetState === 'half'` or `'full'`.
- The 260615-fva crossfade markup (`{#key uid}`, `in:fade`/`out:fade`, `xfadeMs`, `effectiveCover`) and all swipe/drag/grip gesture code are unchanged.
- `git diff --stat` shows only `src/lib/components/NowPlaying.svelte` changed.
  </done>
</task>

</tasks>

<verification>
- `npm run check` → 0 errors, 0 warnings.
- `npx vitest --run src/lib/actions/coverSwipe` → green.
- `git diff --name-only` lists only `src/lib/components/NowPlaying.svelte`.
- Manual spot-check of the diff: `--cover-gap` is gone, neighbor cells are flush `-100%`/`100%`, `tapCoverCollapse` branches on `sheetState` (closed→toggle, half→noop), crossfade + gesture code untouched.
</verification>

<success_criteria>
- Adjacent covers touch flush during a swipe; the title/artist/cover crossfade still animates on track change.
- Cover tap: CLOSED → play/pause toggles; HALF-OPEN → nothing happens; FULL → nothing happens.
- Sub-slop tap still reaches onclick; swipe (left/right), up-expand, down-collapse gestures all behave exactly as before.
- coverSwipe.ts + its test untouched; only NowPlaying.svelte changed.
</success_criteria>

<output>
Create `.planning/quick/260615-gww-now-playing-cover-tweaks-remove-inter-co/260615-gww-SUMMARY.md` when done.
</output>
