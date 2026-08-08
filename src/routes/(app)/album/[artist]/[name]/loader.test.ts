// Loader unit test for the carrier-free ALBUM route /album/{artist}/{name} (OG-PATH-01).
//
// Same species as song/[artist]/[title]/loader.test.ts (PATTERNS §10): the loader is SYNCHRONOUS,
// FETCH-FREE and imports './$types' TYPE-ONLY, which is what makes +page.ts importable standalone
// under the single node vitest project (there is no jsdom project).
//
// 🔴 `params` are supplied ALREADY DECODED — SvelteKit's decode_params (utils/routing.js:304) runs
// before `load`. Passing an encoded form here would bake in Pitfall 1, the second decode that 500s
// the LEGACY /album/{name} route today on a name containing a literal '%'.
import { describe, it, expect } from 'vitest';
import { load, ssr, prerender } from './+page';

function ev(artist: string, name: string, origin = 'https://openmusic.lol') {
	const url = new URL(`${origin}/album/${encodeURIComponent(artist)}/${encodeURIComponent(name)}`);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { params: { artist, name }, url } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (artist: string, name: string, origin?: string): any => load(ev(artist, name, origin));

describe('album/[artist]/[name] loader — per-route opt-ins', () => {
	it('opts into SSR and out of prerender', () => {
		expect(ssr).toBe(true);
		expect(prerender).toBe(false);
	});
});

describe('album/[artist]/[name] loader — path-segment decoding', () => {
	it('builds a CJK `Name • Artist` card matching the legacy album card', () => {
		const out = run('周杰倫', '范特西');
		expect(out.og.title).toBe('范特西 • 周杰倫');
		expect(out.name).toBe('范特西');
		expect(out.artist).toBe('周杰倫');
	});

	it("decodes the '-' empty-artist guard to '' and still emits a valid card", () => {
		const out = run('-', 'Nevermind');
		expect(out.artist).toBe('');
		expect(out.og.title).toBe('Nevermind');
	});

	it('passes an already-decoded literal % through untouched (never re-decodes)', () => {
		expect(run('Post Malone', '50% Off').name).toBe('50% Off');
	});

	it('reverses the hyphen-for-space transform', () => {
		expect(run('Nirvana', 'In-Utero').name).toBe('In Utero');
	});

	it('never throws on emoji or fully empty segments', () => {
		expect(run('Artist', '🎵 Album').name).toBe('🎵 Album');
		expect(run('', '').og.title).toBe('openmusic');
	});
});

describe('album/[artist]/[name] loader — OG head', () => {
	it('emits the music.album card type', () => {
		expect(run('Nirvana', 'Nevermind').og.type).toBe('music.album');
	});

	it('points og:image at the own-origin /api/og album card on the REQUEST origin', () => {
		const out = run('周杰倫', '范特西');
		expect(out.og.image).toBe(
			`https://openmusic.lol/api/og?type=album&artist=${encodeURIComponent('周杰倫')}&title=${encodeURIComponent('范特西')}`
		);
	});

	it('keeps og:image on an http dev origin (own-origin URL, NOT isHttpsUrl-gated)', () => {
		const out = run('Nirvana', 'Nevermind', 'http://localhost:5173');
		expect(out.og.image.startsWith('http://localhost:5173/api/og?type=album')).toBe(true);
	});
});
