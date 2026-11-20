// seekbar — pure geometry + gesture math for the shared SeekBar component
// (quick-261119-seekbar). Hector's progress-bar standard (2026-11-19, STANDING):
// EVERY progress bar shows the buffered range in grey behind the played fill,
// and every bar is draggable/tappable to seek ANYWHERE (never clamped to the
// buffered range). One shared component (SeekBar.svelte) renders everywhere;
// everything testable about it lives here, node-side, per the house split.
//
// The component is glue: pointer events in, player.seekFraction() out. The
// decisions that can be wrong — how TimeRanges become bar geometry, when a
// touch on the Nowbar's thin top strip counts as a seek drag vs a vertical
// scroll, where a tap lands as a fraction — are pure functions, unit-tested
// in seekbar.test.ts.
import type { BufferedRangesLike } from './buffer-gate';

/** One buffered span, seconds. Sorted + merged by readBufferedRanges. */
export interface BufferedRange {
	start: number;
	end: number;
}

/** Minimal structural view of anything carrying a TimeRanges-like buffer. */
export interface BufferedHolder {
	buffered?: BufferedRangesLike | null;
}

/**
 * Snapshot an element's buffered TimeRanges into plain ranges. NEVER throws:
 * a detached element's TimeRanges throw on access (the buffer-gate lesson),
 * and a progress bar must never take playback down with it. Invalid spans
 * (non-finite, end <= start) are dropped; the rest are sorted by start and
 * merged when they overlap or touch (within 50ms — a seek leaves two ranges
 * that kiss, and rendering the seam would flicker a 1px track gap).
 */
export function readBufferedRanges(el: BufferedHolder | null | undefined): BufferedRange[] {
	try {
		const b = el?.buffered;
		if (!b || b.length === 0) return [];
		const raw: BufferedRange[] = [];
		for (let i = 0; i < b.length; i++) {
			const s = b.start(i);
			const e = b.end(i);
			if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
			const start = Math.max(0, s);
			if (e <= start) continue;
			raw.push({ start, end: e });
		}
		raw.sort((a, z) => a.start - z.start);
		const merged: BufferedRange[] = [];
		for (const r of raw) {
			const last = merged[merged.length - 1];
			if (last && r.start <= last.end + 0.05) {
				if (r.end > last.end) last.end = r.end;
			} else {
				merged.push({ ...r });
			}
		}
		return merged;
	} catch {
		return [];
	}
}

/**
 * Buffered ranges → CSS geometry for the bar: one {left%, width%} per range,
 * clamped to the track. Unknown duration (0 / non-finite — metadata not in
 * yet) yields NO segments: an honest empty bar, not a guessed one.
 */
export function rangesToPercents(
	ranges: readonly BufferedRange[],
	duration: number
): { left: number; width: number }[] {
	if (!Number.isFinite(duration) || duration <= 0) return [];
	const out: { left: number; width: number }[] = [];
	for (const r of ranges) {
		const s = Math.min(Math.max(0, r.start), duration);
		const e = Math.min(Math.max(s, r.end), duration);
		if (e <= s) continue;
		out.push({ left: (s / duration) * 100, width: ((e - s) / duration) * 100 });
	}
	return out;
}

/**
 * Pointer x → seek fraction, clamped 0..1. THE seek-fraction math for both
 * SeekBar surfaces (the scrub action has its own copy from plan 002; this is
 * the one the shared component and its tests use). A zero-width rect (bar
 * not laid out yet) reads 0 rather than dividing by zero.
 */
export function fractionFromClientX(
	clientX: number,
	rect: { left: number; width: number }
): number {
	if (!(rect.width > 0)) return 0;
	const f = (clientX - rect.left) / rect.width;
	return f < 0 ? 0 : f > 1 ? 1 : f;
}

export type GestureClaim = 'claim' | 'yield' | 'wait';

/**
 * The Nowbar seek-strip gesture decision (quick-261119-seekbar). The strip
 * lives on the bar's top edge in a 24px-tall invisible hit zone, so a finger
 * landing there might be starting a seek drag OR a vertical page scroll OR
 * just a tap. The strip must not decide on pointerdown:
 *  - 'wait'  — movement so far is under the threshold; keep watching (a
 *              release in this state is a TAP → seek to that point).
 *  - 'claim' — horizontal-dominant movement at/past the threshold: this is
 *              a scrub; capture the pointer and own the gesture.
 *  - 'yield' — vertical-dominant movement at/past the threshold: this is a
 *              scroll intent; abandon the gesture entirely and never seek.
 */
export function decideGestureClaim(dx: number, dy: number, thresholdPx = 8): GestureClaim {
	const adx = Math.abs(dx);
	const ady = Math.abs(dy);
	if (Math.max(adx, ady) < thresholdPx) return 'wait';
	return adx >= ady ? 'claim' : 'yield';
}

/**
 * Material-equality for buffered snapshots, so the player store only writes
 * its $state when the buffer actually moved (epsilon 0.25s: progress events
 * fire in bursts, and re-rendering every bar 4×/sec for sub-frame growth is
 * waste). Range COUNT changes always count as material.
 */
export function sameBufferedRanges(
	a: readonly BufferedRange[],
	b: readonly BufferedRange[],
	epsilon = 0.25
): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (Math.abs(a[i].start - b[i].start) > epsilon) return false;
		if (Math.abs(a[i].end - b[i].end) > epsilon) return false;
	}
	return true;
}
