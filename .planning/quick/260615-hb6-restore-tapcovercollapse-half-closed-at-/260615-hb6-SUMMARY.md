---
quick_id: 260615-hb6
slug: restore-tapcovercollapse-half-closed-at-half-open
date: 2026-06-15
status: complete
files_changed: [src/lib/components/NowPlaying.svelte]
---

# Quick 260615-hb6 — Summary

## What changed

`tapCoverCollapse()` in `src/lib/components/NowPlaying.svelte` now restores the half-open
collapse-on-tap that 260615-gww had removed:

```ts
function tapCoverCollapse() {
	if (sheetState === 'closed') player.toggle();
	else if (sheetState === 'half') sheetState = 'closed';
	// `full` is a no-op.
}
```

- `closed` → `player.toggle()` (play/pause) — kept from gww.
- `half` → `sheetState = 'closed'` — RESTORED per user request (reverses the gww half no-op).
- `full` → no-op — unchanged.

`tapCoverKey` (keyboard parity) inherits via delegation. No pointer/capture/movement-guard
changes; the sub-slop-tap-reaches-onclick invariant, the swipe/drag/grip snap machine, and
`coverSwipe.ts` + its test are untouched.

## Verification
- `npm run check` (svelte-check): 0 errors, 0 warnings (4279 files).
- `npx vitest --run src/lib/actions/coverSwipe`: 23/23 green.

## Execution note
One-branch change — done inline by the orchestrator (no subagent spawned) to avoid overhead on a
trivial revert. Standard quick-task guarantees preserved: atomic feature commit, PLAN + SUMMARY,
STATE.md row, docs commit.

## Pending human-verify
Eyeball: at half-open sheet, a tap on the cover collapses it to closed; at closed, a tap toggles
play/pause; at full, a tap does nothing.
