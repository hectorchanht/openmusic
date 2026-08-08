// Loader unit test for the LEGACY song share route /song/{slug}?n=&a=&c= (OG-COMPAT-01).
//
// This is the backward-compatibility gate: every link of this shape already sitting in someone's
// chat history must keep resolving AND keep its card, forever. The carrier semantics asserted here
// (DQ-1/DQ-2 `n`/`a`, quick-260723-r4p `c` https-gated) are frozen — a future refactor that drops
// or renames one of them fails here.
//
// Shape per PATTERNS §10 (same as the carrier-free song/[artist]/[title] loader test): the loader is
// SYNCHRONOUS, FETCH-FREE and imports './$types' TYPE-ONLY, which is exactly what makes it
// importable outside a SvelteKit render (there is no jsdom project — vite.config.ts declares a
// single node project).
//
// 🔴 `params` are supplied ALREADY DECODED. SvelteKit's decode_params (utils/routing.js:304) runs
// BEFORE `load` sees them, so passing '50%25%20Off' here would bake in Pitfall 1 — the second
// decode that 500s the legacy /album/{name} and /artist/{name} routes today.
import { describe, it, expect } from 'vitest';
import { load, ssr, prerender } from './+page';

function ev(slug: string, search = '', origin = 'https://openmusic.lol') {
	const url = new URL(`${origin}/song/${encodeURIComponent(slug)}${search}`);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { params: { slug }, url } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (slug: string, search = '', origin?: string): any => load(ev(slug, search, origin));

const CDN_COVER = 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg';

describe('song/[slug] legacy loader — per-route opt-ins', () => {
	it('opts into SSR and out of prerender', () => {
		expect(ssr).toBe(true);
		expect(prerender).toBe(false);
	});
});

describe('song/[slug] legacy loader — DQ-1/DQ-2 query carriers', () => {
	it('builds `Song • Artist` from the n/a carriers and returns them as page data', () => {
		const out = run('come-as-you-are-nirvana', '?n=Come%20As%20You%20Are&a=Nirvana');
		expect(out.og.title).toBe('Come As You Are • Nirvana');
		expect(out.name).toBe('Come As You Are');
		expect(out.artist).toBe('Nirvana');
	});

	it('falls back to the Title-Cased slug when `n` is absent', () => {
		const out = run('come-as-you-are-nirvana');
		expect(out.og.title).toBe('Come As You Are Nirvana');
		expect(out.name).toBe('');
	});

	it('falls back to the brand title for the `s` placeholder slug with no carriers', () => {
		expect(run('s').og.title).toBe('openmusic');
	});

	it('round-trips CJK carriers untouched', () => {
		expect(run('s', '?n=%E7%A8%BB%E9%A6%99&a=%E5%91%A8%E6%9D%B0%E5%80%AB').og.title).toBe(
			'稻香 • 周杰倫'
		);
	});

	it('passes an already-decoded literal % in the slug through without throwing', () => {
		// The legacy song loader never decoded params, so it was never affected by Pitfall 1 — this
		// pins that (it is the in-repo proof the correct form already existed, PATTERNS §4).
		expect(() => run('50% off')).not.toThrow();
	});
});

describe('song/[slug] legacy loader — cover carrier + og:type', () => {
	it('surfaces an absolute https `c` carrier as og:image (quick-260723-r4p)', () => {
		expect(run('s', `?n=X&c=${encodeURIComponent(CDN_COVER)}`).og.image).toBe(CDN_COVER);
	});

	it('drops a non-https `c` carrier so the card falls back to /og.svg (D-07)', () => {
		expect(run('s', '?n=X&c=http%3A%2F%2Fevil.example%2Fx.jpg').og.image).toBe(null);
		expect(run('s', '?n=X').og.image).toBe(null);
	});

	it('emits the music.song card type', () => {
		expect(run('s', '?n=X&a=Y').og.type).toBe('music.song');
	});
});
