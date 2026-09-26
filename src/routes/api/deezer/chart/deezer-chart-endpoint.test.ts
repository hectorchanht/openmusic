// Endpoint tests for /api/deezer/chart — the Deezer genre-chart branch (39-D-16, P39-03).
//
// Harness: resolve-endpoint.test.ts's in-memory `caches.default` shim + an upstream stub that
// records every subrequest URL. `edgeCache()` returns null under vitest only when `caches` is
// absent; the shim makes the route take its real cache path, so "a repeat request is a HIT with
// zero upstream calls" and "genre / no-genre are separate cache entries" are provable here.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from './+server';
import { safeImageUrl, DEEZER_IMAGE_HOSTS } from '$lib/proxy/safe-image-url';
import genreFixture from '$lib/services/__fixtures__/charts/deezer-116.json';

const ORIGIN = 'https://openmusic.lol';

/** In-memory caches.default. */
function stubCache() {
	const store = new Map<string, Response>();
	const putKeys: string[] = [];
	const cacheStub = {
		match: vi.fn(async (req: Request) => {
			const hit = store.get(req.url);
			return hit ? hit.clone() : undefined;
		}),
		put: vi.fn(async (req: Request, res: Response) => {
			putKeys.push(req.url);
			store.set(req.url, res.clone());
		})
	};
	vi.stubGlobal('caches', { default: cacheStub });
	return { store, putKeys, cacheStub };
}

type Reply = Response | 'THROW';

/** Stub the Deezer upstream; every subrequest URL is recorded so counts can be asserted. */
function stubUpstream(replies: Reply[]) {
	const calls: string[] = [];
	let i = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			calls.push(String(url));
			const reply = replies.length ? replies[Math.min(i++, replies.length - 1)] : 'THROW';
			if (reply === 'THROW') throw new Error('network down');
			return reply.clone();
		})
	);
	return { calls };
}

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});

/** Today's /chart envelope — { tracks: { data }, artists: { data } }. */
const OVERALL = {
	tracks: {
		data: [
			{
				title: 'Overall Hit',
				artist: { name: 'Someone' },
				album: { cover_xl: 'https://cdn-images.dzcdn.net/images/cover/x/1000x1000.jpg' }
			}
		]
	},
	artists: { data: [{ name: 'Someone', picture_xl: 'https://cdn-images.dzcdn.net/images/artist/y/1000x1000.jpg' }] }
};

const callGET = (query: string) => {
	const url = new URL(`${ORIGIN}/api/deezer/chart?${query}`);
	const request = new Request(url, { headers: { origin: ORIGIN } });
	// Only { url, request } is read by the route.
	return GET({ url, request } as unknown as Parameters<typeof GET>[0]);
};

interface Body {
	tracks: { artist: string; title: string; image: string | null; mbid: null }[];
	artists: { name: string; image: string | null; mbid: null }[];
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('GET /api/deezer/chart?genre= (39-D-16)', () => {
	it('fetches /chart/{id}/tracks?limit=50 for an allowlisted genre and answers { tracks, artists: [] }', async () => {
		stubCache();
		const { calls } = stubUpstream([json(genreFixture)]);
		const res = await callGET('genre=116&limit=50');
		const body = (await res.json()) as Body;

		expect(calls).toEqual(['https://api.deezer.com/chart/116/tracks?limit=50']);
		expect(body.artists).toEqual([]);
		expect(body.tracks.length).toBeGreaterThanOrEqual(1);
		expect(body.tracks[0]).toEqual({
			artist: 'Drake',
			title: 'Janice STFU',
			image: expect.any(String),
			mbid: null
		});
		for (const t of body.tracks) {
			expect(t.artist).toBeTruthy();
			expect(t.title).toBeTruthy();
			expect(t.mbid).toBeNull();
			// Every image passed the ONE shared Deezer allowlist binding.
			if (t.image !== null) expect(safeImageUrl(t.image, DEEZER_IMAGE_HOSTS)).toBe(t.image);
		}
	});

	it('an unknown genre (999) falls through to today’s /chart call (T-39-16 allowlist)', async () => {
		stubCache();
		const { calls } = stubUpstream([json(OVERALL)]);
		const body = (await (await callGET('genre=999&limit=50')).json()) as Body;
		expect(calls).toEqual(['https://api.deezer.com/chart']);
		expect(body.tracks.map((t) => t.title)).toEqual(['Overall Hit']);
		expect(body.artists.map((a) => a.name)).toEqual(['Someone']);
	});

	it('a bogus non-numeric genre (abc) falls through to today’s /chart call', async () => {
		stubCache();
		const { calls } = stubUpstream([json(OVERALL)]);
		await callGET('genre=abc&limit=50');
		expect(calls).toEqual(['https://api.deezer.com/chart']);
	});

	it('genre and no-genre are distinct cache keys, and a repeat genre GET is a HIT (0 extra fetches)', async () => {
		const { putKeys } = stubCache();
		const { calls } = stubUpstream([json(genreFixture), json(OVERALL)]);

		await callGET('genre=116&limit=50');
		await callGET('limit=50');
		expect(putKeys).toHaveLength(2);
		expect(putKeys[0]).not.toBe(putKeys[1]);
		expect(putKeys[0]).toContain('genre=116');
		expect(calls).toHaveLength(2);

		const again = (await (await callGET('genre=116&limit=50')).json()) as Body;
		expect(calls).toHaveLength(2); // served from the edge cache
		expect(again.artists).toEqual([]);
		expect(again.tracks[0].title).toBe('Janice STFU');
	});

	it('an upstream THROW answers { tracks: [], artists: [] } and caches nothing', async () => {
		const { putKeys } = stubCache();
		stubUpstream(['THROW']);
		const body = (await (await callGET('genre=116&limit=50')).json()) as Body;
		expect(body).toEqual({ tracks: [], artists: [] });
		expect(putKeys).toEqual([]);
	});

	it('limit still clamps the genre reshape (upstream stays the literal 50)', async () => {
		stubCache();
		const { calls } = stubUpstream([json(genreFixture)]);
		const body = (await (await callGET('genre=116&limit=2')).json()) as Body;
		expect(calls).toEqual(['https://api.deezer.com/chart/116/tracks?limit=50']);
		expect(body.tracks).toHaveLength(2);
	});
});
