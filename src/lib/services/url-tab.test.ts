import { describe, it, expect, vi, afterEach } from 'vitest';
import { pickTab, tabHref, syncTabUrl } from './url-tab';

// Pure/node tests. `pickTab` / `tabHref` are total functions over a URL; `syncTabUrl`'s only
// impure line is browser-guarded, so under the node project (browser === false) it must be an
// observable no-op — which is itself the SSR contract worth pinning.

const VALID = new Set(['liked', 'playlists', 'downloads', 'fav-artists', 'history']);
const u = (href: string) => new URL(href);

describe('pickTab — validated read (T-2jo-01, the library T-23-10 guarantee, shared)', () => {
	it('returns a valid param', () => {
		expect(pickTab(u('https://x/library?tab=downloads'), 'tab', VALID, 'liked')).toBe('downloads');
	});

	it('falls back for an unknown value', () => {
		expect(pickTab(u('https://x/library?tab=nope'), 'tab', VALID, 'liked')).toBe('liked');
	});

	it('falls back when the param is absent', () => {
		expect(pickTab(u('https://x/library'), 'tab', VALID, 'liked')).toBe('liked');
	});

	it('falls back for an empty value', () => {
		expect(pickTab(u('https://x/library?tab='), 'tab', VALID, 'liked')).toBe('liked');
	});

	it('never throws on a malformed url-like object', () => {
		// A caller handing us something that is not a URL must degrade, not crash the page.
		const notAUrl = { searchParams: null } as unknown as URL;
		expect(() => pickTab(notAUrl, 'tab', VALID, 'liked')).not.toThrow();
		expect(pickTab(notAUrl, 'tab', VALID, 'liked')).toBe('liked');
	});
});

describe('tabHref — D-5: the default tab is OMITTED from the URL', () => {
	it('appends a non-default value', () => {
		expect(tabHref(u('https://x/artist/a/albums'), 'tab', 'single', 'main')).toBe(
			'https://x/artist/a/albums?tab=single'
		);
	});

	it('STRIPS the param when the value IS the default', () => {
		expect(tabHref(u('https://x/artist/a/albums?tab=single'), 'tab', 'main', 'main')).toBe(
			'https://x/artist/a/albums'
		);
	});

	it('replaces an existing value rather than appending a second one', () => {
		expect(tabHref(u('https://x/library?tab=liked'), 'tab', 'history', 'liked')).toBe(
			'https://x/library?tab=history'
		);
	});

	it('preserves every OTHER query param in both directions', () => {
		expect(tabHref(u('https://x/library?playlist=abc'), 'tab', 'downloads', 'liked')).toBe(
			'https://x/library?playlist=abc&tab=downloads'
		);
		expect(tabHref(u('https://x/library?playlist=abc&tab=downloads'), 'tab', 'liked', 'liked')).toBe(
			'https://x/library?playlist=abc'
		);
	});

	it('does not mutate the URL it was handed', () => {
		const url = u('https://x/library?tab=liked');
		tabHref(url, 'tab', 'history', 'liked');
		expect(url.href).toBe('https://x/library?tab=liked');
	});
});

describe('syncTabUrl — the one impure line', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('is a no-op under SSR / node (browser === false) and never throws', () => {
		const replaceState = vi.fn();
		vi.stubGlobal('history', { state: null, replaceState });
		expect(() => syncTabUrl('tab', 'history', 'liked')).not.toThrow();
		expect(replaceState).not.toHaveBeenCalled();
	});
});

describe('url-tab uses RAW history.replaceState, never $app/navigation', () => {
	// Same reason overlays.svelte.ts documents: SvelteKit's shallow-routing pushState/replaceState
	// desync the router index and make goto() a no-op. Comment-filtered so the explanatory comment
	// can name the module it avoids without invalidating its own gate.
	it('imports nothing from $app/navigation', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync('src/lib/services/url-tab.ts', 'utf8')
			.split('\n')
			.filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
			.join('\n');
		expect(src).not.toContain("from '$app/navigation'");
	});
});
