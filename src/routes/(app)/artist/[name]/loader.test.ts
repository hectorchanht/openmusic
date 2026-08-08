// Loader unit test for the DUAL-SHAPE artist route /artist/{name} (OG-COMPAT-01 + OG-PATH-01).
//
// /artist/{name} is the one route whose path shape did not change this phase, so this single loader
// is simultaneously the NEW carrier-free handler and the LEGACY ?c=&dn= handler (PATTERNS
// correction 4). Both generations of link are pinned here:
//  - legacy: an https `c` carrier still wins the card image, `dn` still overrides the display name.
//  - carrier-free: a bare /artist/Nirvana gets a real card from the own-origin /api/og endpoint.
//
// Also the Pitfall 1 regression gate — `load` must NOT throw on a name containing a literal '%'.
// That assertion FAILED before the `decodeURIComponent(params.name)` deletion (live: GET
// /artist/50%25%20Cent → 500, URIError). Written fail-first on purpose.
//
// 🔴 `params` are supplied ALREADY DECODED. SvelteKit's decode_params (utils/routing.js:304) runs
// BEFORE `load` sees them.
import { describe, it, expect } from 'vitest';
import { load, ssr, prerender } from './+page';

function ev(name: string, search = '', origin = 'https://openmusic.lol') {
	const url = new URL(`${origin}/artist/${encodeURIComponent(name)}${search}`);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { params: { name }, url } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (name: string, search = '', origin?: string): any => load(ev(name, search, origin));

const CDN_COVER = 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg';

describe('artist/[name] loader — per-route opt-ins', () => {
	it('opts into SSR and out of prerender', () => {
		expect(ssr).toBe(true);
		expect(prerender).toBe(false);
	});
});

describe('artist/[name] loader — Pitfall 1 (the live 500)', () => {
	it('does NOT throw on an already-decoded literal % in the name', () => {
		// RED before the fix: decodeURIComponent('50% Cent') throws URIError → a hard 500 in prod.
		expect(() => run('50% Cent')).not.toThrow();
		expect(run('50% Cent').og.title).toBe('50% Cent');
	});

	it('does not re-decode a percent-encoded-looking name (single decode only)', () => {
		expect(run('A%20B').og.title).toBe('A B');
	});
});

describe('artist/[name] loader — legacy ?c=&dn= carriers', () => {
	it('keeps an absolute https `c` carrier as the card image (legacy precedence)', () => {
		expect(run('Nirvana', `?c=${encodeURIComponent(CDN_COVER)}`).og.image).toBe(CDN_COVER);
	});

	it('prefers the dn Traditional display override for the card', () => {
		expect(run('周杰伦', '?dn=%E5%91%A8%E6%9D%B0%E5%80%AB').og.title).toBe('周杰倫');
	});

	it('ignores a non-https `c` carrier and falls back to the /api/og card', () => {
		const out = run('Nirvana', '?c=http%3A%2F%2Fevil.example%2Fx.jpg');
		expect(out.og.image).toBe('https://openmusic.lol/api/og?type=artist&artist=Nirvana');
	});
});

describe('artist/[name] loader — carrier-free shape', () => {
	it('reverses the hyphen-for-space transform on a bare path', () => {
		// LOCKED lossy edge: every '-' becomes a space, so a hyphenated real name (`Jay-Z`) also
		// decodes with a space. matchKey strips punctuation AND whitespace, so resolution is exactly
		// insensitive to it (RESEARCH §B.8).
		expect(run('Post-Malone').og.title).toBe('Post Malone');
	});

	it('points og:image at the own-origin /api/og artist card on the REQUEST origin', () => {
		expect(run('Nirvana').og.image).toBe(
			'https://openmusic.lol/api/og?type=artist&artist=Nirvana'
		);
	});

	it('keeps og:image on an http dev origin (own-origin URL, NOT isHttpsUrl-gated)', () => {
		const out = run('Nirvana', '', 'http://localhost:5173');
		expect(out.og.image).toBe('http://localhost:5173/api/og?type=artist&artist=Nirvana');
	});

	it('emits the profile card type', () => {
		expect(run('Nirvana').og.type).toBe('profile');
	});

	it('handles a fully empty name without throwing', () => {
		expect(run('').og.title).toBe('');
	});
});
