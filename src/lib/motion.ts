// motion — THE reduce-motion decision (quick-261102-u4t, DECISIONS.md §14).
//
// The app flag (settings.reduceMotion → :root[data-reduce-motion]) only stopped CSS transitions and
// animations. Svelte 5 transitions run through WAAPI `element.animate`, which that CSS cannot reach,
// so every `transition:fly` sheet/modal/toast still animated with Reduce motion on; JS smooth scrolls
// and ShelfChevrons (OS query only) bypassed it too. Everything motion-bearing asks this module.
import * as svelteTransition from 'svelte/transition';
import { browser } from '$app/environment';
import { settings } from '$lib/stores/settings.svelte';

/** Reduce motion = the in-app flag OR the OS preference. Read at call time (never cached). */
export function reducedMotion(): boolean {
	if (settings.reduceMotion) return true;
	return browser && typeof window.matchMedia === 'function'
		? window.matchMedia('(prefers-reduced-motion: reduce)').matches
		: false;
}

/** `scrollTo({ behavior })` for a JS-driven scroll — 'auto' (instant) under reduce motion. */
export function scrollBehavior(): ScrollBehavior {
	return reducedMotion() ? 'auto' : 'smooth';
}

/** svelte/transition `fly`, zero-duration under reduce motion. Drop-in for `transition:fly`. */
export const fly: typeof svelteTransition.fly = (node, params) =>
	svelteTransition.fly(node, reducedMotion() ? { ...params, duration: 0 } : params);

/** svelte/transition `fade`, zero-duration under reduce motion. */
export const fade: typeof svelteTransition.fade = (node, params) =>
	svelteTransition.fade(node, reducedMotion() ? { ...params, duration: 0 } : params);
