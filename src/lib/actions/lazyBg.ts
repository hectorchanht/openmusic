import type { Action } from 'svelte/action';

// use:lazyBg — defer a tile's background-image URL until the tile scrolls near view
// (quick-261103-hdn). Covers painted as CSS backgrounds cannot use `loading="lazy"`, so a
// horizontal shelf downloaded every cover on page load, including the ones far off to the side.
//
// The tile paints `fallback` (the seeded gradient) at once, and swaps to `image` (the
// url-over-gradient stack) the first time it comes within `rootMargin` of its scroll container.
// Once shown it stays shown: no unload on scroll-out, and an update shows the new value straight
// away.
//
// The observer root is the nearest horizontally scrolling ancestor (the shelf), because tiles
// off to the side are CLIPPED by that container and never intersect the viewport. The trade-off
// is that a shelf below the fold loads its first few tiles even before the page is scrolled to
// it; that's acceptable because the shelves sit near the top.
// ponytail: scroll-parent root only; nest a viewport observer if shelves ever sit far below the fold.
//
// Browser-only: IntersectionObserver is feature-detected (SSR / old WebView), and without it
// the image is shown immediately. The observer disconnects on first reveal and on destroy.

export interface LazyBgParam {
	/** The full background-image value to show once near view. */
	image: string;
	/** Painted until then; also the final value when there is no image. */
	fallback: string;
}

function scrollParent(node: HTMLElement): HTMLElement | null {
	for (let el = node.parentElement; el; el = el.parentElement) {
		const ox = getComputedStyle(el).overflowX;
		if (ox === 'auto' || ox === 'scroll') return el;
	}
	return null;
}

export const lazyBg: Action<HTMLElement, LazyBgParam> = (node, param) => {
	let current = param;
	let shown = false;
	let io: IntersectionObserver | null = null;

	const paint = () => {
		node.style.backgroundImage = shown ? current.image : current.fallback;
	};
	const reveal = () => {
		shown = true;
		io?.disconnect();
		io = null;
		paint();
	};

	if (current.image === current.fallback || typeof IntersectionObserver === 'undefined') {
		reveal();
	} else {
		paint();
		io = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) reveal();
		}, { root: scrollParent(node), rootMargin: '0px 260px' });
		io.observe(node);
	}

	return {
		update(next: LazyBgParam) {
			current = next;
			paint();
		},
		destroy() {
			io?.disconnect();
			io = null;
		}
	};
};
