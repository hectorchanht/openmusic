import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// quick-261122-npfix — CoverArt's stall watchdog. No jsdom in this project, so the <img> and the
// IntersectionObserver are minimal fakes; the contract under test is the action's own logic:
//   • a load that never settles reports a stall after the budget (the kuwo hang);
//   • the clock does NOT run until the image is near the viewport (an off-screen lazy row has not
//     started fetching — failing it would mark a healthy url dead);
//   • load / error settle it; a new src re-arms it; destroy cleans up.

type Listener = () => void;
class FakeImg {
	complete = false;
	naturalWidth = 0;
	private l: Record<string, Listener[]> = {};
	addEventListener(t: string, f: Listener) { (this.l[t] ??= []).push(f); }
	removeEventListener(t: string, f: Listener) { this.l[t] = (this.l[t] ?? []).filter((x) => x !== f); }
	fire(t: string) { for (const f of this.l[t] ?? []) f(); }
}

let ioCallback: ((entries: Array<{ isIntersecting: boolean; target: unknown }>) => void) | null = null;
const observed = new Set<unknown>();
class FakeIO {
	constructor(cb: typeof ioCallback) { ioCallback = cb; }
	observe(n: unknown) { observed.add(n); }
	unobserve(n: unknown) { observed.delete(n); }
	disconnect() {}
}
const intersect = (n: unknown) => ioCallback?.([{ isIntersecting: true, target: n }]);

let coverStall: typeof import('./coverStall').coverStall;

beforeEach(async () => {
	vi.useFakeTimers();
	vi.resetModules();
	observed.clear();
	ioCallback = null;
	vi.stubGlobal('IntersectionObserver', FakeIO);
	({ coverStall } = await import('./coverStall'));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const mount = (img: FakeImg, src: string | null, onstall: () => void) =>
	coverStall(img as unknown as HTMLImageElement, { src, onstall, timeoutMs: 8000 });

describe('coverStall (quick-261122-npfix)', () => {
	it('reports a stall when an on-screen load never settles (the kuwo hang)', () => {
		const img = new FakeImg();
		const onstall = vi.fn();
		mount(img, 'https://img2.kuwo.cn/star/albumcover/500/x.jpg', onstall);
		intersect(img);
		vi.advanceTimersByTime(7999);
		expect(onstall).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onstall).toHaveBeenCalledTimes(1);
	});

	it('does NOT start the clock while the image is off-screen (lazy row not yet fetching)', () => {
		const img = new FakeImg();
		const onstall = vi.fn();
		mount(img, 'https://x/a.jpg', onstall);
		vi.advanceTimersByTime(60_000);
		expect(onstall).not.toHaveBeenCalled();
	});

	it('a load before the budget settles it — no stall', () => {
		const img = new FakeImg();
		const onstall = vi.fn();
		mount(img, 'https://x/a.jpg', onstall);
		intersect(img);
		vi.advanceTimersByTime(3000);
		img.complete = true;
		img.naturalWidth = 300;
		img.fire('load');
		vi.advanceTimersByTime(60_000);
		expect(onstall).not.toHaveBeenCalled();
	});

	it('a real error settles the watchdog (CoverArt handles the error itself — no double report)', () => {
		const img = new FakeImg();
		const onstall = vi.fn();
		mount(img, 'https://x/a.jpg', onstall);
		intersect(img);
		img.fire('error');
		vi.advanceTimersByTime(60_000);
		expect(onstall).not.toHaveBeenCalled();
	});

	it('an already-decoded (cached) image is never reported', () => {
		const img = new FakeImg();
		img.complete = true;
		img.naturalWidth = 120;
		const onstall = vi.fn();
		mount(img, 'https://x/a.jpg', onstall);
		intersect(img);
		vi.advanceTimersByTime(60_000);
		expect(onstall).not.toHaveBeenCalled();
	});

	it('a NEW src re-arms the watchdog (row reuse)', () => {
		const img = new FakeImg();
		const onstall = vi.fn();
		const a = mount(img, 'https://x/a.jpg', onstall);
		intersect(img);
		img.complete = true;
		img.naturalWidth = 1;
		img.fire('load');
		img.complete = false;
		img.naturalWidth = 0;
		a.update({ src: 'https://x/b.jpg', onstall, timeoutMs: 8000 });
		intersect(img);
		vi.advanceTimersByTime(8000);
		expect(onstall).toHaveBeenCalledTimes(1);
	});

	it('null src never arms; destroy clears a pending clock', () => {
		const img = new FakeImg();
		const onstall = vi.fn();
		mount(img, null, onstall);
		intersect(img);
		vi.advanceTimersByTime(60_000);
		expect(onstall).not.toHaveBeenCalled();

		const img2 = new FakeImg();
		const h = mount(img2, 'https://x/a.jpg', onstall);
		intersect(img2);
		h.destroy();
		vi.advanceTimersByTime(60_000);
		expect(onstall).not.toHaveBeenCalled();
		expect(observed.has(img2)).toBe(false);
	});

	it('the budget is the SAME constant the heal probe uses', async () => {
		const { COVER_STALL_MS } = await import('$lib/services/cover-probe');
		expect(COVER_STALL_MS).toBe(8000);
		const src = (await import('node:fs')).readFileSync('src/lib/actions/coverStall.ts', 'utf-8');
		expect(src).toMatch(/p\.timeoutMs \?\? COVER_STALL_MS/);
	});

	it('CoverArt routes a stall through its own fail path (fallback + host onerror)', async () => {
		const src = (await import('node:fs')).readFileSync('src/lib/components/CoverArt.svelte', 'utf-8');
		expect(src).toMatch(/class="ca-fit"[^>]*use:coverStall=\{\{ src, onstall: \(\) => fail\(/);
	});
});
