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
//  - INERT on iOS (Safari / WKWebView, incl. the Capacitor iOS shell): iOS rubber-bands
//    NATIVELY — the whole composited page, the fixed nowbar/tabbar included, bands as one
//    piece and springs back together. Layering this JS band on top double-bands: the
//    content takes the native excursion PLUS this transform while the chrome takes only
//    the native one, tearing the page away from the fixed chrome at the boundary
//    (Hector 2026-11-20, iPad: mid-scroll the nowbar "left the ground" and floated
//    mid-screen with page content visible beneath it). This action exists ONLY for UAs
//    with no native band (Android Chrome / WebView show an edge glow instead).
//  - NEVER strands a transform: the inline translateY exists only while a band is held
//    or its spring is settling. springSnap's cancel() deliberately never writes, so a
//    spring cancelled mid-flight (re-grab, scroll-off) would leave its last pumped
//    value inline forever — the content stuck shifted against the fixed chrome, which
//    reads as the chrome floating off the bottom. Every exit path below clears it.
const hasNativeBand = (): boolean => {
	if (typeof navigator === 'undefined') return false;
	// iPadOS with a desktop UA reports platform MacIntel — touch points give it away.
	return (
		/iP(?:ad|hone|od)/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
};

export const rubberOverscroll: Action<HTMLElement> = (node) => {
	if (hasNativeBand()) return {};
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
		// cancel() stops the pump WITHOUT writing, so a spring interrupted mid-flight
		// leaves its last value inline. The new gesture owns the node from rest: clear
		// any stranded offset, or a plain (non-banding) scroll would carry it forever.
		if (node.style.transform) node.style.transform = '';
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
		if (!banding) {
			// No band to settle — but a spring cancelled by the pointerdown that began
			// this gesture may have stranded its last value inline (see down()). With
			// no band running, nothing else ever clears it: the content would stay
			// translated against the fixed nowbar/tabbar indefinitely.
			if (node.style.transform) node.style.transform = '';
			return;
		}
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
