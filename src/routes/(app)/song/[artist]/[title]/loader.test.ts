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
import { readFileSync } from 'node:fs';
import { load, ssr, prerender } from './+page';

function ev(artist: string, title: string, origin = 'https://openmusic.lol', ci?: string) {
	// The URL carries the ENCODED segments (that is what a real request line looks like); the
	// `params` beside it are the decoded values the router hands to `load`.
	// quick-260809-3uo: `ci` is a QUERY param, so it goes on the URL only — NOT into `params`, and
	// the already-decoded-params discipline in the header above is unaffected by it.
	const url = new URL(`${origin}/song/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
	if (ci !== undefined) url.searchParams.set('ci', ci);
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

// ---------------------------------------------------------------------------------------------
// quick-260809-3uo — the `ci` cover-id carrier is ECHOED into the own-origin card URL
// ---------------------------------------------------------------------------------------------
// The loader does not parse the token; it is opaque here and /api/og's coverUrlFromToken is the
// real gate. What must hold is that the loader stays SYNCHRONOUS and FETCH-FREE (T-3uo-06) and that
// a link with no usable `ci` produces exactly today's carrier-free URL.
describe('song/[artist]/[title] loader — the ci cover-id carrier', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const runCi = (ci?: string): any => load(ev('陳柏宇', '你瞞我瞞', 'https://openmusic.lol', ci));
	const BARE = 'https://openmusic.lol/api/og?type=song&artist=%E9%99%B3%E6%9F%8F%E5%AE%87&title=%E4%BD%A0%E7%9E%9E%E6%88%91%E7%9E%9E';

	it('echoes a token verbatim into &ci= on the own-origin /api/og URL', () => {
		expect(runCi('i:446760418').og.image).toBe(`${BARE}&ci=i%3A446760418`);
		expect(runCi('d:fe1082c5ef54876802146897e76b592e').og.image).toBe(
			`${BARE}&ci=d%3Afe1082c5ef54876802146897e76b592e`
		);
	});

	it('no ci, an empty ci, or an over-cap ci → exactly today\'s carrier-free URL', () => {
		expect(runCi().og.image).toBe(BARE);
		expect(runCi('').og.image).toBe(BARE);
		expect(runCi('d:' + 'a'.repeat(200)).og.image).toBe(BARE);
	});

	it('stays synchronous and fetch-free (the load result is not a Promise)', () => {
		const out = runCi('i:446760418');
		expect(typeof out.then).not.toBe('function');
		expect(out.name).toBe('你瞞我瞞');
	});
});
