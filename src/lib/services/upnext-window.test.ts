// quick-261102-twq (DECISIONS.md §10) — invariant: a reorder / prev / playNext never hides the current song.
import { describe, it, expect } from 'vitest';
import { upNextWindowStart } from '$lib/services/upnext-scroll';

const q = (...ids: string[]) => ids.map((uid) => ({ uid }));

describe('Up-Next window — current is always visible', () => {
	it('keeps played songs listed (starts at the anchor while current is after it)', () => {
		expect(upNextWindowStart(q('a', 'b', 'c'), 'c', 'a')).toBe(0);
	});

	it('prev() past the anchor: current before the anchor is still shown', () => {
		// anchor sat on b; prev() made a current — the old slice(anchorIdx) hid a.
		expect(upNextWindowStart(q('a', 'b', 'c'), 'a', 'b')).toBe(0);
	});

	it('playNext moved the anchor row after current: current is still shown', () => {
		expect(upNextWindowStart(q('x', 'cur', 'anchor', 'y'), 'cur', 'anchor')).toBe(1);
	});

	it('anchor gone → current; nothing playing → 0', () => {
		expect(upNextWindowStart(q('a', 'b'), 'b', 'zzz')).toBe(1);
		expect(upNextWindowStart(q('a', 'b'), null, null)).toBe(0);
	});
});
