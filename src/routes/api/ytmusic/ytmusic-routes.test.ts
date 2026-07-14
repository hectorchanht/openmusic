import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET as searchGet, OPTIONS as searchOptions } from './search/+server';
import { WEB_REMIX_KEY, SEARCH_URL } from '$lib/proxy/ytmusic';

const ORIGIN = 'https://openmusic.lol';

// Minimal RequestEvent stub — the routes only read `url` + `request` (like the audius route).
function ev(path: string, params: Record<string, string>, origin: string | null = ORIGIN) {
	const url = new URL(`https://openmusic.lol${path}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	const headers = new Headers();
	if (origin) headers.set('origin', origin);
	return { url, request: new Request(url, { headers }) };
}
function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('GET /api/ytmusic/search — edge InnerTube forwarder', () => {
	// A minimal-but-valid InnerTube song shelf.
	const SHELF = {
		contents: {
			sectionListRenderer: {
				contents: [
					{ musicShelfRenderer: { contents: [{ musicResponsiveListItemRenderer: { flexColumns: [] } }] } }
				]
			}
		}
	};

	it('POSTs InnerTube edge-side and returns the envelope with allowlisted CORS', async () => {
		let capturedUrl = '';
		let capturedBody = '';
		vi.stubGlobal(
			'fetch',
			vi.fn(async (u: unknown, init?: RequestInit) => {
				capturedUrl = String(u);
				capturedBody = String(init?.body);
				return jsonRes(SHELF);
			})
		);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: '周杰倫' }) as any);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(SHELF);

		// server -> upstream: fixed SEARCH_URL, songs filter + query in the BODY only.
		expect(capturedUrl).toBe(SEARCH_URL);
		expect(capturedBody).toContain('EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D');
		expect(capturedBody).toContain('周杰倫');
		// CORS allowlisted for the requesting origin (never '*').
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
	});

	it('empty / whitespace q issues ZERO upstream fetches', async () => {
		const fetchSpy = vi.fn(async () => jsonRes(SHELF));
		vi.stubGlobal('fetch', fetchSpy);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: '   ' }) as any);
		expect(res.status).toBe(200);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('never leaks the WEB_REMIX key into the client-facing response body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonRes(SHELF))
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: 'x' }) as any);
		const body = await res.text();
		expect(body).not.toContain(WEB_REMIX_KEY);
		const headerBlob = JSON.stringify([...res.headers.entries()]);
		expect(headerBlob).not.toContain(WEB_REMIX_KEY);
	});

	it('upstream error → empty (shelf-shaped) body, no throw', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('boom', { status: 500 }))
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchGet(ev('/api/ytmusic/search', { q: 'x' }) as any);
		expect(res.status).toBe(200);
		expect(JSON.stringify(await res.json())).toContain('musicShelfRenderer');
	});

	it('OPTIONS → 204 with allowlisted corsHeaders', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await searchOptions(ev('/api/ytmusic/search', {}) as any);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
	});
});
