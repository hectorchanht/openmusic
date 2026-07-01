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

export const tapBounce: Action<HTMLElement> = (node) => {
	const down = () => {
		// App reduce-motion flag: do nothing so no scale + no dangling class. (The global
		// `:root[data-reduce-motion] *` rule in app.css ALSO kills the keyframe for defense-in-depth;
		// this just avoids leaving the class on the node when the animation won't run.)
		if (settings.reduceMotion) return;
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
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('animationend', end);
		}
	};
};
