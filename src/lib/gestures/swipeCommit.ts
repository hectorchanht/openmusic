// quick-261104-swipe — the ONE commit rule for every horizontal swipe (coverSwipe, swipeAction).
//
// Pure, DOM-free, so the threshold maths is unit-testable under the node-only vitest project.
//
// WHY A CAP (Hector 2026-11-04, "desktop cover / bar slides but never changes the song"):
// coverSwipe committed at 0.28 × element width with NO upper bound. On a phone that is ~110px —
// a thumb-length. On desktop the Nowbar's .np-open spans rail-to-window (804px at 1280 wide,
// ~1400px on a 1920 monitor → a 400px drag) and the open sheet's cover is reflowed sheet-wide, so
// a mouse drag needed hundreds of px while a mouse / trackpad release almost never carries the
// 0.5 px/ms flick velocity that would otherwise rescue it. The gesture slid and sprang back,
// every time. A commit distance is a hand-size, not a viewport fraction: proportional on small
// surfaces, capped at COMMIT_MAX_PX on wide ones.
export const SWIPE_SLOP = 8; // px before a press becomes a drag (shared by every pointer action)
export const SWIPE_FLICK_V = 0.5; // px/ms — a fast flick commits even when not dragged far
export const SWIPE_COMMIT_FRACTION = 0.28; // D-08 / UI-SPEC §3: distance commit = 28% of width
export const SWIPE_COMMIT_MAX_PX = 120; // the thumb-length ceiling that makes desktop commit

/** Commit distance for a surface `width` px wide: 28% of it, never more than 120px. A missing /
 *  zero width (not laid out, test double) falls back to `fallback`. */
export function swipeCommitDistance(width: number, fallback = 96): number {
	if (!(width > 0)) return fallback;
	return Math.min(SWIPE_COMMIT_FRACTION * width, SWIPE_COMMIT_MAX_PX);
}

/** Should a release at running offset `dx` (px) with release `velocity` (px/ms, same sign
 *  convention as dx) commit? Far drag (|dx| ≥ commitDist) OR a fast flick IN THE DRAG DIRECTION
 *  past slop. A flick back toward rest is the user cancelling, never a commit; a sub-slop tap
 *  never commits regardless of velocity (the tap contract). */
export function shouldCommitSwipe(dx: number, velocity: number, commitDist: number): boolean {
	const far = Math.abs(dx) >= commitDist;
	const flick =
		Math.abs(dx) > SWIPE_SLOP && Math.abs(velocity) > SWIPE_FLICK_V && Math.sign(velocity) === Math.sign(dx);
	return far || flick;
}
