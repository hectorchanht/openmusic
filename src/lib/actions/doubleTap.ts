import type { Action } from 'svelte/action';
import { createTapGate, DOUBLE_TAP_WINDOW_MS } from '$lib/gestures/tapGate';

// use:doubleTap — double-tap on a COVER element fires a random discovery dive
// (quick-261116-dtap, Car Mode plan Phase 3, Q3/Q6). The pure timing rule lives in
// gestures/tapGate.ts; this action is the listener/timer shell.
//
// WHERE IT ATTACHES (the load-bearing choice): the cover element ONLY — Nowbar's `.np-art`
// span and Now Playing's `.cover-cell.cur`. Never the whole bar / cover region, so the
// 260ms single-tap deferral below is paid ONLY by taps that land on the cover itself;
// title/text taps and every button keep their zero-delay behaviour (Q6).
//
// HOW THE DISAMBIGUATION WORKS: the host's tap handler (Nowbar's expand, Now Playing's
// cover tap) lives on an ANCESTOR (the `.np-open` button / the `.cover` div). This action
// listens for `click` in the CAPTURE phase on the cover node and stopPropagation()s every
// click it claims, so the ancestor never sees it. The tap gate then decides:
//   - first tap  → arm a windowMs timer; on expiry run `onsingletap` (the host's action,
//     deferred by at most windowMs, cover taps only);
//   - second tap inside the window → cancel the timer, run `ondoubletap` NOW.
// Keyboard clicks never reach this action: they target the host element itself (the
// button / role=button div), whose event path does not pass through the cover child — so
// keyboard expand/collapse keeps firing instantly on the host's own handler, and the
// gesture stays a bonus, never the only path.
//
// COEXISTENCE:
//   - coverSwipe (on the ancestor): a committed swipe arms its own capture-phase click
//     suppressor on the ANCESTOR, which runs BEFORE this node's capture listener
//     (capture descends), so a post-swipe click never reaches the gate — a swipe can
//     never pair into a double-tap. Sub-slop taps are untouched by coverSwipe and do
//     reach here, exactly as they reached the host's onclick before.
//   - longpress (Nowbar): its trailing-click suppressor is document-level capture —
//     also ahead of this listener — so a long-press's trailing click is eaten before
//     it can count as a tap.
//   - A click whose target is a NESTED interactive element (a button/link/input inside
//     the cover node, should one ever appear) is NOT claimed: it belongs to that
//     control, and the gate ignores it.
//
// FEEDBACK: on a double the action adds `.dtap-pulse` to the cover node (the glow/flip
// keyframes live in app.css next to tap-bounce) and removes it on animationend, with a
// self-expiry fallback mirroring coverSwipe's WR-05 suppressor timer. Haptics + toast
// are the HOST's job (ondoubletap) — this action stays presentation-only about the node
// it owns, like tapBounce.
//
// DESTROY drops a pending single WITHOUT firing it: Nowbar's cover remounts on every
// track change ({#key}), and a deferred expand landing after the remount would be a
// ghost action from a surface that no longer exists.
export interface DoubleTapOpts {
	/** The host's normal cover-tap action (expand / collapse), deferred ≤ windowMs. */
	onsingletap: () => void;
	/** A double-tap landed: fire the random discovery dive. */
	ondoubletap: () => void;
	/** False = the action is inert: clicks pass through to the host untouched. Default true. */
	enabled?: boolean;
	/** Override the double-tap window (tests / tuning). Default DOUBLE_TAP_WINDOW_MS. */
	windowMs?: number;
}

export const doubleTap: Action<HTMLElement, DoubleTapOpts> = (node, opts) => {
	let onsingletap = opts.onsingletap;
	let ondoubletap = opts.ondoubletap;
	let enabled = opts.enabled ?? true;
	const windowMs = opts.windowMs ?? DOUBLE_TAP_WINDOW_MS;
	const gate = createTapGate(windowMs);
	let singleTimer: ReturnType<typeof setTimeout> | null = null;
	let pulseTimer: ReturnType<typeof setTimeout> | null = null;

	function clearSingle() {
		if (singleTimer !== null) {
			clearTimeout(singleTimer);
			singleTimer = null;
		}
	}

	function endPulse() {
		node.classList.remove('dtap-pulse');
		if (pulseTimer !== null) {
			clearTimeout(pulseTimer);
			pulseTimer = null;
		}
	}

	function pulse() {
		endPulse(); // a re-dive restarts the pulse cleanly
		node.classList.add('dtap-pulse');
		// animationend is the normal removal; the timer is the WR-05-style fallback for a
		// node whose animation never runs (display:none mid-pulse, reduced-motion gates).
		pulseTimer = setTimeout(endPulse, 900);
	}

	function onAnimationEnd(e: AnimationEvent) {
		if (e.animationName.startsWith('dtap-')) endPulse();
	}

	// A click on a nested control belongs to the control, not the cover (see header). The
	// closest() match must be CONTAINED in this node: Now Playing's cover cell sits inside
	// a role="button" ancestor (.cover), and that ancestor must not disqualify every click.
	function isNestedInteractive(e: MouseEvent): boolean {
		const target = e.target as HTMLElement | null;
		if (!target || target === node) return false;
		const hit = target.closest('button, a, input, select, textarea, [role="button"]');
		return !!hit && hit !== node && node.contains(hit);
	}

	function onClick(e: MouseEvent) {
		if (!enabled) return;
		if (isNestedInteractive(e)) return;
		// Claim the click: the ancestor's tap handler must not also fire. The gate's
		// verdict decides whether the host action runs (deferred) or the dive fires (now).
		e.stopPropagation();
		if (gate.tap(e.timeStamp) === 'double') {
			clearSingle();
			pulse();
			ondoubletap();
			return;
		}
		clearSingle();
		singleTimer = setTimeout(() => {
			singleTimer = null;
			gate.expire();
			onsingletap();
		}, windowMs);
	}

	node.addEventListener('click', onClick, true);
	node.addEventListener('animationend', onAnimationEnd);

	return {
		update(next: DoubleTapOpts) {
			onsingletap = next.onsingletap;
			ondoubletap = next.ondoubletap;
			const wasEnabled = enabled;
			enabled = next.enabled ?? true;
			// Disabling mid-window drops the pending single: the host is resolving /
			// unmounting, and a deferred action landing afterwards would be a ghost.
			if (wasEnabled && !enabled) {
				clearSingle();
				gate.reset();
			}
		},
		destroy() {
			node.removeEventListener('click', onClick, true);
			node.removeEventListener('animationend', onAnimationEnd);
			clearSingle();
			gate.reset();
			endPulse();
		}
	};
};
