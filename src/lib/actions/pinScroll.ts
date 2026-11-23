// pinScroll — while `locked`, pin the nearest scrolling ancestor of the node (quick-261122-npfix,
// Song Beat scroll lock — see services/songbeat-scroll-lock.ts for the rules).
//
// Pinning = `overflow-y: hidden` + `overscroll-behavior: none` on that scroller, plus a
// non-passive touchmove guard on the node itself (iOS Safari can still rubber-band a pinned
// ancestor from a touch that starts inside it). The scroller's PREVIOUS inline values are saved
// and restored verbatim on unlock / destroy, so nothing leaks into the sheet after the game tab
// unmounts. Never throws; no-op without a scrolling ancestor.

export function findScroller(node: HTMLElement): HTMLElement | null {
	let p = node.parentElement;
	while (p) {
		const oy = getComputedStyle(p).overflowY;
		if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight) return p;
		p = p.parentElement;
	}
	return null;
}

export function pinScroll(node: HTMLElement, locked: boolean) {
	let target: HTMLElement | null = null;
	let saved: { overflowY: string; overscroll: string } | null = null;
	const guard = (e: TouchEvent) => {
		if (e.cancelable) e.preventDefault();
	};

	function pin() {
		if (target) return;
		target = findScroller(node);
		if (!target) return;
		saved = { overflowY: target.style.overflowY, overscroll: target.style.overscrollBehavior };
		target.style.overflowY = 'hidden';
		target.style.overscrollBehavior = 'none';
		node.addEventListener('touchmove', guard, { passive: false });
	}
	function release() {
		if (target && saved) {
			target.style.overflowY = saved.overflowY;
			target.style.overscrollBehavior = saved.overscroll;
		}
		node.removeEventListener('touchmove', guard);
		target = null;
		saved = null;
	}

	if (locked) pin();
	return {
		update(next: boolean) {
			if (next) pin();
			else release();
		},
		destroy: release
	};
}
