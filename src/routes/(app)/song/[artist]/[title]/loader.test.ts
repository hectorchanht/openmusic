// Loader unit test for the carrier-free SONG route /song/{artist}/{title} (OG-PATH-01).
//
// The first loader test in this repo (PATTERNS §10 — every other test under src/routes is a
// +server.ts endpoint test). It is only possible because the loader is SYNCHRONOUS, FETCH-FREE and
// imports './$types' TYPE-ONLY: a value import from './$types', or any $app/* runtime import, would
// make +page.ts unloadable outside a SvelteKit render (there is no jsdom project — vite.config.ts
// declares a single node project). Those are design constraints on the loader, not just on the test.
//
// 🔴 `params` are supplied ALREADY DECODED. SvelteKit's decode_params (utils/routing.js:304) runs
// BEFORE `load` sees them, so passing '%2550%25' here would bake in Pitfall 1 — the second decode
// that 500s the legacy /album/{name} route today on any name containing a literal '%'.
import { describe, it, expect } from 'vitest';
import { load, ssr, prerender } from './+page';

function ev(artist: string, title: string, origin = 'https://openmusic.lol') {
	// The URL carries the ENCODED segments (that is what a real request line looks like); the
	// `params` beside it are the decoded values the router hands to `load`.
	const url = new URL(`${origin}/song/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { params: { artist, title }, url } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (artist: string, title: string, origin?: string): any => load(ev(artist, title, origin));

describe('song/[artist]/[title] loader — per-route opt-ins', () => {
	it('opts into SSR and out of prerender', () => {
		expect(ssr).toBe(true);
		expect(prerender).toBe(false);
	});
});

describe('song/[artist]/[title] loader — path-segment decoding', () => {
	it('passes an already-decoded literal % through untouched (never re-decodes)', () => {
		const out = run('Post Malone', '50% Off');
		expect(out.name).toBe('50% Off');
		expect(out.artist).toBe('Post Malone');
	});

	it('reverses the hyphen-for-space transform and builds a `Song • Artist` card title', () => {
		const out = run('Nirvana', 'Come-As-You-Are');
		expect(out.name).toBe('Come As You Are');
		expect(out.og.title).toBe('Come As You Are • Nirvana');
	});

	it('round-trips CJK, emoji and RTL text without throwing', () => {
		expect(run('周杰倫', '稻香').og.title).toBe('稻香 • 周杰倫');
		expect(run('Artist', '🎵 Song').name).toBe('🎵 Song');
		expect(run('فيروز', 'زهرة المدائن').name).toBe('زهرة المدائن');
	});

	it('falls back to a brand title when the title segment is the empty guard', () => {
		// encodePathSegment emits '-' for an empty input, and '-' decodes back to ''.
		const out = run('Nirvana', '-');
		expect(out.name).toBe('');
		expect(out.og.title).toBe('openmusic • Nirvana');
	});

	it('drops the bullet when both segments are empty and never throws', () => {
		const out = run('', '');
		expect(out.og.title).toBe('openmusic');
	});
});

describe('song/[artist]/[title] loader — OG head', () => {
	it('emits the music.song card type', () => {
		expect(run('Nirvana', 'Come-As-You-Are').og.type).toBe('music.song');
	});

	it('points og:image at the own-origin /api/og song card on the REQUEST origin', () => {
		const out = run('Nirvana', 'Come-As-You-Are');
		expect(out.og.image).toBe(
			'https://openmusic.lol/api/og?type=song&artist=Nirvana&title=Come%20As%20You%20Are'
		);
	});

	it('keeps og:image on an http dev origin (own-origin URL, NOT isHttpsUrl-gated)', () => {
		const out = run('Nirvana', 'Come-As-You-Are', 'http://localhost:5173');
		expect(out.og.image.startsWith('http://localhost:5173/api/og?type=song')).toBe(true);
	});
});
