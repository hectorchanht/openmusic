// coverStall — the on-screen stall watchdog for CoverArt's <img> (quick-261122-npfix).
//
// ROOT CAUSE it closes (Hector 2026-11-22, "queue covers broken"): kuwo's img2.kuwo.cn CDN answers
// in 1-7 s and leaves roughly 1 request in 8 hanging with NO response at all (measured: curl
// `-m 8` → 000). A hung <img> never fires `load` OR `error`, so CoverArt kept it pending forever:
// the gradient showed under it, the host's `onerror` (dead-marking) never ran, and nothing healed
// it — the hero and the current queue row sat on a gradient while the SAME url's probe had long
// since been declared dead by healCover's 8 s probe. The probe and the paint disagreed.
//
// This makes the paint agree with the probe: once the image is actually being fetched (it is
// near the viewport — a `loading="lazy"` row off-screen has not even started, so its clock must
// not run), a load that has not settled within COVER_STALL_MS is reported as a failure through
// the SAME path as a real `error` event.
//
// One shared IntersectionObserver for every cover (a per-row observer would be N observers on a
// 300-row list). Feature-detected: with no IntersectionObserver (old WebView / SSR) the clock
// starts immediately, which only matters for eager covers anyway.

import { COVER_STALL_MS } from '$lib/services/cover-probe';

export interface CoverStallParams {
	/** The src being watched — a NEW src re-arms the watchdog (row reuse). */
	src: string | null | undefined;
	/** Called once when the load stalls past the budget. */
	onstall: () => void;
	/** Override for tests. */
	timeoutMs?: number;
}

type Arm = () => void;
const arms = new WeakMap<Element, Arm>();
let shared: IntersectionObserver | null = null;

function observer(): IntersectionObserver | null {
	if (typeof IntersectionObserver === 'undefined') return null;
	if (!shared) {
		shared = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					arms.get(e.target)?.();
				}
			},
			// Matches Chrome's lazy-load distance threshold closely enough: the fetch has begun by
			// the time the image is this near the viewport.
			{ rootMargin: '600px' }
		);
	}
	return shared;
}

export function coverStall(node: HTMLImageElement, params: CoverStallParams) {
	let p = params;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let settled = false;

	const clear = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	const onSettle = () => {
		settled = true;
		clear();
		observer()?.unobserve(node);
	};
	const arm: Arm = () => {
		if (settled || timer || !p.src) return;
		// Already decoded from cache before we got here — nothing to watch.
		if (node.complete && node.naturalWidth > 0) return onSettle();
		timer = setTimeout(() => {
			timer = null;
			if (settled) return;
			if (node.complete && node.naturalWidth > 0) return onSettle();
			settled = true;
			observer()?.unobserve(node);
			p.onstall();
		}, p.timeoutMs ?? COVER_STALL_MS);
	};

	function start() {
		settled = false;
		clear();
		if (!p.src) return;
		const io = observer();
		if (io) {
			arms.set(node, arm);
			io.observe(node);
		} else {
			arm();
		}
	}

	node.addEventListener('load', onSettle);
	node.addEventListener('error', onSettle);
	start();

	return {
		update(next: CoverStallParams) {
			const changed = next.src !== p.src;
			p = next;
			if (changed) {
				observer()?.unobserve(node);
				start();
			}
		},
		destroy() {
			clear();
			node.removeEventListener('load', onSettle);
			node.removeEventListener('error', onSettle);
			observer()?.unobserve(node);
			arms.delete(node);
		}
	};
}
