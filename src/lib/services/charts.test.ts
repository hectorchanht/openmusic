// charts.ts — the client chart services (39-D-17 / 39-D-18, VALIDATION P39-04) — plus the
// deezerGenreChart client (39-D-16, P39-03) that genreChart dispatches to.
//
// Every call goes through the governed apiFetch (so the mock Response MUST expose clone() — the GET
// dedupe clones it), is memoised 6 h in the ttl-cache, and maps every failure to [] OUTSIDE the
// cache. Both module-scope stores (ttl-cache + governor) are reset around every case. URLs are
// asserted with exact string equality. No live network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	appleSongs,
	appleAlbums,
	kkboxSongs,
	kkboxNewReleases,
	ytTracks,
	ytArtists,
	itunesGenreChart,
	genreChart,
	CHART_POOL_TTL_MS
} from './charts';
import { deezerGenreChart } from './deezer';
import { __clearSearchCache } from './ttl-cache';
import { __resetGovernor } from './api-base';
import itunesHk1251 from './__fixtures__/charts/itunes-hk-1251.json';
import itunesHk1251Single from './__fixtures__/charts/itunes-hk-1251-single.json';
import itunesBogus from './__fixtures__/charts/itunes-bogus.json';

/** A minimal `Response`-like JSON stub with a self-returning clone() (the governor dedupe clones). */
function jsonResponse(body: unknown, ok = true): Response {
	const make = (): Response =>
		({ ok, status: ok ? 200 : 500, json: async () => body, clone: make }) as unknown as Response;
	return make();
}

type Reply = Response | 'THROW';

/** Stub fetch with a per-URL reply; every requested URL is recorded. */
function stubFetch(reply: (url: string) => Reply) {
	const calls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			calls.push(String(url));
			const r = reply(String(url));
			if (r === 'THROW') throw new Error('network down');
			return r;
		})
	);
	return { calls };
}

const SONG = { artist: 'Gareth.T', title: '淺粉紅 pale pink', image: null, mbid: null };
const ALBUM = { name: 'Fallen Angel', artist: 'Someone', image: null };
const ARTIST = { name: '米爺', image: null, mbid: null };

const ITUNES_HK_1251 = 'https://itunes.apple.com/hk/rss/topsongs/limit=100/genre=1251/json';

beforeEach(() => {
	__clearSearchCache();
	__resetGovernor();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	__clearSearchCache();
	__resetGovernor();
});

describe('route wrappers → /api/charts (39-D-17)', () => {
	it('appleSongs(hk) → /api/charts?src=apple&kind=songs&cc=hk and returns items', async () => {
		const { calls } = stubFetch(() => jsonResponse({ items: [SONG] }));
		expect(await appleSongs('hk')).toEqual([SONG]);
		expect(calls).toEqual(['/api/charts?src=apple&kind=songs&cc=hk']);
	});

	it('appleAlbums(hk) → kind=albums', async () => {
		const { calls } = stubFetch(() => jsonResponse({ items: [ALBUM] }));
		expect(await appleAlbums('hk')).toEqual([ALBUM]);
		expect(calls).toEqual(['/api/charts?src=apple&kind=albums&cc=hk']);
	});

	it('kkboxSongs(tw) → src=kkbox&kind=song&cc=tw', async () => {
		const { calls } = stubFetch(() => jsonResponse({ items: [SONG] }));
		expect(await kkboxSongs('tw')).toEqual([SONG]);
		expect(calls).toEqual(['/api/charts?src=kkbox&kind=song&cc=tw']);
	});

	it('kkboxNewReleases(sg) → kind=newrelease', async () => {
		const { calls } = stubFetch(() => jsonResponse({ items: [SONG] }));
		expect(await kkboxNewReleases('sg')).toEqual([SONG]);
		expect(calls).toEqual(['/api/charts?src=kkbox&kind=newrelease&cc=sg']);
	});

	it('ytTracks(us) → src=yt&kind=tracks&cc=us', async () => {
		const { calls } = stubFetch(() => jsonResponse({ items: [SONG] }));
		expect(await ytTracks('us')).toEqual([SONG]);
		expect(calls).toEqual(['/api/charts?src=yt&kind=tracks&cc=us']);
	});

	it('ytArtists(jp) → kind=artists', async () => {
		const { calls } = stubFetch(() => jsonResponse({ items: [ARTIST] }));
		expect(await ytArtists('jp')).toEqual([ARTIST]);
		expect(calls).toEqual(['/api/charts?src=yt&kind=artists&cc=jp']);
	});
});

describe('never-throw + memo posture (WR-03)', () => {
	it('a non-ok response → []', async () => {
		stubFetch(() => jsonResponse({ items: [SONG] }, false));
		expect(await appleSongs('hk')).toEqual([]);
	});

	it('a fetch that throws → []', async () => {
		stubFetch(() => 'THROW');
		expect(await appleSongs('hk')).toEqual([]);
	});

	it('a malformed body (items not an array) → []', async () => {
		stubFetch(() => jsonResponse({ items: 'nope' }));
		expect(await ytTracks('hk')).toEqual([]);
	});

	it('a second call with the same args inside the TTL → 1 fetch total', async () => {
		const { calls } = stubFetch(() => jsonResponse({ items: [SONG] }));
		await appleSongs('hk');
		expect(await appleSongs('hk')).toEqual([SONG]);
		expect(calls).toHaveLength(1);
		expect(CHART_POOL_TTL_MS).toBe(6 * 60 * 60 * 1000);
	});

	it('different args are different cache entries', async () => {
		const { calls } = stubFetch(() => jsonResponse({ items: [SONG] }));
		await appleSongs('hk');
		await appleSongs('tw');
		await kkboxSongs('hk');
		expect(calls).toHaveLength(3);
	});

	it('an already-aborted caller signal → [] with 0 fetches', async () => {
		const { calls } = stubFetch(() => jsonResponse({ items: [SONG] }));
		const ctl = new AbortController();
		ctl.abort();
		expect(await appleSongs('hk', ctl.signal)).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it('a failure is never cached — the next call refetches and succeeds', async () => {
		let n = 0;
		const { calls } = stubFetch(() => (n++ === 0 ? 'THROW' : jsonResponse({ items: [SONG] })));
		expect(await appleSongs('hk')).toEqual([]);
		expect(await appleSongs('hk')).toEqual([SONG]);
		expect(calls).toHaveLength(2);
	});

	it('an empty answer (the edge’s upstream-failure shape) is never cached — the next call refetches', async () => {
		let n = 0;
		const { calls } = stubFetch(() => jsonResponse({ items: n++ === 0 ? [] : [SONG] }));
		expect(await kkboxSongs('hk')).toEqual([]);
		expect(await kkboxSongs('hk')).toEqual([SONG]);
		expect(calls).toHaveLength(2);
	});
});

describe('itunesGenreChart — client-side legacy iTunes genre feed (39-D-18)', () => {
	it('fetches the exact absolute itunes.apple.com URL; every row on-genre with a 600x600 mzstatic image', async () => {
		const { calls } = stubFetch(() => jsonResponse(itunesHk1251));
		const rows = await itunesGenreChart('hk', 1251);
		expect(calls).toEqual([ITUNES_HK_1251]);
		expect(rows).toHaveLength(5); // all five fixture rows carry im:id 1251
		for (const r of rows) {
			expect(r.artist).toBeTruthy();
			expect(r.title).toBeTruthy();
			expect(r.mbid).toBeNull();
			expect(r.image).toMatch(/^https:\/\/.*mzstatic\.com\/.*\/600x600bb\./);
		}
	});

	it('a single-entry feed (entry is an object, not an array) → 1 row', async () => {
		stubFetch(() => jsonResponse(itunesHk1251Single));
		expect(await itunesGenreChart('hk', 1251)).toHaveLength(1);
	});

	it('a bogus genre 99999 (200 with the overall chart) → []', async () => {
		const { calls } = stubFetch(() => jsonResponse(itunesBogus));
		expect(await itunesGenreChart('hk', 99999)).toEqual([]);
		expect(calls).toEqual(['https://itunes.apple.com/hk/rss/topsongs/limit=100/genre=99999/json']);
	});

	it('the per-row genre guard drops off-genre rows from a mixed feed', async () => {
		stubFetch(() => jsonResponse(itunesBogus));
		// itunes-bogus.json carries one 1251 row among overall-chart rows (im:id 14).
		expect(await itunesGenreChart('hk', 1251)).toHaveLength(1);
	});

	it('an image off the Apple host allowlist → null (T-39-17)', async () => {
		stubFetch(() =>
			jsonResponse({
				feed: {
					entry: {
						'im:name': { label: 'Song' },
						'im:artist': { label: 'Artist' },
						'im:image': [{ label: 'https://evil.example.com/a.jpg/170x170bb.png' }],
						category: { attributes: { 'im:id': '1251' } }
					}
				}
			})
		);
		expect(await itunesGenreChart('hk', 1251)).toEqual([
			{ artist: 'Artist', title: 'Song', image: null, mbid: null }
		]);
	});

	it('a non-ok response (403/429 class) → []', async () => {
		stubFetch(() => jsonResponse({}, false));
		expect(await itunesGenreChart('hk', 1251)).toEqual([]);
	});

	it('a fetch that throws → []', async () => {
		stubFetch(() => 'THROW');
		expect(await itunesGenreChart('hk', 1251)).toEqual([]);
	});

	it('memoised per (cc, genre): a repeat call → 1 fetch', async () => {
		const { calls } = stubFetch(() => jsonResponse(itunesHk1251));
		await itunesGenreChart('hk', 1251);
		await itunesGenreChart('hk', 1251);
		expect(calls).toHaveLength(1);
	});

	it('an already-aborted caller signal → [] with 0 fetches', async () => {
		const { calls } = stubFetch(() => jsonResponse(itunesHk1251));
		const ctl = new AbortController();
		ctl.abort();
		expect(await itunesGenreChart('hk', 1251, ctl.signal)).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});

describe('genreChart dispatch (CHART_GENRES)', () => {
	const cases: [Parameters<typeof genreChart>[0], string][] = [
		['cantopop', ITUNES_HK_1251],
		['mandopop', 'https://itunes.apple.com/tw/rss/topsongs/limit=100/genre=1253/json'],
		['kpop', 'https://itunes.apple.com/hk/rss/topsongs/limit=100/genre=51/json'],
		['jpop', 'https://itunes.apple.com/jp/rss/topsongs/limit=100/genre=27/json'],
		['hiphop', '/api/deezer/chart?genre=116&limit=50'],
		['asian', '/api/deezer/chart?genre=16&limit=50']
	];
	for (const [genre, want] of cases) {
		it(`dispatch: ${genre} → ${want}`, async () => {
			const { calls } = stubFetch(() => jsonResponse({}));
			await genreChart(genre);
			expect(calls).toEqual([want]);
		});
	}

	it('dispatch: hiphop returns the Deezer genre tracks', async () => {
		stubFetch(() => jsonResponse({ tracks: [SONG], artists: [] }));
		expect(await genreChart('hiphop')).toEqual([SONG]);
	});
});

describe('deezerGenreChart (39-D-16)', () => {
	it('calls /api/deezer/chart?genre=116&limit=50 and returns data.tracks', async () => {
		const { calls } = stubFetch(() => jsonResponse({ tracks: [SONG], artists: [] }));
		expect(await deezerGenreChart(116)).toEqual([SONG]);
		expect(calls).toEqual(['/api/deezer/chart?genre=116&limit=50']);
	});

	it('a non-ok response → []', async () => {
		stubFetch(() => jsonResponse({ tracks: [SONG] }, false));
		expect(await deezerGenreChart(116)).toEqual([]);
	});

	it('a fetch that throws → []', async () => {
		stubFetch(() => 'THROW');
		expect(await deezerGenreChart(116)).toEqual([]);
	});

	it('a second call inside the TTL → 1 fetch total', async () => {
		const { calls } = stubFetch(() => jsonResponse({ tracks: [SONG], artists: [] }));
		await deezerGenreChart(116);
		expect(await deezerGenreChart(116)).toEqual([SONG]);
		expect(calls).toHaveLength(1);
	});

	it('an empty answer (the route’s upstream-failure shape) is never cached', async () => {
		let n = 0;
		const { calls } = stubFetch(() => jsonResponse({ tracks: n++ === 0 ? [] : [SONG], artists: [] }));
		expect(await deezerGenreChart(152)).toEqual([]);
		expect(await deezerGenreChart(152)).toEqual([SONG]);
		expect(calls).toHaveLength(2);
	});

	it('an already-aborted caller signal → [] with 0 fetches', async () => {
		const { calls } = stubFetch(() => jsonResponse({ tracks: [SONG], artists: [] }));
		const ctl = new AbortController();
		ctl.abort();
		expect(await deezerGenreChart(116, ctl.signal)).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});
