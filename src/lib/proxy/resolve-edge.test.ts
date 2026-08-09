// Unit tests for the server-side kuwo resolve behind /api/resolve (phase 31, D-06/D-10).
//
// Style mirrors deezer-cover.test.ts: stub global fetch, assert the UPSTREAM URL and the
// SUBREQUEST COUNT explicitly (the count is how "this is a bounded background job" is proven).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveOnEdge } from './resolve-edge';

const SEARCH_HOST = 'https://kw-api.cenguigui.cn/';

const ARTIST = 'Nirvana';
const TITLE = 'Come As You Are';

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

const SEARCH_HIT = json({
	code: 200,
	data: [
		{ rid: 999, name: 'Something Else', artist: 'Someone', album: '', pic: '' },
		{ rid: 4212, name: 'Come as you are!', artist: '  nirvana ', album: 'Nevermind', pic: 'p' }
	]
});
const SEARCH_NO_MATCH = json({
	code: 200,
	data: [{ rid: 999, name: 'Something Else', artist: 'Someone' }]
});
const DETAIL_HIT = json({
	code: 200,
	data: { name: 'Come As You Are', artist: 'Nirvana', url: 'https://cdn.kuwo/a.mp3' }
});

const live = () => new AbortController().signal;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('resolveOnEdge — happy path', () => {
	it('a matching search row proceeds to detail and returns an ok entry in TWO subrequests', async () => {
		const { calls } = stubFetch([SEARCH_HIT, DETAIL_HIT]);
		const entry = await resolveOnEdge(ARTIST, TITLE, live());

		expect(entry).toEqual({
			source: 'kuwo',
			songid: '4212',
			url: 'https://cdn.kuwo/a.mp3',
			avail: { kuwo: 'ok' }
		});
		expect(calls).toHaveLength(2);
		// Upstream host + param shape come from kuwoProxy.buildUrl, never hand-written here.
		expect(calls[0].startsWith(SEARCH_HOST)).toBe(true);
		expect(calls[0]).toContain(`name=${encodeURIComponent(`${ARTIST} ${TITLE}`)}`);
		expect(calls[0]).toContain('limit=10');
		expect(calls[1]).toContain('id=4212');
		expect(calls[1]).toContain('type=song');
	});

	it('matches through matchKey normalization, not a literal string compare', async () => {
		// The row is `  nirvana ` / `Come as you are!` — only matchKey folding makes it equal.
		const { calls } = stubFetch([SEARCH_HIT, DETAIL_HIT]);
		const entry = await resolveOnEdge('NIRVANA', 'come  as-you  are', live());
		expect(entry?.songid).toBe('4212');
		expect(calls).toHaveLength(2);
	});
});

describe('resolveOnEdge — clean negative (D-06(c), the caller CACHES this)', () => {
	it('rows but none matching → dry entry in exactly ONE subrequest', async () => {
		const { calls } = stubFetch([SEARCH_NO_MATCH]);
		const entry = await resolveOnEdge(ARTIST, TITLE, live());
		expect(entry).toEqual({ source: null, songid: null, url: null, avail: { kuwo: 'dry' } });
		expect(calls).toHaveLength(1);
	});

	it('an EMPTY result list is also a clean negative, not a fault', async () => {
		const { calls } = stubFetch([json({ code: 200, data: [] })]);
		const entry = await resolveOnEdge(ARTIST, TITLE, live());
		expect(entry?.avail).toEqual({ kuwo: 'dry' });
		expect(calls).toHaveLength(1);
	});
});

describe('resolveOnEdge — faults return null (the caller CACHES NOTHING)', () => {
	it('search contract drift: code !== 200', async () => {
		stubFetch([json({ code: 500, data: [] })]);
		expect(await resolveOnEdge(ARTIST, TITLE, live())).toBeNull();
	});

	it('search contract drift: non-array data', async () => {
		stubFetch([json({ code: 200, data: { rid: 1 } })]);
		expect(await resolveOnEdge(ARTIST, TITLE, live())).toBeNull();
	});

	it('detail contract drift: code !== 200', async () => {
		stubFetch([SEARCH_HIT, json({ code: 404 })]);
		expect(await resolveOnEdge(ARTIST, TITLE, live())).toBeNull();
	});

	it('detail contract drift: missing data', async () => {
		stubFetch([SEARCH_HIT, json({ code: 200 })]);
		expect(await resolveOnEdge(ARTIST, TITLE, live())).toBeNull();
	});

	it('detail with a falsy url is a FAULT, never a cacheable entry', async () => {
		stubFetch([SEARCH_HIT, json({ code: 200, data: { name: 'x', url: '' } })]);
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
		const { calls } = stubFetch([SEARCH_HIT, DETAIL_HIT]);
		const ac = new AbortController();
		ac.abort();
		expect(await resolveOnEdge(ARTIST, TITLE, ac.signal)).toBeNull();
		expect(calls).toHaveLength(0);
	});

	it('an abort DURING the search short-circuits before the detail call', async () => {
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
