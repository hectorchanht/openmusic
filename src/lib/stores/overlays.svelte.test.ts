import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// debug page-switch-lag-tap-dead: the invariant every outbound goto() from inside an overlay
// relies on. `dismiss()` pops a history entry (history.back()), and SvelteKit's popstate handler
// invalidates any in-flight navigation token — so a caller that closes its overlay FIRST and then
// goto()s (the old NowPlaying.openArtistName, the old TrackMenu.gotoArtist) navigates nowhere.
// `navigateAway()` is the sanctioned path: the thunk runs while the stack is still populated, the
// close() handlers sweep AFTERWARDS, and a host dismiss during the flight must NOT call back().
//
// Test idiom mirrors cover-version.svelte.test.ts: vi.resetModules() + `await import()` per test so
// the singleton stack starts fresh, and vi.stubGlobal installs `window`/`history` BEFORE the dynamic
// import so the module's `HAS_WINDOW` guard sees them and open() actually records `pushed: true`.

const back = vi.fn();
const pushState = vi.fn();
const replaceState = vi.fn();

beforeEach(() => {
	vi.resetModules();
	back.mockClear();
	pushState.mockClear();
	replaceState.mockClear();
	vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
	// quick-261010-npurl: sameOriginHref() resolves against location at call time.
	vi.stubGlobal('location', { href: 'https://openmusic.lol/', origin: 'https://openmusic.lol' });
	// quick-261114-bak: the popstate handler reconciles against `history.state` (the
	// landed entry's gsdSeq), so the stub carries a mutable state tests set per landing.
	vi.stubGlobal('history', { back, pushState, replaceState, state: null as unknown });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('overlays: outbound navigation vs history.back()', () => {
	it('dismiss() outside navigateAway pops exactly one history entry (the goto-canceller)', async () => {
		const { overlays } = await import('./overlays.svelte');
		const close = vi.fn();
		overlays.open('nowplaying', close);
		expect(pushState).toHaveBeenCalledTimes(1);
		(history as { state: unknown }).state = { gsdOverlay: 'nowplaying', gsdSeq: 1 };

		overlays.dismiss('nowplaying');
		expect(back).toHaveBeenCalledTimes(1);
		expect(close).not.toHaveBeenCalled(); // UI-driven dismiss: the host already closed itself
		expect(overlays.depth).toBe(0);
	});

	it('navigateAway() runs goto with the overlay still open, then closes it with back() suppressed', async () => {
		const { overlays } = await import('./overlays.svelte');
		const close = vi.fn();
		overlays.open('nowplaying', close);

		let depthDuringGoto = -1;
		await overlays.navigateAway(async () => {
			depthDuringGoto = overlays.depth;
			// The destination route mounting unmounts a host → its $effect cleanup dismisses.
			overlays.dismiss('nowplaying');
		});

		expect(depthDuringGoto).toBe(1); // goto saw the raw Back entry as the live one
		expect(back).not.toHaveBeenCalled(); // the just-pushed destination is never popped off
		expect(overlays.depth).toBe(0);
	});

	it('navigateAway() sweeps every still-open overlay top-down after the goto settles', async () => {
		const { overlays } = await import('./overlays.svelte');
		const order: string[] = [];
		overlays.open('nowplaying', () => order.push('nowplaying'));
		overlays.open('trackmenu-menu', () => order.push('trackmenu-menu'));

		await overlays.navigateAway(async () => {
			order.push('goto');
		});

		expect(order).toEqual(['goto', 'trackmenu-menu', 'nowplaying']);
		expect(back).not.toHaveBeenCalled();
	});

	it('two synchronous dismisses (picker pick → closePicker() + close menu) never close nowplaying, however the echoes land (quick-261019-ovl, seq model quick-261114-bak)', async () => {
		const { overlays } = await import('./overlays.svelte');
		const closeNp = vi.fn();
		const teardown = overlays.init();
		const onpop = vi
			.mocked(window.addEventListener)
			.mock.calls.find((c) => (c[0] as string) === 'popstate')![1] as () => void;
		const land = (seq: number | null) => {
			(history as { state: unknown }).state = seq === null ? null : { gsdSeq: seq };
			onpop();
		};

		overlays.open('nowplaying', closeNp); // gsdSeq 1
		overlays.open('trackmenu-menu', () => {}); // gsdSeq 2
		overlays.open('trackmenu-cover', () => {}); // gsdSeq 3
		expect(overlays.depth).toBe(3);
		(history as { state: unknown }).state = { gsdSeq: 3 }; // current entry = the picker's

		// TrackMenu.pickCover(): closeCoverPicker() flips coverOpen, then close() flips
		// menuOpen — both $effect cleanups dismiss in the SAME tick, so two history.back()
		// calls are issued back-to-back.
		overlays.dismiss('trackmenu-cover');
		overlays.dismiss('trackmenu-menu');
		expect(back).toHaveBeenCalledTimes(2);
		expect(overlays.depth).toBe(1);

		// Android Chrome/WebView case (the 2026-11-14 device repro): the two same-tick
		// backs COALESCE into one traversal that lands straight on the nowplaying entry
		// — ONE popstate for two backs. The old pendingPops counter leaked here and
		// swallowed the next genuine Back, leaving Now Playing stuck open.
		land(1);
		expect(closeNp).not.toHaveBeenCalled();
		expect(overlays.depth).toBe(1);

		// A genuine OS/browser Back afterwards still closes Now Playing — exactly once,
		// and closeTop issues no history.back() of its own (the overshoot direction:
		// one gesture must never also pop the page underneath).
		back.mockClear();
		land(null);
		expect(closeNp).toHaveBeenCalledTimes(1);
		expect(overlays.depth).toBe(0);
		expect(back).not.toHaveBeenCalled();
		teardown();
	});

	it('split echoes (one popstate per back) also leave nowplaying standing (quick-261114-bak)', async () => {
		const { overlays } = await import('./overlays.svelte');
		const closeNp = vi.fn();
		const teardown = overlays.init();
		const onpop = vi
			.mocked(window.addEventListener)
			.mock.calls.find((c) => (c[0] as string) === 'popstate')![1] as () => void;
		const land = (seq: number | null) => {
			(history as { state: unknown }).state = seq === null ? null : { gsdSeq: seq };
			onpop();
		};

		overlays.open('nowplaying', closeNp); // 1
		overlays.open('trackmenu-menu', () => {}); // 2
		overlays.open('trackmenu-cover', () => {}); // 3
		(history as { state: unknown }).state = { gsdSeq: 3 };
		overlays.dismiss('trackmenu-cover');
		overlays.dismiss('trackmenu-menu');

		land(2); // first echo lands on the (already stack-removed) menu entry
		expect(closeNp).not.toHaveBeenCalled();
		land(1); // second echo lands on nowplaying's own entry
		expect(closeNp).not.toHaveBeenCalled();
		expect(overlays.depth).toBe(1);
		land(null); // genuine Back
		expect(closeNp).toHaveBeenCalledTimes(1);
		expect(overlays.depth).toBe(0);
		teardown();
	});

	it('a stale stack entry above the landed history entry is closed by the same popstate (quick-261114-bak)', async () => {
		const { overlays } = await import('./overlays.svelte');
		const closeNp = vi.fn();
		const closeMenu = vi.fn();
		const teardown = overlays.init();
		const onpop = vi
			.mocked(window.addEventListener)
			.mock.calls.find((c) => (c[0] as string) === 'popstate')![1] as () => void;

		overlays.open('nowplaying', closeNp); // 1
		overlays.open('trackmenu-menu', closeMenu); // 2
		// The menu's history entry gets popped by a traversal whose dismiss never ran
		// (desync): the landing is nowplaying's entry, so the menu entry is above it.
		(history as { state: unknown }).state = { gsdSeq: 1 };
		onpop();
		expect(closeMenu).toHaveBeenCalledTimes(1);
		expect(closeNp).not.toHaveBeenCalled();
		expect(overlays.depth).toBe(1);
		teardown();
	});
});

describe('overlays: dismiss guard (quick-261115-bak2)', () => {
	it('dismiss() after the browser already traversed past the entry does NOT pop the page underneath', async () => {
		const { overlays } = await import('./overlays.svelte');
		const close = vi.fn();
		overlays.open('nowplaying', close, 'https://openmusic.lol/song/a/b'); // gsdSeq 1
		// The Back gesture landed on the SvelteKit page entry (no gsdSeq) and the
		// entry was already removed by the popstate reconcile; a late cleanup
		// dismiss must not eat the page entry with a second back().
		(history as { state: unknown }).state = { 'sveltekit:history': 1 };
		overlays.dismiss('nowplaying');
		expect(back).not.toHaveBeenCalled();
		expect(overlays.depth).toBe(0);
	});
});

describe('overlays: display URL on the pushed entry (quick-261010-npurl)', () => {
	const SONG = 'https://openmusic.lol/song/lee-jun/meng-ban';
	const SONG2 = 'https://openmusic.lol/song/jay-chou/qing-hua-ci';

	it('open(id, close, url) pushes the entry with the given same-origin URL', async () => {
		const { overlays } = await import('./overlays.svelte');
		overlays.open('nowplaying', () => {}, SONG);
		expect(pushState).toHaveBeenCalledTimes(1);
		expect(pushState).toHaveBeenCalledWith({ gsdOverlay: 'nowplaying', gsdSeq: 1 }, '', SONG);
		expect(overlays.depth).toBe(1);
	});

	it('open() with a cross-origin URL falls back to the same-URL dummy entry', async () => {
		const { overlays } = await import('./overlays.svelte');
		overlays.open('nowplaying', () => {}, 'https://evil.example/song/a/b');
		expect(pushState).toHaveBeenCalledTimes(1);
		expect(pushState).toHaveBeenCalledWith({ gsdOverlay: 'nowplaying', gsdSeq: 1 }, '', undefined);
		expect(overlays.depth).toBe(1);
	});

	it('open() without a URL keeps the old dummy-entry behavior', async () => {
		const { overlays } = await import('./overlays.svelte');
		overlays.open('trackmenu-menu', () => {});
		expect(pushState).toHaveBeenCalledWith({ gsdOverlay: 'trackmenu-menu', gsdSeq: 1 }, '', undefined);
	});

	it('replaceUrl() repoints the top entry without touching history depth', async () => {
		const { overlays } = await import('./overlays.svelte');
		overlays.open('nowplaying', () => {}, SONG);
		overlays.replaceUrl('nowplaying', SONG2);
		expect(replaceState).toHaveBeenCalledTimes(1);
		expect(replaceState).toHaveBeenCalledWith({ gsdOverlay: 'nowplaying', gsdSeq: 1 }, '', SONG2);
		expect(pushState).toHaveBeenCalledTimes(1); // no extra push — depth still 1
		expect(overlays.depth).toBe(1);
	});

	it('replaceUrl() no-ops when the id is not the top entry', async () => {
		const { overlays } = await import('./overlays.svelte');
		overlays.open('nowplaying', () => {}, SONG);
		overlays.open('trackmenu-menu', () => {});
		overlays.replaceUrl('nowplaying', SONG2); // buried under the menu — must not rewrite
		expect(replaceState).not.toHaveBeenCalled();
	});

	it('replaceUrl() no-ops on an empty stack and on cross-origin URLs', async () => {
		const { overlays } = await import('./overlays.svelte');
		overlays.replaceUrl('nowplaying', SONG);
		expect(replaceState).not.toHaveBeenCalled();
		overlays.open('nowplaying', () => {}, SONG);
		overlays.replaceUrl('nowplaying', 'https://evil.example/x');
		expect(replaceState).not.toHaveBeenCalled();
	});

	it('dismiss() after a URL-carrying open still pops exactly one history entry', async () => {
		const { overlays } = await import('./overlays.svelte');
		const close = vi.fn();
		overlays.open('nowplaying', close, SONG);
		(history as { state: unknown }).state = { gsdOverlay: 'nowplaying', gsdSeq: 1 };
		overlays.dismiss('nowplaying');
		expect(back).toHaveBeenCalledTimes(1);
		expect(close).not.toHaveBeenCalled();
		expect(overlays.depth).toBe(0);
	});
});
