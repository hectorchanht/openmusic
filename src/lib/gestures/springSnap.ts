import { Spring } from 'svelte/motion';
import { settings } from '$lib/stores/settings.svelte';

// quick-261022-spring — shared Apple-style spring snap-back for gesture releases.
//
// Every finger gesture in the app used to settle with the same CSS
// `transform 0.28s cubic-bezier(.22,1,.36,1)`. That curve is an ease-out: it can never
// overshoot, never carries momentum, and restarts from zero velocity on every release — the
// opposite of the iOS damped-spring feel, where a release wobbles slightly past rest and
// then settles.
//
// This helper drives the settle with a REAL Svelte 5 `Spring` (damped harmonic oscillation —
// the same physics class NowPlaying's cover-scale already uses, and the same integrator the
// legacy svelte/motion spring() store uses) instead of a CSS transition:
//   - underdamped by default (stiffness 0.22 / damping 0.68) → a hint of overshoot, Apple-like
//   - interruptible: a new snap() mid-flight re-seeds from the live value, so a re-grab never jumps
//   - reduce-motion aware: settings.reduceMotion lands instantly (the app's own flag, matching
//     tapBounce — NOT the OS query, per the tapBounce rationale comment)
//
// Contract: the caller keeps `transition:none` while the finger is down AND during the spring
// (the pump writes the inline transform every frame). On settle the helper lands EXACTLY on the
// target and calls onSettled() so the caller can clear its inline styles and restore host CSS.
//
// The pump is OURS, not the Spring's: the Spring's internal rAF loop only advances its reactive
// state (which nothing subscribes to out here), so we copy .current → DOM each frame and stop
// on our own precision check. That keeps the helper usable in plain .ts actions with zero runes.
export interface SpringSnapOpts {
	/** 0..1, default 0.22. Higher = snappier, less overshoot. */
	stiffness?: number;
	/** 0..1, default 0.68. Lower = bouncier. 1 = critically damped (no overshoot at all). */
	damping?: number;
	/** px, default 0.15 — the pump stops once |current − target| ≤ precision. */
	precision?: number;
	/** Fires after the exact-target landing so the caller can clear inline styles. */
	onSettled?: () => void;
}

export interface SpringSnap {
	/** Spring from `from` to `to` (default 0). Interrupts any in-flight snap — no jump. */
	snap(from: number, to?: number): void;
	/** Stop driving frames without settling (a new gesture took over, or destroy). */
	cancel(): void;
	/** True while a spring animation is driving frames. */
	readonly active: boolean;
}

export function createSpringSnap(apply: (v: number) => void, opts: SpringSnapOpts = {}): SpringSnap {
	const precision = opts.precision ?? 0.15;
	const spring = new Spring(0, {
		stiffness: opts.stiffness ?? 0.22,
		damping: opts.damping ?? 0.68,
		precision
	});
	let raf: ReturnType<typeof requestAnimationFrame> = 0;
	let pumping = false;
	let target = 0;

	// Evaluated per snap() (not module scope) so tests can stub rAF after import. In a truly
	// frame-less environment (node/vitest) there IS no animation — settle instantly, exactly
	// like the reduce-motion path.
	const hasRaf = () => typeof requestAnimationFrame === 'function';

	const stop = () => {
		// Guarded: node/vitest has neither rAF nor its cancel (the instant-settle path).
		if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
		pumping = false;
	};

	const pump = () => {
		if (!pumping) return;
		const v = spring.current;
		apply(v);
		if (Math.abs(v - target) <= precision) {
			stop();
			apply(target); // land EXACTLY — the Spring clamps to target_value when settled
			opts.onSettled?.();
			return;
		}
		raf = requestAnimationFrame(pump);
	};

	return {
		get active() {
			return pumping;
		},
		snap(from: number, to = 0) {
			stop();
			target = to;
			if (settings.reduceMotion || from === to || !hasRaf()) {
				apply(to);
				opts.onSettled?.();
				return;
			}
			// Seed the spring AT the release point instantly, then retarget: the spring starts
			// from rest at `from`, so the first frames ease out of the finger's live position
			// with no jump, then overshoot slightly and settle.
			spring.set(from, { instant: true });
			// The returned promise rejects with 'Aborted' when a later snap() supersedes this
			// one; the pump (not the promise) owns completion, so it is never awaited.
			void spring.set(to).catch(() => {});
			pumping = true;
			raf = requestAnimationFrame(pump);
		},
		cancel: stop
	};
}
