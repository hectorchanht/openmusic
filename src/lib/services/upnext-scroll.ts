// upnext-scroll — the two PURE decisions behind the Up-Next scroll-to-current
// (debug upnext-no-scroll-to-current).
//
// WHY THIS EXISTS: quick-260618-ink made the Up-Next scroll-to-current a ONE-SHOT on sheet open,
// gated on `open = sheetState !== 'closed'` and latched by a boolean — deliberately NOT tracking the
// current song, so that a queue mutation could never re-pin the list (260615-mnr had just removed
// CSS overflow-anchor for exactly that). Three months later quick-260919-np3 mounted the pane as a
// standing column at >=1280px regardless of sheetState, and `open` was never taught about `wide`:
// the column sat fully on screen with `open === false`, so the scroll (and the cover backfill on the
// same gate) never ran until the user dragged the sheet. And because the latch was a boolean keyed
// on nothing, next / prev / auto-advance never re-scrolled in ANY layout.
//
// This module owns the two decisions the NpUpNext effects need, so the component stays a thin
// caller and both are node-testable:
//   - upNextPaneOpen()  — is the pane actually on screen? (wide column OR sheet not closed)
//   - upNextScrollKey() — the latch key: one scroll per (open, current uid), null re-arms.
// Pure `.ts`: no runes, no store import, no DOM — node-Vitest-testable like upnext-covers.ts.

/**
 * Is the Up-Next pane on screen? On the phone it lives inside the sheet, so only while the sheet is
 * half/full; at >=1280px (`wide`, the same quick-260919-np3 flag that mounts it as a column) it is
 * always visible. Feeds BOTH the scroll-to-current effect and the cover-backfill gate in NpUpNext —
 * one shared prop, so the two can never disagree about visibility again.
 */
export function upNextPaneOpen(wide: boolean, sheetState: 'closed' | 'half' | 'full'): boolean {
	return wide || sheetState !== 'closed';
}

/**
 * The scroll latch key. The effect scrolls when this DIFFERS from the last key it scrolled to:
 *   - open flips true            → the current uid → scroll once (the quick-260618-ink open-shot)
 *   - current song changes       → a new uid       → scroll once (next / prev / auto-advance / tap)
 *   - remove / reorder / regen   → SAME uid        → no-op (the 260615-mnr no-scroll-on-mutation)
 *   - pane closes / nothing plays → null           → re-arms, so the next open scrolls again
 * Uniform across the narrow sheet and the wide column by decision (see the debug session).
 */
export function upNextScrollKey(open: boolean, currentUid: string | null | undefined): string | null {
	return open && currentUid ? currentUid : null;
}
