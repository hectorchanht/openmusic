// upnext-scroll.test.ts (debug upnext-no-scroll-to-current) — node tests for the two PURE
// decisions behind the Up-Next scroll-to-current. Sibling of upnext-covers.test.ts: no DOM, no
// store, no rAF — the component stays a thin caller so the timing-free part is locked here.
import { describe, it, expect } from 'vitest';
import { upNextPaneOpen, upNextScrollKey } from '$lib/services/upnext-scroll';

describe('upNextPaneOpen', () => {
	it('narrow: the pane lives inside the sheet, so it is open only while the sheet is not closed', () => {
		expect(upNextPaneOpen(false, 'closed')).toBe(false);
		expect(upNextPaneOpen(false, 'half')).toBe(true);
		expect(upNextPaneOpen(false, 'full')).toBe(true);
	});

	it('wide (>=1280px): the pane is a standing column, on screen even with the sheet closed', () => {
		// THE BUG: NowPlaying passed `sheetState !== 'closed'`, which is false at the default sheet
		// state, so the wide column never scrolled to (or filled covers for) the current song.
		expect(upNextPaneOpen(true, 'closed')).toBe(true);
		expect(upNextPaneOpen(true, 'half')).toBe(true);
		expect(upNextPaneOpen(true, 'full')).toBe(true);
	});
});

describe('upNextScrollKey', () => {
	it('holds still while the pane is not open or nothing is playing', () => {
		expect(upNextScrollKey(false, 'netease:1')).toBeNull();
		expect(upNextScrollKey(true, null)).toBeNull();
		expect(upNextScrollKey(true, undefined)).toBeNull();
	});

	it('yields the current uid while open, so opening the pane scrolls once', () => {
		expect(upNextScrollKey(true, 'netease:1')).toBe('netease:1');
	});

	it('changes when the current song changes — next / prev / auto-advance / row tap re-scroll', () => {
		expect(upNextScrollKey(true, 'netease:2')).not.toBe(upNextScrollKey(true, 'netease:1'));
	});

	it('is stable across a queue mutation that keeps the same current song (quick-260615-mnr: no continuous scroll)', () => {
		// remove / reorder / regenerate change the rows but not the current uid → same key → no scroll.
		expect(upNextScrollKey(true, 'netease:1')).toBe(upNextScrollKey(true, 'netease:1'));
	});

	it('re-arms on close: closing yields null, so the next open scrolls again', () => {
		expect(upNextScrollKey(false, 'netease:1')).toBeNull();
		expect(upNextScrollKey(true, 'netease:1')).toBe('netease:1');
	});
});
