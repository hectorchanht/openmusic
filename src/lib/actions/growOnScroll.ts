import type { Action } from 'svelte/action';

// use:growOnScroll — "auto grow when scrolled to bottom" for long in-memory lists.
//
// The host renders the first page of rows plus an (invisible) sentinel element carrying this
// action at the list end. When the sentinel scrolls near the viewport the action calls `onGrow`
// and the host appends the next page (see src/lib/services/list-grow.ts for the page maths). The
// observer stays armed across grows — the sentinel is still within range after one page is added,
// so it fires again — until the host flips `enabled` to false, which disarms it. Growth is
// render-only: the data is already in memory, so `onGrow` must be a cheap synchronous slice,
// never a fetch.
//
// The action mirrors lazyCover.ts: a classic Action<HTMLElement, Param> closure returning
// { update, destroy }. It is browser-only — IntersectionObserver is feature-detected (SSR /
// ancient webview guard) and the observer disconnects on destroy (T-21-05 DoS).

export interface GrowOnScrollParam {
	/** Called when the sentinel scrolls near the viewport; the host appends the next page. */
	onGrow: () => void;
	/** When false the action observes nothing (nothing left to grow). */
	enabled: boolean;
}

export const growOnScroll: Action<HTMLElement, GrowOnScrollParam> = (node, param) => {
	let current = param;
	let io: IntersectionObserver | null = null;

	const disarm = () => {
		io?.disconnect();
		io = null;
	};

	const arm = () => {
		disarm();
		if (!current.enabled) return;
		if (typeof IntersectionObserver === 'undefined') return;
		io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) current.onGrow();
			},
			// Fire ~one viewport before the sentinel is truly on-screen so the next page is
			// already painted when the user reaches the bottom — the growth feels seamless, and
			// a list shorter than viewport + margin grows itself to full on first paint.
			{ root: null, rootMargin: '800px 0px' }
		);
		io.observe(node);
	};

	arm();

	return {
		update(next: GrowOnScrollParam) {
			// Svelte re-invokes update whenever the param object identity changes (every parent
			// re-render for an inline literal); only re-arm on a REAL change so a grow-triggered
			// render doesn't churn the observer it just fired from.
			if (next.enabled === current.enabled && next.onGrow === current.onGrow) return;
			current = next;
			arm();
		},
		destroy() {
			disarm();
		}
	};
};
