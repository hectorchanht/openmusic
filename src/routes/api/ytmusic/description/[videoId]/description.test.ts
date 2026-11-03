import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET as descGet } from './+server';
import { PLAYER_URL, SEARCH_URL } from '$lib/proxy/ytmusic';

// quick-261024-about — the description route: gated resolve, definitive answers cache,
// a gate is a 503 and never a cached verdict.
const ORIGIN = 'https://openmusic.lol';
const DESC = '《港耆》Official MV — 導演：某君\n歌詞在下面\nhttps://example.com/credits';

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function ev(videoId: string) {
	const url = new URL(`https://openmusic.lol/api/ytmusic/description/${encodeURIComponent(videoId)}`);
	return { params: { videoId }, url, request: new Request(url, { headers: { origin: ORIGIN } }) };
}
function stubEdgeCache() {
	const store = new Map<string, Response>();
	vi.stubGlobal('caches', {
		default: {
			match: async (req: Request) => store.get(req.url)?.clone(),
			put: async (req: Request, res: Response) => void store.set(req.url, res.clone()),
			delete: async (req: Request) => store.delete(req.url)
		}
	});
	return store;
}
function stubPlayer(playerJson: unknown) {
	let calls = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (u: unknown) => {
			const s = String(u);
			if (s === SEARCH_URL) return jsonRes({ responseContext: { visitorData: 'VD' } });
			if (s === PLAYER_URL) {
				calls++;
				return jsonRes(playerJson);
			}
			throw new Error('unexpected url: ' + s);
		})
	);
	return () => calls;
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('GET /api/ytmusic/description/:videoId (quick-261024-about)', () => {
	it('returns the description and caches it; a second read makes NO player call', async () => {
		stubEdgeCache();
		const calls = stubPlayer({
			playabilityStatus: { status: 'OK' },
			videoDetails: { shortDescription: DESC }
		});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await descGet(ev('vid1') as any);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { description: string }).description).toBe(DESC);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res2 = await descGet(ev('vid1') as any);
		expect(res2.status).toBe(200);
		expect(calls()).toBe(1); // cache served the second read
	});

	it('a playable player with NO description is a definitive empty (200, cached)', async () => {
		stubEdgeCache();
		stubPlayer({ playabilityStatus: { status: 'OK' }, videoDetails: {} });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await descGet(ev('vid2') as any);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { description: string }).description).toBe('');
	});

	it('quick-261029-meta1: VISIONOS gated but an alternate client answers → 200 with its description', async () => {
		stubEdgeCache();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (u: unknown, init?: RequestInit) => {
				const s = String(u);
				if (s === SEARCH_URL) return jsonRes({ responseContext: { visitorData: 'VD' } });
				if (s === PLAYER_URL) {
					const body = JSON.parse(String(init?.body ?? '{}')) as { context?: { client?: { clientName?: string } } };
					if (body.context?.client?.clientName === 'VISIONOS')
						return jsonRes({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm' } });
					// Alternate metadata clients carry the description even while gated.
					return jsonRes({
						playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm' },
						videoDetails: { shortDescription: DESC }
					});
				}
				throw new Error('unexpected url: ' + s);
			})
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await descGet(ev('layNDqkZQnQ') as any);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { description: string }).description).toBe(DESC);
	});

	it('a gated player is a 503 with diagnostics and is NOT cached', async () => {
		const store = stubEdgeCache();
		stubPlayer({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm' } });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await descGet(ev('vid3') as any);
		expect(res.status).toBe(503);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('x-ytmusic-playability')).toBe('LOGIN_REQUIRED');
		expect([...store.keys()].filter((k) => k.includes('description'))).toHaveLength(0);
	});
});
