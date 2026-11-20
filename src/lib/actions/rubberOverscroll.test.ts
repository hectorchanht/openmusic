import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rubberOverscroll } from './rubberOverscroll';
import { settings } from '$lib/stores/settings.svelte';

// rubberOverscroll is the JS rubber-band layered over the WINDOW scroller (quick-261022-spring):
// it writes `transform: translateY(...)` onto <main class="content"> at a scroll boundary and
// springs it back on release. The docked nowbar + tabbar are `position: fixed` siblings, so the
// band must NEVER tear the content away from that chrome. These tests pin the two contracts
// Hector's 2026-11-20 iPad report ("mid-scroll the nowbar left the ground, floating mid-screen
// with content beneath it") violated:
//
//   1. NO STRANDED TRANSFORM. springSnap's cancel() stops the pump WITHOUT writing, so a
//      spring cancelled mid-flight (a re-grab) used to leave its last pumped value inline
//      forever — a plain non-banding scroll afterwards never cleared it, and the content
//      stayed shifted against the fixed chrome indefinitely. Every gesture exit (re-grab,
//      release-without-band) must leave the node at rest.
//   2. INERT ON iOS. iOS Safari / WKWebView rubber-bands natively — page and fixed chrome
//      band as one piece. The JS band on top double-bands (content takes native + JS
//      excursion, chrome takes native only) and tears the two apart at the boundary.
//      The action exists only for UAs with no native band (Android Chrome / WebView).
//
// Headless style follows coverSwipe.test.ts: a fake node with a listener registry + a
// recording style object, synthetic pointer records, and stubbed window/document/navigator
// globals (the action reads scrollY / innerHeight / scrollHeight off them at event time).

type Handler = (e: PointerEvent) => void;

/** A synthetic touch PointerEvent — only the fields the action reads. */
function pe(clientY: number, pointerType = 'touch') {
	return { clientY, pointerType } as unknown as PointerEvent;
}

function makeNode() {
	const handlers = new Map<string, Handler>();
	const style: Record<string, string> = {};
	const node = {
		style,
		addEventListener(type: string, cb: Handler) {
			handlers.set(type, cb);
		},
		removeEventListener(type: string) {
			handlers.delete(type);
		}
	};
	return {
		node: node as unknown as HTMLElement,
		style,
		has: (type: string) => handlers.has(type),
		fire(type: string, e: PointerEvent) {
			handlers.get(type)?.(e);
		}
	};
}

/** A stub window: mutable scroll metrics + a listener registry for the scroll handler. */
function makeWindow() {
	const handlers = new Map<string, () => void>();
	return {
		scrollY: 0,
		innerHeight: 1000,
		addEventListener(type: string, cb: () => void) {
			handlers.set(type, cb);
		},
		removeEventListener(type: string) {
			handlers.delete(type);
		},
		has: (type: string) => handlers.has(type)
	};
}

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15';

let win: ReturnType<typeof makeWindow>;

function stubEnv(ua: string, platform = '', maxTouchPoints = 1) {
	win = makeWindow();
	vi.stubGlobal('window', win);
	vi.stubGlobal('document', { documentElement: { scrollHeight: 5000 } });
	vi.stubGlobal('navigator', { userAgent: ua, platform, maxTouchPoints });
}

function mount() {
	const h = makeNode();
	const action = rubberOverscroll(h.node);
	return { ...h, action };
}

/** Pull down at the very top until the band engages; returns the applied offset in px. */
function bandAtTop(h: ReturnType<typeof mount>, pull = 100) {
	win.scrollY = 0;
	h.fire('pointerdown', pe(200));
	h.fire('pointermove', pe(200 + pull));
	const m = /translateY\((-?[\d.]+)px\)/.exec(h.style.transform ?? '');
	return m ? parseFloat(m[1]) : NaN;
}

describe('rubberOverscroll', () => {
	beforeEach(() => {
		settings.reduceMotion = false;
	});

	afterEach(() => {
		settings.reduceMotion = false;
		vi.unstubAllGlobals();
		delete (globalThis as Record<string, unknown>).requestAnimationFrame;
		delete (globalThis as Record<string, unknown>).cancelAnimationFrame;
	});

	it('bands at the top boundary with damped (never 1:1) resistance', () => {
		stubEnv(ANDROID_UA);
		const h = mount();
		const v = bandAtTop(h, 100);
		expect(v).toBeGreaterThan(0);
		expect(v).toBeLessThan(100); // the asymptote damps the pull
		expect(h.style.transform).toContain('translateY(');
	});

	it('bands at the bottom boundary when pulling up', () => {
		stubEnv(ANDROID_UA);
		const h = mount();
		win.scrollY = 4000; // 4000 + 1000 >= 5000 - 1 → atBottom
		h.fire('pointerdown', pe(600));
		h.fire('pointermove', pe(500));
		const m = /translateY\((-?[\d.]+)px\)/.exec(h.style.transform ?? '');
		expect(m).not.toBeNull();
		expect(parseFloat(m![1])).toBeLessThan(0);
	});

	it('never engages mid-page', () => {
		stubEnv(ANDROID_UA);
		const h = mount();
		win.scrollY = 2000; // neither boundary
		h.fire('pointerdown', pe(200));
		h.fire('pointermove', pe(400));
		h.fire('pointermove', pe(0));
		expect(h.style.transform ?? '').toBe('');
	});

	it('release settles the band back to rest (frame-less env: instant settle clears)', () => {
		stubEnv(ANDROID_UA);
		const h = mount();
		bandAtTop(h);
		h.fire('pointerup', pe(300));
		expect(h.style.transform).toBe('');
	});

	it('a re-grab mid-spring clears the stranded transform instead of carrying it into the next scroll', () => {
		stubEnv(ANDROID_UA);
		// Capture-but-never-run rAF: the spring stays mid-flight after release, its last
		// pumped value still inline — the exact state a fast re-grab interrupts on device.
		vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		const h = mount();
		bandAtTop(h);
		h.fire('pointerup', pe(300)); // spring starts settling, never lands
		expect(h.style.transform).toContain('translateY('); // still offset mid-flight
		h.fire('pointerdown', pe(500)); // re-grab: the new gesture owns the node from rest
		expect(h.style.transform).toBe('');
		// …and a plain mid-page scroll + release afterwards must not resurrect anything.
		win.scrollY = 2000;
		h.fire('pointermove', pe(400));
		h.fire('pointerup', pe(400));
		expect(h.style.transform).toBe('');
	});

	it('is inert on iOS Safari (native band) — no listeners, no transform', () => {
		stubEnv(IPHONE_UA, 'iPhone', 5);
		const h = mount();
		expect(h.has('pointerdown')).toBe(false);
		h.fire('pointerdown', pe(200));
		h.fire('pointermove', pe(400));
		expect(h.style.transform ?? '').toBe('');
	});

	it('is inert on iPadOS with a desktop UA (MacIntel platform + touch points)', () => {
		stubEnv(IPAD_DESKTOP_UA, 'MacIntel', 5);
		const h = mount();
		expect(h.has('pointerdown')).toBe(false);
	});

	it('stays active on desktop-class UA without touch points (MacIntel, 0 touch points)', () => {
		stubEnv(IPAD_DESKTOP_UA, 'MacIntel', 0);
		const h = mount();
		expect(h.has('pointerdown')).toBe(true);
	});
});
