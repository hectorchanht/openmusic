import { describe, it, expect } from 'vitest';
import { firstShelfId, whatsappShareUrl, DAWN_GATEWAY_URL, OPENMUSIC_REPO_URL } from './free-page';

// quick-261118-free — the pure helpers behind /free and the Home "Free forever" band.

describe('firstShelfId (Home band placement)', () => {
	const order = ['top-hits', 'top-artists', 'liked', 'history'] as const;
	type Id = (typeof order)[number];
	const counts: Record<Id, number> = { 'top-hits': 1, 'top-artists': 1, liked: 1, history: 1 };
	const all = { 'top-hits': 9, 'top-artists': 9, liked: 9, history: 9 };

	it('picks the first visible section that paints a shelf', () => {
		expect(firstShelfId(order, [], (id) => counts[id], all)).toBe('top-hits');
	});

	it('skips hidden sections', () => {
		expect(firstShelfId(order, ['top-hits'], (id) => counts[id], all)).toBe('top-artists');
	});

	it('skips empty sections (no content → nothing painted → band must not sit above the real first shelf)', () => {
		const c = { ...counts, 'top-hits': 0, 'top-artists': 0 };
		expect(firstShelfId(order, [], (id) => c[id], all)).toBe('liked');
	});

	it('skips sections outside the progressive-mount budget', () => {
		expect(firstShelfId(order, [], (id) => counts[id], { 'top-hits': 0, liked: 1 })).toBe('liked');
	});

	it('returns null when nothing renders yet (cold load) — no band at the very top', () => {
		expect(firstShelfId(order, [], () => 0, all)).toBeNull();
		expect(firstShelfId(order, [], (id) => counts[id], {})).toBeNull();
	});
});

describe('whatsappShareUrl', () => {
	it('builds a wa.me share link with the text URL-encoded', () => {
		const url = whatsappShareUrl('OpenMusic — free & no ads https://openmusic.lol');
		expect(url.startsWith('https://wa.me/?text=')).toBe(true);
		expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toBe(
			'OpenMusic — free & no ads https://openmusic.lol'
		);
		expect(url).not.toContain(' ');
		expect(url).not.toContain('&no');
	});
});

describe('constants', () => {
	it('points at the Dawn Studio gateway and the public repo', () => {
		expect(DAWN_GATEWAY_URL).toBe('https://dawnstudio.app/gateway');
		expect(OPENMUSIC_REPO_URL).toBe('https://github.com/hectorchanht/openmusic');
	});
});
