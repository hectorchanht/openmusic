import type { Action } from 'svelte/action';
import { createSpringSnap } from '$lib/gestures/springSnap';
import { overlays } from '$lib/stores/overlays.svelte';

// quick-261022-spring — iOS-style rubber-band overscroll for the window scroller.
//
// The WINDOW is the scroller on every route (.app/.content are in normal flow — see the
// transport-keys comment in (app)/+layout.svelte). iOS Safari rubber-bands natively; Android
// Chrome and the Capacitor WebView only show the edge glow. This action adds the missing
// stretch-and-release on top of native scroll:
//
// Contract:
//  - TOUCH ONLY (pointerType === 'touch'). Mouse/pen/wheel are never touched.
//  - Engages ONLY at a true scroll boundary: window.scrollY <= 0 while pulling DOWN, or the
//    document bottom while pulling UP. Mid-page the gesture is pure native scroll.
//  - While engaged the node stretches with iOS-style resistance —
//    sign(pull)·MAX_PULL·(1 − e^(−|pull|/MAX_PULL)) (the same asymptote idiom as coverSwipe's
//    boundary rubber-band, D-02) — never 1:1, so it reads as stretch, not movement.
//  - Release → the shared springSnap settles translateY back to 0 (real spring physics).
//  - NEVER preventDefault, NEVER capture: native scroll, Android pull-to-refresh, and tap all
//    keep working untouched. This is purely a visual band on top.
//  - Inert while overlays.depth > 0 (a sheet/menu is open — banding would slide content behind
//    the overlay) and instant-settling under settings.reduceMotion (via the helper).
//  - A scroll event that moves OFF the boundary mid-band (e.g. pull-to-refresh took over)
//    cancels the band instantly instead of fighting the browser.
//  - destroy() removes listeners, cancels the spring, clears the inline transform.
export const rubberOverscroll: Action<HTMLElement> = (node) => {
	const MAX_PULL = 120; // px — the band's visual asymptote (iOS lets pages stretch ~this far)
	const ENGAGE_SLOP = 4; // px of pull before the band visibly engages
	let tracking = false;
	let banding = false;
	let startY = 0;
	let band = 0;

	const snap = createSpringSnap(
		(v) => {
			node.style.transform = v === 0 ? '' : `translateY(${v}px)`;
		},
		{
			onSettled: () => {
				node.style.transform = '';
			}
		}
	);

	const atTop = () => window.scrollY <= 0;
	const atBottom = () =>
		window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;

	function down(e: PointerEvent) {
		if (e.pointerType !== 'touch') return;
		// An overlay open means this content is behind a sheet — never band it.
		if (overlays.depth > 0) return;
		snap.cancel();
		tracking = true;
		banding = false;
		startY = e.clientY;
		band = 0;
	}

	function move(e: PointerEvent) {
		if (!tracking || e.pointerType !== 'touch') return;
		const pull = e.clientY - startY;
		if (!banding) {
			// Engage only when pulling OUTWARD past a true boundary: down at the very top,
			// up at the very bottom. Pulling inward (or mid-page) stays 100% native scroll.
			const outward = (atTop() && pull > ENGAGE_SLOP) || (atBottom() && pull < -ENGAGE_SLOP);
			if (!outward) return;
			banding = true;
		}
		// Damped asymptote — the harder the pull, the less extra stretch (iOS feel).
		band = Math.sign(pull) * MAX_PULL * (1 - Math.exp(-Math.abs(pull) / MAX_PULL));
		node.style.transform = `translateY(${band}px)`;
	}

	function release() {
		if (!tracking) return;
		tracking = false;
		if (!banding) return;
		banding = false;
		// Real spring settle (replaces the old fixed ease-out) — slight overshoot, Apple-like.
		snap.snap(band, 0);
		band = 0;
	}

	// If the browser scrolls off the boundary mid-band (pull-to-refresh engaging, a fling that
	// escaped), drop the band instantly rather than fighting native scroll.
	function onScroll() {
		if (banding && !atTop() && !atBottom()) {
			banding = false;
			tracking = false;
			snap.cancel();
			node.style.transform = '';
			band = 0;
		}
	}

	// Passive: we never preventDefault — the band is visual only, layered over native scroll.
	node.addEventListener('pointerdown', down, { passive: true });
	node.addEventListener('pointermove', move, { passive: true });
	node.addEventListener('pointerup', release, { passive: true });
	node.addEventListener('pointercancel', release, { passive: true });
	window.addEventListener('scroll', onScroll, { passive: true });

	return {
		destroy() {
			node.removeEventListener('pointerdown', down);
			node.removeEventListener('pointermove', move);
			node.removeEventListener('pointerup', release);
			node.removeEventListener('pointercancel', release);
			window.removeEventListener('scroll', onScroll);
			snap.cancel();
			node.style.transform = '';
		}
	};
};
