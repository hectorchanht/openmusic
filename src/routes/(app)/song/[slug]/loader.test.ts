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
import { readFileSync } from 'node:fs';
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

// ---------------------------------------------------------------------------------------------
// SOURCE GUARD — the sibling +page.svelte (quick-260809-38i, 38-D-06/D-13/D-16)
// ---------------------------------------------------------------------------------------------
// Opening a share link now RESOLVES on mount (38-D-13) and must STILL start no audio: playback
// begins only on the user's tap. quick-260809-38i's decision is unchanged — what moved back to
// mount is the resolve, never the playback (38-D-06; a share navigation is not an in-page gesture,
// and mobile autoplay policy rejects it). That is COMPONENT behaviour, and there is no jsdom
// project here (vite.config.ts declares a single node project), so the component cannot be mounted
// in a test. Guarding the SOURCE is the honest option: it is a regression tripwire on the exact
// lines that matter, not a proof of runtime behaviour.
describe('song share page — resolve on mount, never play on mount (quick-260809-38i)', () => {
	const src = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

	/** The onMount body, so the assertion is about what runs on mount and nothing else. */
	const onMountBody = src.match(/onMount\(\(\) => \{([\s\S]*?)\n\t\}\);/)?.[1] ?? '';
	/** The arrive() body — the only thing mount reaches beyond the bindings. */
	const arriveBody =
		src.match(/async function arrive\(\): Promise<ArrivalOutcome> \{([\s\S]*?)\n\t\}/)?.[1] ?? '';
	/** The CTA handler body — what the user's tap runs, which is NOT the mount path. */
	const playNowBody = src.match(/async function playNow\(\) \{([\s\S]*?)\n\t\}/)?.[1] ?? '';

	it('onMount fires the arrival resolve (38-D-13)', () => {
		expect(onMountBody).not.toBe(''); // the extraction itself must not silently pass
		expect(onMountBody).toContain('inflight = arrive();');
	});

	it('onMount BINDS the play handler but never CALLS it', () => {
		// Naming it once is the binding; a second mention is the autoplay call coming back. (A regex
		// for `onMount(...playNow` cannot express this — the binding is inside onMount too.)
		expect(onMountBody.match(/playNow/g) ?? []).toHaveLength(1);
		expect(onMountBody).toContain('retry = () => void playNow();');
	});

	it('nothing on the mount path starts audio (38-D-06)', () => {
		expect(arriveBody).not.toBe('');
		expect(arriveBody).not.toMatch(/\.play\(|\.toggle\(/);
		expect(onMountBody).not.toMatch(/\.play\(|\.toggle\(/);
	});

	it('the tap is what starts the song, and it stays tappable mid-resolve (38-D-16)', () => {
		// Paired with the assertions above on purpose: deleting the CONTROL instead of the autoplay
		// would satisfy them and leave the page unplayable.
		expect(src).toContain('retry = () => void playNow();');
		expect(src).toContain('disabled={retry === null}');
		// quick-260920-oja: this used to assert the literal `if (!player.playing) player.toggle();`
		// in THIS file. That line was the whole CTA and it was wrong for every tap after the first —
		// it started whatever was current then, not the shared song. It now lives in `replayShared`,
		// together with the "is the shared song still current?" question it was missing, and is
		// pinned BEHAVIOURALLY by share-arrival.test.ts (cases a-d) rather than by a source grep. The
		// guard that survives here is the one this file can actually make: the page must delegate to
		// that service and must NOT re-grow a local transport call of its own.
		expect(playNowBody).toContain('replayShared(');
		expect(playNowBody).not.toMatch(/\.play\(|\.toggle\(/);
	});
});
