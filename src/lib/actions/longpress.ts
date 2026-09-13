import type { Action } from 'svelte/action';

// use:longpress — fires an `onlongpress` CustomEvent after a hold (~450ms).
// Cancels on >8px move or pointer up/leave. Suppresses the native context menu.
//
// THE TRAILING-CLICK GUARD (quick-260606-tmh — the load-bearing bit): after the hold fires the
// `longpress` event, the OS still emits a trailing native `click` once the finger lifts. At every
// call site the element's `onclick` plays the track (home tile / search row → setQueue+play). So
// without a guard a long-press opens the TrackMenu AND starts playback — it looks like the menu
// "didn't open." We mirror dragScroll's FIX-B idiom: arm a one-shot CAPTURE-PHASE click
// suppressor the instant the longpress timer fires, so the following click is
// preventDefault()+stopPropagation()'d BEFORE it reaches the element's bubble-phase onclick, then
// disarmed. A normal short tap never fires the timer → never arms it → tap-to-play is preserved.
//
// SAFETY DISARM: some mobile browsers emit NO synthetic click after a long hold, so we also
// schedule a ~700ms self-disarm — the armed flag is only ever live for the brief window a trailing
// click could arrive, and a later independent tap is never swallowed. We deliberately do NOT
// disarm on pointerup: the trailing click arrives AFTER pointerup, so that would defeat the fix.
//
// WHERE THE SUPPRESSOR LISTENS (quick-260913-p2k — the half quick-260606-tmh missed): the guard
// used to be bound to `node`, which only ever caught a trailing click that landed back on the ROW.
// But every `onlongpress` handler mounts the TrackMenu SYNCHRONOUSLY, so by the time the finger
// lifts the sheet is already under it — the trailing click lands on a MENU button, a different
// subtree the row's listener never sees. Harmless while that slot was Like; once it became
// Download (quick-260913-je8) a long-press started a download on its own. So the suppressor now
// listens on `document` in the capture phase, where it sees the trailing click wherever it lands.
// It is attached ONLY while armed (and detached by the eat, the self-disarm, or destroy), so a
// long list registers no steady-state document listeners — there is at most one, for ~700ms.

/**
 * Pure helper: should the trailing native click be suppressed because a longpress just fired?
 * Returns `fired` directly — true (a longpress dispatched → eat the click so play doesn't also
 * fire) vs false (a short tap → let the onclick through). Exported so the decision is unit-testable
 * under the node-only vitest project, mirroring dragScroll's `shouldSuppressClick`.
 */
export function shouldSuppressClickAfterLongpress(fired: boolean): boolean {
	return fired;
}

export const longpress: Action<HTMLElement, number | undefined, { onlongpress: (e: CustomEvent) => void }> = (
	node,
	duration = 450
) => {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let disarmTimer: ReturnType<typeof setTimeout> | null = null;
	// ONE flag, two meanings kept deliberately in sync: `armed` is true exactly while the
	// document-level capture listener is attached, and that attachment IS the "eat the next click"
	// state. Collapsing the old separate `suppressNextClick` boolean into it removes the only way
	// the two could disagree (flag set, listener detached — a silently dead guard).
	let armed = false;
	let sx = 0;
	let sy = 0;
	// Attach/detach the document-level suppressor. Idempotent on both sides: `armed` mirrors
	// whether the listener is currently attached, so a re-press or a destroy mid-window cannot
	// leave a stray capture listener on document.
	const armSuppressor = () => {
		if (armed) return;
		armed = true;
		document.addEventListener('click', clickCapture, true);
	};
	const disarmSuppressor = () => {
		if (!armed) return;
		armed = false;
		document.removeEventListener('click', clickCapture, true);
	};
	const clear = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		// Cancel a pending safety-disarm too (e.g. on destroy / a fresh press), but do NOT disarm
		// the suppressor here — the trailing click arrives after pointerup, so the click handler
		// and the disarm timeout are the only places allowed to reset it.
		if (disarmTimer) {
			clearTimeout(disarmTimer);
			disarmTimer = null;
		}
	};
	const down = (e: PointerEvent) => {
		sx = e.clientX;
		sy = e.clientY;
		clear();
		timer = setTimeout(() => {
			timer = null;
			node.dispatchEvent(new CustomEvent('longpress'));
			// Arm the one-shot click suppressor for the trailing native click this hold will produce.
			if (shouldSuppressClickAfterLongpress(true)) armSuppressor();
			// Self-disarm: some mobile browsers emit no synthetic click after a long hold, so never
			// leave the guard armed long enough to eat a later legitimate tap.
			disarmTimer = setTimeout(() => {
				disarmSuppressor();
				disarmTimer = null;
			}, 700);
		}, duration ?? 450);
	};
	const move = (e: PointerEvent) => {
		if (timer && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) clear();
	};
	// CAPTURE phase on `document` so we intercept before ANY element's bubble-phase onclick —
	// the row's own (which plays) AND the just-mounted menu's (which downloads) or the scrim's
	// (which would close the sheet the hold just opened).
	const clickCapture = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		disarmSuppressor(); // one-shot
	};
	const ctx = (e: Event) => e.preventDefault();
	node.addEventListener('pointerdown', down);
	node.addEventListener('pointermove', move);
	node.addEventListener('pointerup', clear);
	node.addEventListener('pointerleave', clear);
	node.addEventListener('pointercancel', clear);
	node.addEventListener('contextmenu', ctx);
	return {
		destroy() {
			clear();
			disarmSuppressor(); // never leave a capture listener on document behind an unmounted row
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', clear);
			node.removeEventListener('pointerleave', clear);
			node.removeEventListener('pointercancel', clear);
			node.removeEventListener('contextmenu', ctx);
		}
	};
};
