import type { Action } from 'svelte/action';
import { settings } from '$lib/stores/settings.svelte';

// use:tapBounce — one-shot press feedback. On pointerdown the node gets a `tap-bouncing` class
// that runs the shared `@keyframes tap-bounce` (scale down then spring back, defined in app.css),
// removed again on animationend so it can never latch.
//
// WHY A ONE-SHOT KEYFRAME, NOT :active (MENU-03 / D-12): the grid tiles already had a CSS
// `:active { transform: scale(0.96) }` deliberately gated behind `@media (hover: hover)`, because
// on touch a `:active` LATCHES under a held finger while a long-press opens the track menu — the
// tile would stay shrunk. A keyframe animation springs back on its own regardless of whether the
// finger is still down, so it gives the touch affordance without re-introducing the latch.
//
// REDUCED-MOTION (quick-260701-*): this micro press-feedback is gated ONLY by the app's own
// `settings.reduceMotion` flag, NOT the OS `prefers-reduced-motion` query. Rationale: a 0.22s tap
// bounce is functional tactile feedback, not decorative motion, and many Android devices report
// `prefers-reduced-motion: reduce` for non-accessibility reasons (Developer Options animation scale
// off, battery saver) — which silently killed the bounce on-device while desktop worked. Users who
// want it gone flip Settings → Appearance → Reduce Motion, which also drives the global
// `:root[data-reduce-motion] * { animation: none }` rule in app.css (defense-in-depth).
//
// COMPOSABILITY: this action does NOT preventDefault, does NOT stopPropagation, and does NOT touch
// click/longpress — it is purely visual and composes with the existing use:longpress, use:swipeAction
// and onclick handlers already on these buttons.
//
// quick-260919-l9e — `only`, AND WHY A CONTAINER MUST NOT BOUNCE FOR ITS CHILDREN'S TAPS.
// pointerdown BUBBLES, so putting this action on a container scales that container for a press on
// ANY control inside it. A scale MOVES those controls: at the keyframe's 0.94 peak, a control whose
// centre sits `d` px from the container's centre slides `0.06 * d` px inward — ~6px for a row's
// like button, ~9px for its download button, ~12px for its trailing ⋮. The browser hit-tests
// pointerup at the ORIGINAL screen coords, so a press that started on the control can be released
// over the gap beside it; `click` then fires on the nearest COMMON ANCESTOR — the inert container —
// and the tap is silently SWALLOWED. Measured on the search page: the outer ~17% of the like
// button, and the outer ~30% of the ⋮, were dead while the row bounced.
// `only` is the fix: pass a selector for the node's OWN tap target and a press on a sibling control
// leaves the container at rest, so nothing moves under the finger. Omit it and every press bounces,
// which is correct for a leaf control (the 150-odd `<button use:tapBounce>` call sites) — a leaf
// scales about its own centre, where the same maths costs ~1px at the rim.
export interface TapBounceOpts {
	/**
	 * CSS selector for the descendant whose press may bounce this node. A pointerdown whose target
	 * is not inside it is IGNORED. Only a container that also holds other controls needs this; on a
	 * leaf control omit it (the default: any press bounces).
	 */
	only?: string;
}

export const tapBounce: Action<HTMLElement, TapBounceOpts | undefined> = (node, opts) => {
	let only = opts?.only;

	const down = (e: PointerEvent) => {
		// App reduce-motion flag: do nothing so no scale + no dangling class. (The global
		// `:root[data-reduce-motion] *` rule in app.css ALSO kills the keyframe for defense-in-depth;
		// this just avoids leaving the class on the node when the animation won't run.)
		if (settings.reduceMotion) return;
		// The press belongs to a sibling control, not to this node's own tap target → stay at rest
		// so that control cannot slide out from under the finger before its click lands.
		if (only && !(e.target as Element | null)?.closest?.(only)) return;
		// Rapid re-press mid-animation: drop the class + force a reflow so the keyframe restarts.
		if (node.classList.contains('tap-bouncing')) {
			node.classList.remove('tap-bouncing');
			void node.offsetWidth;
		}
		node.classList.add('tap-bouncing');
	};

	const end = (e: AnimationEvent) => {
		// Guard on animationName so an unrelated animation on a descendant (e.g. a marquee) does
		// not clear the bounce class early.
		if (e.animationName === 'tap-bounce') node.classList.remove('tap-bouncing');
	};

	node.addEventListener('pointerdown', down);
	node.addEventListener('animationend', end);

	return {
		update(next: TapBounceOpts | undefined) {
			only = next?.only;
		},
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('animationend', end);
		}
	};
};
