// quick-261116-dtap — the tap-timing gate behind use:doubleTap (Car Mode plan Phase 3).
//
// Pure, DOM-free, clock-injected, so the single-vs-double decision is unit-testable under
// the node-only vitest project (the swipeCommit.ts idiom: the pure rule lives here, the
// Svelte action in actions/doubleTap.ts is a thin timer/listener shell around it).
//
// THE DECISION: a tap is a DOUBLE when the previous tap on the same surface landed within
// DOUBLE_TAP_WINDOW_MS of it. 260ms sits inside the platform range (Android's double-tap
// timeout is 300ms, iOS ~250ms): long enough for an intentional second tap, short enough
// that the deferred single-tap action (Nowbar expand / Now Playing cover tap) still feels
// responsive. The window applies ONLY to taps on the cover element — every other surface
// keeps its zero-delay tap (Q6), so this constant is the entire cost of the gesture.
export const DOUBLE_TAP_WINDOW_MS = 260;

export type TapVerdict = 'pending' | 'double';

/** Classify a tap at `now` against the previous tap's timestamp (`null` = none pending).
 *  A clock that moved backwards (now < lastTapAt) reads as a fresh pending tap, never a
 *  double — a time skew must not manufacture a gesture the user did not make. The window
 *  edge is INCLUSIVE: a second tap exactly windowMs later still counts as a double. */
export function classifyTap(
	lastTapAt: number | null,
	now: number,
	windowMs: number = DOUBLE_TAP_WINDOW_MS
): TapVerdict {
	if (lastTapAt === null) return 'pending';
	const dt = now - lastTapAt;
	return dt >= 0 && dt <= windowMs ? 'double' : 'pending';
}

/**
 * The stateful gate the action drives. `tap(now)` records a tap and returns its verdict:
 * 'pending' means "arm the single-tap timer for windowMs"; when that timer fires the
 * action calls `expire()` and runs the single-tap action. A 'double' verdict consumes the
 * pending tap (the gate clears itself), so a third tap starts a fresh pending cycle —
 * triple-tap = double + pending single, never a second double off one pair.
 */
export function createTapGate(windowMs: number = DOUBLE_TAP_WINDOW_MS) {
	let lastTapAt: number | null = null;
	return {
		tap(now: number): TapVerdict {
			const verdict = classifyTap(lastTapAt, now, windowMs);
			lastTapAt = verdict === 'double' ? null : now;
			return verdict;
		},
		/** The single-tap timer fired: the pending tap is spent. */
		expire(): void {
			lastTapAt = null;
		},
		/** Drop any pending tap without firing it (disable / destroy). */
		reset(): void {
			lastTapAt = null;
		},
		/** True while a first tap is waiting out its window. */
		pending(): boolean {
			return lastTapAt !== null;
		}
	};
}

export type TapGate = ReturnType<typeof createTapGate>;
