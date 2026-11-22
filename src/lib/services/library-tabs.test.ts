import { describe, it, expect } from 'vitest';
import {
	LIBRARY_TAB_SET,
	LIBRARY_TAB_ORDER,
	DEFAULT_LIBRARY_TAB,
	navActive,
	navRetapAction,
	nextLibraryTab,
	shouldInterceptNavClick,
	type LibraryTab,
	type NavClickLike
} from './library-tabs';

// quick-260919-oc6 — pure/node tests, same shape as url-tab.test.ts. `navActive` is a total
// function over (URL, href): no DOM, no runes, no $app.
const u = (href: string) => new URL(href);

/** The seven rail hrefs, in rail order (quick-260927-2cy added radio; quick-261122-books added books, last). */
const TABBED = [
	'/library?tab=liked',
	'/library?tab=playlists',
	'/library?tab=downloads',
	'/library?tab=fav-artists',
	'/library?tab=history',
	'/library?tab=radio',
	'/library?tab=books'
];

describe('the shared allowlist + default', () => {
	it('lists the seven library tabs', () => {
		expect([...LIBRARY_TAB_SET]).toEqual([
			'liked',
			'playlists',
			'downloads',
			'fav-artists',
			'history',
			'radio',
			'books'
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
		expect(navActive(u('https://x/settings/appearance'), '/settings')).toBe(true);
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

	it('lights radio only on ?tab=radio, and History not there (quick-260927-2cy)', () => {
		expect(navActive(u('https://x/library?tab=radio'), '/library?tab=radio')).toBe(true);
		expect(navActive(u('https://x/library?tab=radio'), '/library?tab=history')).toBe(false);
	});

	it('lights books only on ?tab=books, never Radio or History (quick-261122-books)', () => {
		expect(navActive(u('https://x/library?tab=books'), '/library?tab=books')).toBe(true);
		expect(navActive(u('https://x/library?tab=books'), '/library?tab=radio')).toBe(false);
		expect(navActive(u('https://x/library?tab=books'), '/library?tab=history')).toBe(false);
		// the mobile tab-less Library entry still lights on it
		expect(navActive(u('https://x/library?tab=books'), '/library')).toBe(true);
	});

	it('a garbage ?tab= never lights books (falls back to Liked)', () => {
		expect(navActive(u('https://x/library?tab=book'), '/library?tab=books')).toBe(false);
		expect(navActive(u('https://x/library?tab=book'), '/library?tab=liked')).toBe(true);
	});

	it('lights EXACTLY ONE of the seven rail entries for any library URL', () => {
		for (const href of [
			'https://x/library',
			'https://x/library?tab=liked',
			'https://x/library?tab=history',
			'https://x/library?tab=radio',
			'https://x/library?tab=books',
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

describe('shouldInterceptNavClick (quick-260920-m0l)', () => {
	const plain = (over: Partial<NavClickLike> = {}): NavClickLike => ({
		defaultPrevented: false,
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...over
	});

	it('intercepts a plain left click while an overlay is open', () => {
		expect(shouldInterceptNavClick(plain(), 1)).toBe(true);
		expect(shouldInterceptNavClick(plain(), 3)).toBe(true);
	});

	it('does NOT intercept when no overlay is open — the plain anchor navigates', () => {
		expect(shouldInterceptNavClick(plain(), 0)).toBe(false);
	});

	it('does NOT intercept modified clicks — open-in-new-tab belongs to the browser', () => {
		for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
			expect(shouldInterceptNavClick(plain({ [k]: true }), 1)).toBe(false);
		}
	});

	it('does NOT intercept middle / right clicks', () => {
		expect(shouldInterceptNavClick(plain({ button: 1 }), 1)).toBe(false);
		expect(shouldInterceptNavClick(plain({ button: 2 }), 1)).toBe(false);
	});

	it('does NOT intercept an already-handled click', () => {
		expect(shouldInterceptNavClick(plain({ defaultPrevented: true }), 1)).toBe(false);
	});
});

describe('LIBRARY_TAB_ORDER + nextLibraryTab (quick-261116-libcycle)', () => {
	it('is the displayed order and carries exactly the allowlist', () => {
		expect(LIBRARY_TAB_ORDER).toEqual([
			'liked',
			'playlists',
			'downloads',
			'fav-artists',
			'history',
			'radio',
			'books'
		] satisfies LibraryTab[]);
		expect(new Set(LIBRARY_TAB_ORDER)).toEqual(LIBRARY_TAB_SET);
	});

	it('advances one step in displayed order', () => {
		expect(nextLibraryTab('liked')).toBe('playlists');
		expect(nextLibraryTab('playlists')).toBe('downloads');
		expect(nextLibraryTab('downloads')).toBe('fav-artists');
		expect(nextLibraryTab('fav-artists')).toBe('history');
		expect(nextLibraryTab('history')).toBe('radio');
		expect(nextLibraryTab('radio')).toBe('books');
	});

	it('wraps from the last tab (books) back to the first', () => {
		expect(nextLibraryTab('books')).toBe('liked');
	});

	it('a full cycle of seven steps returns to the start', () => {
		let t: LibraryTab = 'downloads';
		for (let i = 0; i < 7; i++) t = nextLibraryTab(t);
		expect(t).toBe('downloads');
	});
});

describe('navRetapAction (quick-261116-srchfocus / quick-261116-libcycle)', () => {
	const plain = (over: Partial<NavClickLike> = {}): NavClickLike => ({
		defaultPrevented: false,
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...over
	});

	it('a Search re-tap on /search focuses the field', () => {
		expect(navRetapAction(plain(), u('https://x/search'), '/search', 0)).toBe('search');
		expect(navRetapAction(plain(), u('https://x/search?q=ab'), '/search', 0)).toBe('search');
	});

	it('a Library re-tap on /library cycles — on the canonical URL and on any tab', () => {
		expect(navRetapAction(plain(), u('https://x/library'), '/library', 0)).toBe('library');
		expect(navRetapAction(plain(), u('https://x/library?tab=downloads'), '/library', 0)).toBe(
			'library'
		);
		expect(navRetapAction(plain(), u('https://x/library?tab=radio'), '/library', 0)).toBe('library');
	});

	it('tapping a DIFFERENT page is ordinary navigation, never a re-tap', () => {
		expect(navRetapAction(plain(), u('https://x/'), '/search', 0)).toBeNull();
		expect(navRetapAction(plain(), u('https://x/search'), '/library', 0)).toBeNull();
		expect(navRetapAction(plain(), u('https://x/library'), '/search', 0)).toBeNull();
		expect(navRetapAction(plain(), u('https://x/search'), '/', 0)).toBeNull();
	});

	it('a Home re-tap has no re-tap behaviour', () => {
		expect(navRetapAction(plain(), u('https://x/'), '/', 0)).toBeNull();
	});

	it('the desktop rail’s ?tab= entries are destinations, never a cycle', () => {
		for (const href of TABBED) {
			expect(navRetapAction(plain(), u('https://x/library?tab=liked'), href, 0)).toBeNull();
		}
	});

	it('modified / non-primary / already-handled clicks belong to the browser', () => {
		for (const k of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
			expect(navRetapAction(plain({ [k]: true }), u('https://x/search'), '/search', 0)).toBeNull();
		}
		expect(navRetapAction(plain({ button: 1 }), u('https://x/search'), '/search', 0)).toBeNull();
		expect(
			navRetapAction(plain({ defaultPrevented: true }), u('https://x/search'), '/search', 0)
		).toBeNull();
	});

	it('while an overlay is open the navigateAway path owns the tap — no re-tap', () => {
		expect(navRetapAction(plain(), u('https://x/search'), '/search', 1)).toBeNull();
		expect(navRetapAction(plain(), u('https://x/library'), '/library', 2)).toBeNull();
	});

	it('never throws on a malformed url-like object', () => {
		const notAUrl = { pathname: '/search' } as unknown as URL;
		expect(() => navRetapAction(plain(), notAUrl, '/search', 0)).not.toThrow();
		expect(navRetapAction(plain(), notAUrl, '/search', 0)).toBeNull();
	});
});
