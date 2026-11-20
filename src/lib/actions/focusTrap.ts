import type { Action } from 'svelte/action';

// use:focusTrap — a hand-rolled focus-trap Svelte action for sheets / menus / overlays (Phase 23,
// UX-06 §7.3). Consistent with the project's hand-rolled action posture (longpress, swipeRemove,
// dragClose) — no new dependency.
//
// Contract (§7.3):
//  - On MOUNT: capture document.activeElement as the return target, then focus the first focusable
//    element inside the node (or the node itself, made programmatically focusable, if none exists).
//  - Tab / Shift+Tab CYCLE focus within the node's focusable set (wrap last→first and first→last).
//  - Escape is NOT handled here — dismissal stays with the host overlay (the Phase 19 overlay
//    `$effect` history invariant). This action manages FOCUS ONLY; it NEVER touches open/close
//    state.
//  - On DESTROY: remove the keydown listener and restore focus to the captured return target.
//
// T-23-04 (focus DoS): focus is never permanently lost — destroy() always restores the prior
// activeElement, and if the node has no focusable child we focus the container itself so Tab still
// has a home. Pure of any store/state.

// The canonical focusable-element selector. `[tabindex]:not([tabindex="-1"])` includes
// author-focusable elements while excluding the programmatic-only `-1` (e.g. the container
// fallback below), so the container never enters the Tab cycle as a stop.
const FOCUSABLE_SELECTOR =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(node: HTMLElement): HTMLElement[] {
	return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export const focusTrap: Action<HTMLElement> = (node) => {
	// Capture the element to return focus to on destroy (the trigger that opened the overlay).
	const returnTarget = document.activeElement as HTMLElement | null;

	// Focus the first focusable child; fall back to the container itself (made programmatically
	// focusable) so focus is never stranded outside the trap (T-23-04).
	const initial = focusableWithin(node);
	if (initial.length > 0) {
		initial[0].focus();
	} else {
		if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
		node.focus();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return; // focus-only: Escape/dismissal is the host overlay's concern
		// WR-07: traps can NEST (e.g. TrackMenu mounted inside the trapped NowPlaying). Stop the
		// Tab from bubbling to an outer trap so only the INNERMOST mounted trap arbitrates —
		// otherwise the outer trap could cycle focus through the scrimmed background controls.
		e.stopPropagation();
		const focusable = focusableWithin(node);
		if (focusable.length === 0) {
			// Nothing focusable inside — keep focus on the container, never let Tab escape the trap.
			e.preventDefault();
			node.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;
		if (e.shiftKey) {
			// Shift+Tab from the first element (or from outside the set) wraps to the last.
			if (active === first || !focusable.includes(active as HTMLElement)) {
				e.preventDefault();
				last.focus();
			}
		} else {
			// Tab from the last element (or from outside the set) wraps to the first.
			if (active === last || !focusable.includes(active as HTMLElement)) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	node.addEventListener('keydown', onKeydown);

	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			// Restore focus to whatever was focused before the trap mounted (T-23-04). Guard against
			// a target detached from the DOM while the overlay was open.
			if (returnTarget && typeof returnTarget.focus === 'function' && returnTarget.isConnected) {
				returnTarget.focus();
			}
		}
	};
};

export default focusTrap;
