// Unit tests for the server-side qq resolve behind /api/resolve (phase 31 D-06/D-10, retargeted
// kuwo → qq by 32-D-01 / 32-D-10).
//
// Style mirrors deezer-cover.test.ts: stub global fetch, assert the UPSTREAM URL and the
// SUBREQUEST COUNT explicitly (the count is how "this is a bounded background job" is proven —
// and under 32-D-10 the count itself is a deliverable: the fill dropped from TWO subrequests to
// ONE, because `song_mid` arrives on every qq SEARCH row and needs no detail call).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveOnEdge, resolveUrlOnEdge } from './resolve-edge';

/** The tang host `qqProxy.buildUrl` owns. Asserted, never constructed, here. */
const SEARCH_HOST = 'https://tang.api.s01s.cn/music_open_api.php';
/** Search and detail share ONE tang endpoint — only the params differ (mid = detail). */
const DETAIL_HOST = SEARCH_HOST;

const ARTIST = 'Nirvana';
const TITLE = 'Come As You Are';
const MID = '003OUlho2gk0Ny';

type Reply = Response | 'THROW' | 'NOTOK';

/** Stub fetch with one reply per call, recording every upstream URL. */
function stubFetch(replies: Reply[]) {
	const calls: string[] = [];
	let i = 0;
	const spy = vi.fn(async (url: string) => {
		calls.push(String(url));
		const reply = replies[Math.min(i++, replies.length - 1)];
		if (reply === 'THROW') throw new Error('network down');
		if (reply === 'NOTOK') return new Response('nope', { status: 404 });
		return reply.clone();
	});
	vi.stubGlobal('fetch', spy);
	return { calls, spy };
}

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});

// The qq search body is a BARE ARRAY in the common case (sources/qq.ts:158-169 tolerates both).
const SEARCH_HIT = json([
	{ song_mid: 'zzz', song_title: 'Something Else', singer_name: 'Someone' },
	{ song_mid: MID, song_title: 'Come as you are!', singer_name: '  nirvana ' }
]);
/** The {data:[…]} wrapper — the second shape the upstream is known to return. */
const SEARCH_HIT_WRAPPED = json({
	data: [{ song_mid: MID, song_title: TITLE, singer_name: ARTIST }]
});
const SEARCH_NO_MATCH = json([
	{ song_mid: 'zzz', song_title: 'Something Else', singer_name: 'Someone' }
]);

const live = () => new AbortController().signal;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('resolveOnEdge — happy path (32-D-10: ONE subrequest)', () => {
	it('a matching search row returns the qq mid entry in exactly ONE subrequest', async () => {
		const { calls, spy } = stubFetch([SEARCH_HIT]);
		const entry = await resolveOnEdge(ARTIST, TITLE, live());

		// 32-D-20: the SEARCH fill still returns a url-less positive — the url producer is
		// resolveUrlOnEdge, triggered by the route's refresh-on-read, so this stays ONE subrequest.
		expect(entry).toEqual({
			source: 'qq',
			songid: MID,
			avail: { qq: 'ok' },
			url: null,
			urlExp: null,
			urlQuality: null
		});
		// 32-D-10: the kuwo detail call is GONE. `song_mid` is on the search row, so the whole fill
		// is one subrequest — this count is the acceptance criterion, not a side observation.
		expect(spy.mock.calls).toHaveLength(1);
		expect(calls).toHaveLength(1);
		// Upstream host + param shape come from qqProxy.buildUrl, never hand-written here.
		expect(calls[0].startsWith(SEARCH_HOST)).toBe(true);
		expect(calls[0]).not.toContain('kw-api');
		// URLSearchParams serialization: a space is `+`, not %20.
		expect(calls[0]).toContain(`msg=${`${ARTIST} ${TITLE}`.replace(/ /g, '+')}`);
		expect(calls[0]).toContain('type=json');
	});

	it('accepts the {data:[…]} wrapper as well as a bare array', async () => {
		const { calls } = stubFetch([SEARCH_HIT_WRAPPED]);
		const entry = await resolveOnEdge(ARTIST, TITLE, live());
		expect(entry?.songid).toBe(MID);
		expect(calls).toHaveLength(1);
	});

	it('matches through matchKey normalization, not a literal string compare', async () => {
		// The row is `  nirvana ` / `Come as you are!` — only matchKey folding makes it equal.
		const { calls } = stubFetch([SEARCH_HIT]);
		const entry = await resolveOnEdge('NIRVANA', 'come  as-you  are', live());
		expect(entry?.songid).toBe(MID);
		expect(calls).toHaveLength(1);
	});
});

describe('resolveOnEdge — clean negative (D-06(c), the caller caches it at the SHORT TTL)', () => {
	it('rows but none matching → dry entry in exactly ONE subrequest', async () => {
		const { calls } = stubFetch([SEARCH_NO_MATCH]);
		const entry = await resolveOnEdge(ARTIST, TITLE, live());
		expect(entry).toEqual({
			source: null,
			songid: null,
			avail: { qq: 'dry' },
			url: null,
			urlExp: null,
			urlQuality: null
		});
		expect(calls).toHaveLength(1);
	});

	it('an EMPTY result list is a clean negative, not a fault — and 32-D-10a is why it is safe', async () => {
		// qq search returns 0 rows INTERMITTENTLY under load with no throw, so this branch is where
		// a false negative enters the cache. It stays a cacheable negative (a genuine "no qq
		// version" also looks like this and must cost zero repeat subrequests) — the protection is
		// the 900s TTL + the bust on the WRITE side, never a reclassification here.
		const { calls } = stubFetch([json([])]);
		const entry = await resolveOnEdge(ARTIST, TITLE, live());
		expect(entry?.avail).toEqual({ qq: 'dry' });
		expect(calls).toHaveLength(1);
	});

	it('a matching row with NO song_mid is a clean negative (nothing to cache but the miss)', async () => {
		const { calls } = stubFetch([json([{ song_title: TITLE, singer_name: ARTIST }])]);
		const entry = await resolveOnEdge(ARTIST, TITLE, live());
		expect(entry).toEqual({
			source: null,
			songid: null,
			avail: { qq: 'dry' },
			url: null,
			urlExp: null,
			urlQuality: null
		});
		expect(calls).toHaveLength(1);
	});
});

describe('resolveOnEdge — faults return null (the caller CACHES NOTHING)', () => {
	it('contract drift: neither a bare array nor {data:[…]}', async () => {
		stubFetch([json({ code: 200, msg: 'nope' })]);
		expect(await resolveOnEdge(ARTIST, TITLE, live())).toBeNull();
	});

	it('contract drift: a non-array data field', async () => {
		stubFetch([json({ data: { song_mid: MID } })]);
		expect(await resolveOnEdge(ARTIST, TITLE, live())).toBeNull();
	});

	it('a non-ok search response is a fault', async () => {
		stubFetch(['NOTOK']);
		expect(await resolveOnEdge(ARTIST, TITLE, live())).toBeNull();
	});

	it('a thrown fetch RESOLVES null — never a rejection at the exported boundary', async () => {
		stubFetch(['THROW']);
		await expect(resolveOnEdge(ARTIST, TITLE, live())).resolves.toBeNull();
	});

	it('malformed JSON is a fault, not a throw', async () => {
		stubFetch([new Response('<html>', { status: 200 })]);
		await expect(resolveOnEdge(ARTIST, TITLE, live())).resolves.toBeNull();
	});
});

describe('resolveOnEdge — bounds and abort', () => {
	it('an already-aborted signal returns null with ZERO subrequests', async () => {
		const { calls } = stubFetch([SEARCH_HIT]);
		const ac = new AbortController();
		ac.abort();
		expect(await resolveOnEdge(ARTIST, TITLE, ac.signal)).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it('an abort DURING the search discards the result instead of caching it', async () => {
		const ac = new AbortController();
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				calls.push(String(url));
				ac.abort();
				return SEARCH_HIT.clone();
			})
		);
		expect(await resolveOnEdge(ARTIST, TITLE, ac.signal)).toBeNull();
		expect(calls).toHaveLength(1);
	});

	it('empty artist AND title short-circuits with ZERO subrequests', async () => {
		const { calls } = stubFetch([SEARCH_HIT]);
		expect(await resolveOnEdge('  ', '  ', live())).toBeNull();
		expect(calls).toHaveLength(0);
	});
});


// 32-D-20 — the ONE server-side url producer. It exists because the entry's `url` must stay
// server-derived (T-31-03-03: the entry is shared, text-keyed PoP data, so a client-supplied url
// would change what everyone else plays). The rung walk is a deliberate SMALL MIRROR of
// sources/qq.ts `pickBestPlayUrl`'s lossless slice — see the comment there for why importing it is
// impossible — so these tests also pin the two exclusions that mirror costs us: `accom` (32-D-18,
// 伴奏 / .ogg, which iOS Safari cannot decode) and the untyped bare `song_play_url` fallback.
describe('resolveUrlOnEdge — the url refill (32-D-20)', () => {
	const detail = (extra: Record<string, unknown>) => json({ song_mid: MID, ...extra });

	it('fetches the tang DETAIL url exactly once — mid only, no msg (32-D-09)', async () => {
		const { calls } = stubFetch([detail({ song_play_url_sq: 'https://cdn/sq.flac' })]);
		await resolveUrlOnEdge(MID, live());

		expect(calls).toHaveLength(1);
		expect(calls[0].startsWith(DETAIL_HOST)).toBe(true);
		expect(calls[0]).toContain(`mid=${MID}`);
		expect(calls[0]).toContain('type=json');
		expect(calls[0]).not.toContain('msg=');
	});

	it('picks sq, https-upgrades it, tags it lossless and stamps a ~900s urlExp', async () => {
		stubFetch([
			detail({
				song_play_url_sq: 'http://isure6.stream.qqmusic.qq.com/sq.flac',
				song_play_url_hq: 'http://isure6.stream.qqmusic.qq.com/hq.m4a'
			})
		]);
		const before = Date.now();
		const got = await resolveUrlOnEdge(MID, live());

		// 32-D-05: an http url is mixed-content-BLOCKED on our https origin; the same host serves https.
		expect(got?.url).toBe('https://isure6.stream.qqmusic.qq.com/sq.flac');
		expect(got?.urlQuality).toBe('lossless');
		expect(got?.urlExp).toBeGreaterThanOrEqual(before + 900_000);
		expect(got?.urlExp).toBeLessThanOrEqual(Date.now() + 900_000);
	});

	it('falls to hq when sq and pq are absent', async () => {
		stubFetch([detail({ song_play_url_hq: 'https://cdn/hq.m4a' })]);
		expect((await resolveUrlOnEdge(MID, live()))?.url).toBe('https://cdn/hq.m4a');
	});

	it('NEVER picks accom or the bare song_play_url fallback (32-D-18)', async () => {
		stubFetch([
			detail({
				song_play_url_accom: 'https://cdn/accom.ogg',
				song_play_url: 'https://cdn/bare.mp3'
			})
		]);
		// accom is a different MIX in a container iOS Safari cannot decode; the bare fallback has an
		// UNKNOWN tier and this url is tier-TAGGED, so neither may be served as a 'lossless' url.
		expect(await resolveUrlOnEdge(MID, live())).toBeNull();
	});

	it('an all-null 200 "bad mid" body is null — the liveness guard is song_mid, never res.ok', async () => {
		stubFetch([json({ song_mid: null, song_play_url_sq: null })]);
		expect(await resolveUrlOnEdge(MID, live())).toBeNull();
	});

	it('a network throw, a non-ok response and malformed JSON all RESOLVE null (never-throw)', async () => {
		stubFetch(['THROW']);
		await expect(resolveUrlOnEdge(MID, live())).resolves.toBeNull();
		stubFetch(['NOTOK']);
		await expect(resolveUrlOnEdge(MID, live())).resolves.toBeNull();
		stubFetch([new Response('<html>', { status: 200 })]);
		await expect(resolveUrlOnEdge(MID, live())).resolves.toBeNull();
	});

	it('an already-aborted signal and a blank mid both cost ZERO subrequests', async () => {
		const ac = new AbortController();
		ac.abort();
		const aborted = stubFetch([detail({ song_play_url_sq: 'https://cdn/sq.flac' })]);
		expect(await resolveUrlOnEdge(MID, ac.signal)).toBeNull();
		expect(aborted.calls).toHaveLength(0);

		const blank = stubFetch([detail({ song_play_url_sq: 'https://cdn/sq.flac' })]);
		expect(await resolveUrlOnEdge('  ', live())).toBeNull();
		expect(blank.calls).toHaveLength(0);
	});
});
