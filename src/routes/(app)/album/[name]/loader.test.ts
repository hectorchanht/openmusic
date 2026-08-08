// Loader unit test for the LEGACY album route /album/{name}?artist=&c=&dn=&da= (OG-COMPAT-01).
//
// Two jobs:
//  1. Backward-compatibility gate — the `?artist=`/`c`/`dn`/`da` carriers (quick-260723-ry1) must
//     keep populating the card exactly as they do today for every link already in the wild.
//  2. Pitfall 1 regression gate — `load` must NOT throw on a name containing a literal '%'. That
//     assertion FAILED before the `decodeURIComponent(params.name)` deletion (live: GET
//     /album/50%25%20Off → 500, URIError). Written fail-first on purpose.
//
// 🔴 `params` are supplied ALREADY DECODED. SvelteKit's decode_params (utils/routing.js:304) runs
// BEFORE `load` sees them, so passing '50%25%20Off' here would hide the very bug this file exists
// to pin.
import { describe, it, expect } from 'vitest';
import { load, ssr, prerender } from './+page';

function ev(name: string, search = '', origin = 'https://openmusic.lol') {
	const url = new URL(`${origin}/album/${encodeURIComponent(name)}${search}`);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { params: { name }, url } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (name: string, search = '', origin?: string): any => load(ev(name, search, origin));

const CDN_COVER = 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg';

describe('album/[name] legacy loader — per-route opt-ins', () => {
	it('opts into SSR and out of prerender', () => {
		expect(ssr).toBe(true);
		expect(prerender).toBe(false);
	});
});

describe('album/[name] legacy loader — Pitfall 1 (the live 500)', () => {
	it('does NOT throw on an already-decoded literal % in the name', () => {
		// RED before the fix: decodeURIComponent('50% Off') throws URIError → a hard 500 in prod.
		expect(() => run('50% Off')).not.toThrow();
		expect(run('50% Off').og.title).toBe('50% Off');
	});

	it('does not re-decode a percent-encoded-looking name (single decode only)', () => {
		// The router already decoded once; '%20' arriving here is LITERAL text, not a space.
		expect(run('A%20B').og.title).toBe('A%20B');
	});
});

describe('album/[name] legacy loader — quick-260723-ry1 query carriers', () => {
	it('builds `Album • Artist` from the path name + the ?artist= resolution key', () => {
		expect(run('Nevermind', '?artist=Nirvana').og.title).toBe('Nevermind • Nirvana');
	});

	it('drops the bullet when no ?artist= is carried (deep link)', () => {
		expect(run('Nevermind').og.title).toBe('Nevermind');
	});

	it('prefers the dn/da Traditional display overrides for the card only', () => {
		const out = run('范特西', '?artist=%E5%91%A8%E6%9D%B0%E4%BC%A6&dn=%E7%AF%84%E7%89%B9%E8%A5%BF&da=%E5%91%A8%E6%9D%B0%E5%80%AB');
		expect(out.og.title).toBe('範特西 • 周杰倫');
	});

	it('surfaces an absolute https `c` carrier as og:image and drops a non-https one', () => {
		expect(run('Nevermind', `?c=${encodeURIComponent(CDN_COVER)}`).og.image).toBe(CDN_COVER);
		expect(run('Nevermind', '?c=http%3A%2F%2Fevil.example%2Fx.jpg').og.image).toBe(null);
	});

	it('emits the music.album card type', () => {
		expect(run('Nevermind', '?artist=Nirvana').og.type).toBe('music.album');
	});

	it('handles a fully empty name without throwing', () => {
		expect(run('').og.title).toBe('');
	});
});
