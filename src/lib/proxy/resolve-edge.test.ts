// Unit tests for the server-side qq resolve behind /api/resolve (phase 31 D-06/D-10, retargeted
// kuwo → qq by 32-D-01 / 32-D-10).
//
// Style mirrors deezer-cover.test.ts: stub global fetch, assert the UPSTREAM URL and the
// SUBREQUEST COUNT explicitly (the count is how "this is a bounded background job" is proven —
// and under 32-D-10 the count itself is a deliverable: the fill dropped from TWO subrequests to
// ONE, because `song_mid` arrives on every qq SEARCH row and needs no detail call).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveOnEdge } from './resolve-edge';

/** The tang host `qqProxy.buildUrl` owns. Asserted, never constructed, here. */
const SEARCH_HOST = 'https://tang.api.s01s.cn/music_open_api.php';

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

		expect(entry).toEqual({ source: 'qq', songid: MID, avail: { qq: 'ok' } });
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
		expect(entry).toEqual({ source: null, songid: null, avail: { qq: 'dry' } });
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
		expect(entry).toEqual({ source: null, songid: null, avail: { qq: 'dry' } });
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
