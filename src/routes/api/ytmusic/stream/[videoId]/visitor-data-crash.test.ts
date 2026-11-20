// Regression test for the quick-261006-r2 crash fix in /api/ytmusic/stream/[videoId].
//
// BUG: the route called `callPlayer(videoId, await getVisitorData())` — the await ran during
// argument evaluation, OUTSIDE callPlayer's internal try/catch. A getVisitorData() throw was
// therefore a real uncaught rejection (a platform 502), not the graceful null the docstring
// promised. The fix passes the promise IN and awaits it inside the try, so a visitorData throw
// degrades to "player not OK" → 503 like any other upstream failure.
//
// Kept in its own file: the $lib/proxy/ytmusic mock below must not leak into stream.test.ts,
// whose fixtures need the REAL getVisitorData (SEARCH_URL stubbing).
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$lib/proxy/ytmusic', async (orig) => ({
	...(await orig<typeof import('$lib/proxy/ytmusic')>()),
	// The bot-gate token fetch is down — every call rejects.
	getVisitorData: vi.fn(async (_refresh?: boolean): Promise<string | null> => {
		throw new Error('visitorData down');
	})
}));

import { GET as streamGet } from './+server';
import { PLAYER_URL } from '$lib/proxy/ytmusic';
import fixture from './__fixtures__/player-response.json';

const ORIGIN = 'https://openmusic.lol';

function ev(videoId: string) {
	const url = new URL(`https://openmusic.lol/api/ytmusic/stream/${encodeURIComponent(videoId)}`);
	return {
		params: { videoId },
		url,
		request: new Request(url, { headers: { origin: ORIGIN } })
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ytmusic stream — visitorData throw is a 503, not an uncaught crash', () => {
	it('a throwing getVisitorData() resolves 503 instead of rejecting', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (u: unknown) => {
				if (String(u) === PLAYER_URL) {
					return new Response(JSON.stringify(fixture.loginRequired), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
				}
				throw new Error(`unexpected fetch: ${u}`);
			})
		);

		// Pre-fix this REJECTED with 'visitorData down' (uncaught, platform 502). Post-fix the
		// throw is caught inside callPlayer → null → not playable → refresh (also throws → null)
		// → 'player not OK' → 503, the same degraded path as any upstream failure.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await streamGet(ev('vid123') as any);
		expect(res.status).toBe(503);
		expect(await res.text()).toBe('ytmusic: player not OK');
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
	});
});
