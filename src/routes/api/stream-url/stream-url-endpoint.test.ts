// Endpoint tests for /api/stream-url (direct-first playback URL resolver).
//
// Contract: the edge follows the source's redirect server-side and returns ONLY the
// final URL as JSON — it must NEVER pipe audio bytes. Every case below asserts on the
// JSON shape, the redirect-manual fetch posture, and the no-store cache header.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET, OPTIONS } from './+server';

const ORIGIN = 'https://openmusic.lol';

function fakeGet(search: Record<string, string>, origin: string | null = ORIGIN) {
	const url = new URL(`${ORIGIN}/api/stream-url`);
	for (const [k, v] of Object.entries(search)) url.searchParams.set(k, v);
	return {
		url,
		request: new Request(url, origin ? { headers: { origin } } : {}),
		platform: {}
	};
}

/** Stub upstream fetch. Records every call's (url, init) so the redirect posture is assertable. */
function stubUpstream(
	status: number,
	location: string | null,
	opts: { throws?: boolean } = {}
) {
	const calls: { url: string; init: RequestInit | undefined }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			if (opts.throws) throw new Error('network down');
			const headers: Record<string, string> = {};
			if (location) headers['location'] = location;
			return new Response(null, { status, headers });
		})
	);
	return { calls };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('GET /api/stream-url', () => {
	it('netease: follows the Meting 307 server-side and returns the final URL as JSON', async () => {
		const { calls } = stubUpstream(307, 'http://m8.music.126.net/song.mp3?id=123');

		const res = await GET(fakeGet({ source: 'netease', id: '123' }) as never);
		const body = (await res.json()) as { url?: string };

		expect(res.status).toBe(200);
		// Mixed-content guard: the http:// upstream Location is forced to https://.
		expect(body.url).toBe('https://m8.music.126.net/song.mp3?id=123');
		// The fetch posture is load-bearing: manual redirect (we want the header, not bytes).
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toContain('api.qijieya.cn/meting/');
		expect(calls[0].url).toContain('type=url');
		expect(calls[0].init?.redirect).toBe('manual');
	});

	it('audius: returns the 302 Location (signed GCS URL) untouched', async () => {
		stubUpstream(302, 'https://storage.googleapis.com/audius-files/x.mp3?sig=abc');

		const res = await GET(fakeGet({ source: 'audius', id: '999' }) as never);
		const body = (await res.json()) as { url?: string };

		expect(res.status).toBe(200);
		expect(body.url).toBe('https://storage.googleapis.com/audius-files/x.mp3?sig=abc');
	});

	it('rejects an unknown source with 400', async () => {
		const { calls } = stubUpstream(302, 'https://x.example/y.mp3');

		const res = await GET(fakeGet({ source: 'spotify', id: '1' }) as never);

		expect(res.status).toBe(400);
		expect(calls).toHaveLength(0); // allowlist — no upstream call for an unknown source
	});

	it('rejects a missing id with 400', async () => {
		const res = await GET(fakeGet({ source: 'netease', id: '' }) as never);
		expect(res.status).toBe(400);
	});

	it('502s when the upstream does not redirect (no Location header)', async () => {
		stubUpstream(200, null);

		const res = await GET(fakeGet({ source: 'netease', id: '123' }) as never);
		const body = (await res.json()) as { error?: string };

		expect(res.status).toBe(502);
		expect(body.error).toBe('no redirect');
	});

	it('502s when the upstream fetch throws', async () => {
		stubUpstream(500, null, { throws: true });

		const res = await GET(fakeGet({ source: 'audius', id: '999' }) as never);

		expect(res.status).toBe(502);
	});

	it('never caches: no-store on success', async () => {
		stubUpstream(307, 'https://m8.music.126.net/song.mp3');

		const res = await GET(fakeGet({ source: 'netease', id: '123' }) as never);

		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('emits the allowlisted CORS origin (never *)', async () => {
		stubUpstream(307, 'https://m8.music.126.net/song.mp3');

		const res = await GET(fakeGet({ source: 'netease', id: '123' }) as never);

		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
	});

	it('OPTIONS answers the CORS preflight', async () => {
		const res = await OPTIONS({
			request: new Request(`${ORIGIN}/api/stream-url`, { headers: { origin: ORIGIN } })
		} as never);
		expect(res.status).toBe(204);
	});
});
