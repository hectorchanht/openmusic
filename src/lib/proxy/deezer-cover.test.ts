import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	safeDeezerImageUrl,
	safeDeezerPreviewUrl,
	reshapeDeezerSearch,
	deezerSearchUrl,
	fetchDeezerCover,
	DEEZER_COVER_TTL
} from './deezer-cover';

// $lib/proxy/deezer-cover is the OG-EP-03 extraction out of api/deezer/search/+server.ts. These
// helpers were previously only observable THROUGH the route (a `+server.ts` cannot export a
// non-verb helper — `svelte-server-endpoint-only-verb-exports`); direct coverage is the value the
// extraction adds. The route's own behavior stays proven by the untouched
// api/deezer/search/deezer-endpoint.test.ts harness.
//
// LIVE Deezer probe facts these assertions encode (2026-06-06 / re-confirmed 2026-08-07):
// no-match is a clean `200 { data: [], total: 0 }`; covers live on cdn-images.dzcdn.net (https);
// cover_xl ≈ 208 KB vs cover_big ≈ 73 KB (why `prefer` exists).

beforeEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const COVER_XL = 'https://cdn-images.dzcdn.net/images/cover/abc/1000x1000-000000-80-0-0.jpg';
const COVER_BIG = 'https://cdn-images.dzcdn.net/images/cover/abc/500x500-000000-80-0-0.jpg';
const COVER_MED = 'https://cdn-images.dzcdn.net/images/cover/abc/250x250-000000-80-0-0.jpg';
const PIC_XL = 'https://cdn-images.dzcdn.net/images/artist/def/1000x1000-000000-80-0-0.jpg';
const PIC_BIG = 'https://cdn-images.dzcdn.net/images/artist/def/500x500-000000-80-0-0.jpg';
const PREVIEW = 'https://cdnt-preview.dzcdn.net/api/1/1/a/b/c.mp3';

const EMPTY = { cover: null, artistPicture: null };

function body(data: unknown, total = 1) {
	return JSON.stringify({ data, total });
}

describe('safeDeezerImageUrl (T-wv8-05 — per-tier host allow-list)', () => {
	it('keeps a clean https cdn-images.dzcdn.net URL', () => {
		expect(safeDeezerImageUrl(COVER_XL)).toBe(COVER_XL);
	});

	it('keeps any *.dzcdn.net subdomain over https', () => {
		const u = 'https://e-cdns-images.dzcdn.net/images/cover/x/500x500.jpg';
		expect(safeDeezerImageUrl(u)).toBe(u);
	});

	it('rejects a non-dzcdn host (a Deezer body must never smuggle another tier\'s host)', () => {
		expect(safeDeezerImageUrl('https://evil.example.com/cover.jpg')).toBeNull();
		expect(safeDeezerImageUrl('https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg')).toBeNull();
	});

	it('rejects http (https-only)', () => {
		expect(safeDeezerImageUrl('http://cdn-images.dzcdn.net/cover.jpg')).toBeNull();
	});

	it('rejects CSS url() / attribute breakers: ) ( quote space backslash', () => {
		expect(safeDeezerImageUrl('https://cdn-images.dzcdn.net/a.jpg)evil.png')).toBeNull();
		expect(safeDeezerImageUrl('https://cdn-images.dzcdn.net/a(1).jpg')).toBeNull();
		expect(safeDeezerImageUrl('https://cdn-images.dzcdn.net/a".jpg')).toBeNull();
		expect(safeDeezerImageUrl("https://cdn-images.dzcdn.net/a'.jpg")).toBeNull();
		expect(safeDeezerImageUrl('https://cdn-images.dzcdn.net/a b.jpg')).toBeNull();
		expect(safeDeezerImageUrl('https://cdn-images.dzcdn.net/a\\b.jpg')).toBeNull();
	});

	it('handles null / undefined / empty / unparseable input without throwing', () => {
		expect(safeDeezerImageUrl(null)).toBeNull();
		expect(safeDeezerImageUrl(undefined)).toBeNull();
		expect(safeDeezerImageUrl('')).toBeNull();
		expect(safeDeezerImageUrl('not-a-url')).toBeNull();
	});
});

describe('safeDeezerPreviewUrl (30s mp3 host)', () => {
	it('keeps a clean https *.dzcdn.net preview URL', () => {
		expect(safeDeezerPreviewUrl(PREVIEW)).toBe(PREVIEW);
	});

	it('rejects a foreign host, http, and null without throwing', () => {
		expect(safeDeezerPreviewUrl('https://evil.example.com/a.mp3')).toBeNull();
		expect(safeDeezerPreviewUrl('http://cdnt-preview.dzcdn.net/a.mp3')).toBeNull();
		expect(safeDeezerPreviewUrl(null)).toBeNull();
	});
});

describe('reshapeDeezerSearch', () => {
	const full = {
		album: { cover_xl: COVER_XL, cover_big: COVER_BIG, cover_medium: COVER_MED },
		artist: { picture_xl: PIC_XL, picture_big: PIC_BIG }
	};

	it("prefer 'xl' (default) picks cover_xl ?? cover_big ?? cover_medium — the legacy client order", () => {
		expect(reshapeDeezerSearch({ data: [full] }, 1).cover).toBe(COVER_XL);
		expect(reshapeDeezerSearch({ data: [{ album: { cover_big: COVER_BIG, cover_medium: COVER_MED } }] }, 1).cover).toBe(COVER_BIG);
		expect(reshapeDeezerSearch({ data: [{ album: { cover_medium: COVER_MED } }] }, 1).cover).toBe(COVER_MED);
	});

	it("prefer 'big' picks cover_big first (72 KB vs 208 KB — the /api/og crawler budget, §C.13)", () => {
		expect(reshapeDeezerSearch({ data: [full] }, 1, 'big').cover).toBe(COVER_BIG);
		// falls back to xl when big is absent
		expect(reshapeDeezerSearch({ data: [{ album: { cover_xl: COVER_XL } }] }, 1, 'big').cover).toBe(COVER_XL);
	});

	it('picks artistPicture picture_xl ?? picture_big regardless of `prefer`', () => {
		expect(reshapeDeezerSearch({ data: [full] }, 1, 'big').artistPicture).toBe(PIC_XL);
		expect(reshapeDeezerSearch({ data: [{ artist: { picture_big: PIC_BIG } }] }, 1).artistPicture).toBe(PIC_BIG);
	});

	it('returns the empty sentinel for a no-match { data: [], total: 0 }', () => {
		expect(reshapeDeezerSearch({ data: [], total: 0 }, 1)).toEqual(EMPTY);
	});

	it('returns the empty sentinel for a malformed / unknown body without throwing', () => {
		expect(reshapeDeezerSearch(null, 1)).toEqual(EMPTY);
		expect(reshapeDeezerSearch(undefined, 1)).toEqual(EMPTY);
		expect(reshapeDeezerSearch('not an object', 1)).toEqual(EMPTY);
		expect(reshapeDeezerSearch({ data: 'nope' }, 1)).toEqual(EMPTY);
		expect(reshapeDeezerSearch({ error: { code: 4 } }, 1)).toEqual(EMPTY);
	});

	it('omits `results` at limit=1 and populates it at limit>1 (quick-260607-jau)', () => {
		const two = { data: [{ id: 1, title: 'A', preview: PREVIEW, ...full }, { id: 2, title: 'B', ...full }] };
		expect(reshapeDeezerSearch(two, 1).results).toBeUndefined();
		const hits = reshapeDeezerSearch(two, 5).results ?? [];
		expect(hits.length).toBe(2);
		expect(hits[0]).toEqual({
			id: '1',
			title: 'A',
			artist: '',
			album: '',
			cover: COVER_XL,
			preview: PREVIEW
		});
	});

	it('drops a hit with no id from `results`', () => {
		const hits = reshapeDeezerSearch({ data: [{ ...full }, { id: 7, ...full }] }, 5).results ?? [];
		expect(hits.map((h) => h.id)).toEqual(['7']);
	});
});

describe('deezerSearchUrl (T-wv8-01 — passthrough only)', () => {
	it('encodeURIComponents q into the fixed template with limit default 1', () => {
		expect(deezerSearchUrl('Jay Chou Simple Love')).toBe(
			`https://api.deezer.com/search?q=${encodeURIComponent('Jay Chou Simple Love')}&limit=1`
		);
	});

	it('encodes CJK and query-breaking characters', () => {
		const u = deezerSearchUrl('周杰伦 稻香&limit=99', 5);
		expect(u).toBe(`https://api.deezer.com/search?q=${encodeURIComponent('周杰伦 稻香&limit=99')}&limit=5`);
		// the injected `&limit=99` is encoded, so the real limit param is the only one honored
		expect(u.endsWith('&limit=5')).toBe(true);
	});
});

// The two-valued return exists for OG-EP-01 negative caching (RESEARCH §C.9): `/api/og` (and the
// route here) may cache a CLEAN MISS for the full TTL, but must NEVER cache a FAULT — a cached
// fault would pin an empty card for 24h instead of retrying on the next crawl.
describe('fetchDeezerCover — miss (empty sentinel) vs error (null)', () => {
	function stubFetch(fn: () => Promise<Response>) {
		const spy = vi.fn(fn);
		vi.stubGlobal('fetch', spy);
		return spy;
	}

	it('a clean no-match 200 is a MISS → { cover: null, artistPicture: null }', async () => {
		stubFetch(async () => new Response(body([], 0), { status: 200 }));
		const res = await fetchDeezerCover('asdkjhaskdjh no match', AbortSignal.timeout(2000), 0);
		expect(res).toEqual(EMPTY);
	});

	it('a non-ok response is an ERROR → null', async () => {
		stubFetch(async () => new Response('{}', { status: 404 }));
		expect(await fetchDeezerCover('x', AbortSignal.timeout(2000), 0)).toBeNull();
	});

	it('malformed JSON is an ERROR → null', async () => {
		stubFetch(async () => new Response('not json at all', { status: 200 }));
		expect(await fetchDeezerCover('x', AbortSignal.timeout(2000), 0)).toBeNull();
	});

	it('a rejected fetch is an ERROR → null (never throws)', async () => {
		stubFetch(async () => {
			throw new Error('network down');
		});
		expect(await fetchDeezerCover('x', AbortSignal.timeout(2000), 0)).toBeNull();
	});

	it('an already-aborted signal returns null with NO fetch', async () => {
		const spy = stubFetch(async () => new Response(body([], 0), { status: 200 }));
		expect(await fetchDeezerCover('x', AbortSignal.abort(), 0)).toBeNull();
		expect(spy).not.toHaveBeenCalled();
	});
});

describe('fetchDeezerCover — a hit reshapes per `prefer`', () => {
	const hit = body([
		{
			id: 3,
			album: { cover_xl: COVER_XL, cover_big: COVER_BIG },
			artist: { picture_xl: PIC_XL }
		}
	]);

	it("defaults to prefer 'xl' and requests limit=1 on the encoded upstream URL", async () => {
		let upstream = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				upstream = String(input);
				return new Response(hit, { status: 200 });
			})
		);
		const res = await fetchDeezerCover('周杰伦 稻香', AbortSignal.timeout(2000), 0);
		expect(res).toEqual({ cover: COVER_XL, artistPicture: PIC_XL });
		expect(upstream).toBe(
			`https://api.deezer.com/search?q=${encodeURIComponent('周杰伦 稻香')}&limit=1`
		);
	});

	it("prefer 'big' returns the 500px variant (/api/og path)", async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(hit, { status: 200 })));
		const res = await fetchDeezerCover('x', AbortSignal.timeout(2000), 0, 'big');
		expect(res?.cover).toBe(COVER_BIG);
	});

	it('threads `limit` through so the ?limit=N results payload is not regressed (deezer.ts:186)', async () => {
		let upstream = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				upstream = String(input);
				return new Response(hit, { status: 200 });
			})
		);
		const res = await fetchDeezerCover('x', AbortSignal.timeout(2000), 0, 'xl', 10);
		expect(upstream).toContain('&limit=10');
		expect(res?.results?.map((h) => h.id)).toEqual(['3']);
	});
});

describe('DEEZER_COVER_TTL', () => {
	it('is 86400 (one day — keeps re-browsing off Deezer\'s ~50 req/5s cap)', () => {
		expect(DEEZER_COVER_TTL).toBe(86400);
	});
});
