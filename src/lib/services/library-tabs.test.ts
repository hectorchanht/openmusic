import { describe, it, expect } from 'vitest';
import { LIBRARY_TAB_SET, DEFAULT_LIBRARY_TAB, navActive, type LibraryTab } from './library-tabs';

// quick-260919-oc6 — pure/node tests, same shape as url-tab.test.ts. `navActive` is a total
// function over (URL, href): no DOM, no runes, no $app.
const u = (href: string) => new URL(href);

/** The five rail hrefs, in rail order. */
const TABBED = [
	'/library?tab=liked',
	'/library?tab=playlists',
	'/library?tab=downloads',
	'/library?tab=fav-artists',
	'/library?tab=history'
];

describe('the shared allowlist + default', () => {
	it('lists the five library tabs', () => {
		expect([...LIBRARY_TAB_SET]).toEqual([
			'liked',
			'playlists',
			'downloads',
			'fav-artists',
			'history'
		] satisfies LibraryTab[]);
	});

	it("defaults to 'liked' — the D-5 default tabHref strips from the URL", () => {
		expect(DEFAULT_LIBRARY_TAB).toBe('liked');
	});
});

describe('navActive — tab-less hrefs behave EXACTLY like the old inline expression', () => {
	// These cases pin `page.url.pathname === tab.href || page.url.pathname.startsWith(tab.href + '/')`
	// (+layout.svelte:380 before this task), i.e. the three mobile tabs and Settings are provably
	// unchanged by the rail work.
	it("'/' matches only the root", () => {
		expect(navActive(u('https://x/'), '/')).toBe(true);
		expect(navActive(u('https://x/search'), '/')).toBe(false);
	});

	it('an exact pathname match lights the tab', () => {
		expect(navActive(u('https://x/search'), '/search')).toBe(true);
		expect(navActive(u('https://x/library'), '/search')).toBe(false);
	});

	it('the generic Library entry lights on ANY library tab (mobile behaviour)', () => {
		expect(navActive(u('https://x/library?tab=downloads'), '/library')).toBe(true);
	});

	it('a subpath match is kept, and is not a prefix match', () => {
		expect(navActive(u('https://x/settings/general'), '/settings')).toBe(true);
		expect(navActive(u('https://x/settingsx'), '/settings')).toBe(false);
	});
});

describe('navActive — a tabbed href also compares ?tab= through pickTab', () => {
	it('matches the tab in the URL', () => {
		expect(navActive(u('https://x/library?tab=downloads'), '/library?tab=downloads')).toBe(true);
		expect(navActive(u('https://x/library?tab=downloads'), '/library?tab=liked')).toBe(false);
	});

	it('lights Liked on the canonical tab-less URL (D-5: the default is omitted)', () => {
		expect(navActive(u('https://x/library'), '/library?tab=liked')).toBe(true);
	});

	it('a garbage ?tab= falls back to the default, never lights a bogus entry (T-23-10)', () => {
		expect(navActive(u('https://x/library?tab=nope'), '/library?tab=liked')).toBe(true);
		expect(navActive(u('https://x/library?tab=nope'), '/library?tab=nope')).toBe(false);
	});

	it('ignores other query params', () => {
		expect(
			navActive(u('https://x/library?playlist=abc&tab=playlists'), '/library?tab=playlists')
		).toBe(true);
	});

	it('runs the pathname gate FIRST', () => {
		expect(navActive(u('https://x/search?tab=liked'), '/library?tab=liked')).toBe(false);
	});

	it('lights EXACTLY ONE of the five rail entries for any library URL', () => {
		for (const href of [
			'https://x/library',
			'https://x/library?tab=liked',
			'https://x/library?tab=history',
			'https://x/library?tab=zzz'
		]) {
			const lit = TABBED.filter((t) => navActive(u(href), t));
			expect(lit, href).toHaveLength(1);
		}
	});

	it('never throws on a malformed url-like object', () => {
		const notAUrl = { searchParams: null } as unknown as URL;
		expect(() => navActive(notAUrl, '/library?tab=liked')).not.toThrow();
		expect(navActive(notAUrl, '/library?tab=liked')).toBe(false);
	});
});
