import { describe, it, expect, vi, afterEach } from 'vitest';
// PURE module — no runes, no $app/environment — so the node Vitest project compiles it.
import {
	resolveArtworkDataUrl,
	bytesToBase64,
	MAX_ART_BYTES,
	OG_MAX_ATTEMPTS
} from './media-artwork';

/**
 * quick-260913-artcrash-2. These tests exist because the failure they guard is a HARD CRASH,
 * not a missing image: @jofr/capacitor-media-session's urlToBitmap() takes a blocking
 * HttpURLConnection branch for any src starting with "http", inside a method declared
 * `throws IOException` with no try/catch, on the CapacitorPlugins HandlerThread. An uncaught
 * throw there kills the app, and restore() then replays the same cover on every relaunch.
 *
 * So the contract under test is narrow and absolute: resolveArtworkDataUrl either returns a
 * `data:` URL (the plugin's network-free ;base64, branch) or null (caller sends a sentinel the
 * plugin also cannot fetch). It must NEVER return a remote URL, and must NEVER reject.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageResponse(
	bytes: Uint8Array,
	type = 'image/jpeg',
	extraHeaders: Record<string, string> = {}
): Response {
	// Response's BodyInit rejects Uint8Array<ArrayBufferLike>, and `bytes.buffer` widens to
	// ArrayBuffer | SharedArrayBuffer. Copying into a fresh ArrayBuffer types exactly, no cast.
	const body = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(body).set(bytes);
	return new Response(body, { status: 200, headers: { 'content-type': type, ...extraHeaders } });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('bytesToBase64', () => {
	it('round-trips bytes through base64', () => {
		expect(bytesToBase64(PNG)).toBe(Buffer.from(PNG).toString('base64'));
	});

	it('handles a payload far larger than the argument-spread limit', () => {
		// String.fromCharCode(...bytes) throws on an input this size — the chunking is the point.
		const big = new Uint8Array(300_000).fill(0x41);
		expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'));
	});
});

describe('resolveArtworkDataUrl (native crash guard)', () => {
	it('passes an already-inlined data: URL straight through without fetching', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const inline = 'data:image/png;base64,AAAA';
		await expect(
			resolveArtworkDataUrl({ cover: inline, title: 'T', artist: 'A' })
		).resolves.toBe(inline);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('converts a CORS-clean https cover into a data: URL', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => imageResponse(PNG, 'image/jpeg')));
		const out = await resolveArtworkDataUrl({
			cover: 'https://cdn-images.dzcdn.net/images/cover/x/500x500.jpg',
			title: 'T',
			artist: 'A'
		});
		expect(out).toBe(`data:image/jpeg;base64,${Buffer.from(PNG).toString('base64')}`);
	});

	it('never fetches a non-https cover, and falls back to /api/og', async () => {
		// Typed parameter so mock.calls is a 1-tuple and c[0] is indexable.
		const fetchSpy = vi.fn(async (_input: unknown) => imageResponse(PNG));
		vi.stubGlobal('fetch', fetchSpy);
		await resolveArtworkDataUrl({
			cover: 'http://y.gtimg.cn/music/photo_new/T002R300x300M000.jpg',
			title: 'Boston',
			artist: 'STELLA LEFTY'
		});
		const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
		expect(urls.every((u) => !u.includes('y.gtimg.cn'))).toBe(true);
		expect(urls.some((u) => u.includes('/api/og?'))).toBe(true);
	});

	it('falls back to /api/og when the cover host has no CORS headers', async () => {
		// A CORS rejection surfaces in the WebView as a plain TypeError from fetch().
		const fetchSpy = vi.fn(async (input: unknown) => {
			if (String(input).includes('y.gtimg.cn')) throw new TypeError('Failed to fetch');
			return imageResponse(PNG, 'image/png');
		});
		vi.stubGlobal('fetch', fetchSpy);
		const out = await resolveArtworkDataUrl({
			cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000.jpg',
			title: 'Boston',
			artist: 'STELLA LEFTY'
		});
		expect(out).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
	});

	it('returns null (never throws) when the device is offline', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => {
			throw new TypeError('Failed to fetch');
		}));
		await expect(
			resolveArtworkDataUrl({ cover: 'https://cdn.example.com/a.jpg', title: 'T', artist: 'A' })
		).resolves.toBeNull();
	});

	it('returns null on a 404 rather than encoding the error body', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
		await expect(
			resolveArtworkDataUrl({ cover: 'https://cdn.example.com/a.jpg', title: 'T', artist: 'A' })
		).resolves.toBeNull();
	});

	it('rejects a non-image response (an HTML error page must never reach BitmapFactory)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () =>
			new Response('<html>error</html>', { status: 200, headers: { 'content-type': 'text/html' } })
		));
		await expect(
			resolveArtworkDataUrl({ cover: 'https://cdn.example.com/a.jpg', title: '', artist: '' })
		).resolves.toBeNull();
	});

	it('rejects an oversized image instead of pushing it across the Capacitor bridge', async () => {
		vi.stubGlobal('fetch', vi.fn(async () =>
			imageResponse(new Uint8Array(MAX_ART_BYTES + 1))
		));
		await expect(
			resolveArtworkDataUrl({ cover: 'https://cdn.example.com/a.jpg', title: '', artist: '' })
		).resolves.toBeNull();
	});

	it('returns null without calling /api/og when there is no title to query with', async () => {
		const fetchSpy = vi.fn(async (_input: unknown) => {
			throw new TypeError('Failed to fetch');
		});
		vi.stubGlobal('fetch', fetchSpy);
		await expect(
			resolveArtworkDataUrl({ cover: null, title: '   ', artist: 'A' })
		).resolves.toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	// media-card-noart-261019: the og leg retries now, so each failure-shaped stub below runs
	// its own bounded attempt loop (~3 s of backoff) — one `it` per stub keeps every test inside
	// the default 5 s timeout instead of stacking all three loops in a single test.
	it('never returns a remote URL when the cover fetch succeeds', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => imageResponse(PNG)));
		const out = await resolveArtworkDataUrl({
			cover: 'https://cdn.example.com/a.jpg',
			title: 'T',
			artist: 'A'
		});
		expect(out === null || out.startsWith('data:')).toBe(true);
	});

	it('never returns a remote URL when every fetch 500s', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
		const out = await resolveArtworkDataUrl({
			cover: 'https://cdn.example.com/a.jpg',
			title: 'T',
			artist: 'A'
		});
		expect(out === null || out.startsWith('data:')).toBe(true);
	});

	it('never returns a remote URL when every fetch throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		const out = await resolveArtworkDataUrl({
			cover: 'https://cdn.example.com/a.jpg',
			title: 'T',
			artist: 'A'
		});
		expect(out === null || out.startsWith('data:')).toBe(true);
	});
});

// quick-260914-to2 — /api/og answers a TOTAL cover miss with 200 + image/jpeg + the branded openmusic
// share card, because a crawler that gets a non-200 shows no card at all. Accepting that 200 as a
// cover stamped the app logo into no-cover downloads as FrontCover and onto the OS media card. The
// `x-og-fallback` marker is the ONLY way to tell the two apart — both are valid 200 images.
describe('resolveArtworkDataUrl — a marked /api/og fallback is NOT a cover', () => {
	it('returns null when the /api/og response carries x-og-fallback', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => imageResponse(PNG, 'image/jpeg', { 'x-og-fallback': '1' }))
		);
		await expect(resolveArtworkDataUrl({ cover: null, title: 'T', artist: 'A' })).resolves.toBeNull();
	});

	it('still returns a data: URL for an UNMARKED /api/og image', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => imageResponse(PNG, 'image/jpeg')));
		await expect(resolveArtworkDataUrl({ cover: null, title: 'T', artist: 'A' })).resolves.toBe(
			`data:image/jpeg;base64,${Buffer.from(PNG).toString('base64')}`
		);
	});

	it('never rejects on the marked path (never-throws contract)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => imageResponse(PNG, 'image/jpeg', { 'x-og-fallback': '1' }))
		);
		await expect(
			resolveArtworkDataUrl({ cover: 'https://cdn.example.com/a.jpg', title: 'T', artist: 'A' })
		).resolves.toBeNull();
	});
});

// media-card-noart-261019 — the /api/og leg is flaky by design: its edge tier chain and image
// hop run retries=0 on a crawler budget, and production-probed 2026-10-19 two identical
// requests seconds apart flip-flopped between the fallback card and a real 146 KB cover. One
// transient miss used to clear the OS media-card artwork for the whole track; the og leg now
// retries bounded before accepting the miss.
describe('resolveArtworkDataUrl — /api/og retry (media-card-noart-261019)', () => {
	it('retries after a fallback-marked response and returns the cover when it lands', async () => {
		const expected = `data:image/jpeg;base64,${Buffer.from(PNG).toString('base64')}`;
		let calls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				calls++;
				// First attempt: the transient branded-card answer; second: the real cover.
				return calls === 1
					? imageResponse(PNG, 'image/jpeg', { 'x-og-fallback': '1' })
					: imageResponse(PNG, 'image/jpeg');
			})
		);
		await expect(
			resolveArtworkDataUrl({ cover: null, title: '有誰共鳴 (Live)', artist: '張國榮' })
		).resolves.toBe(expected);
		expect(calls).toBe(2);
	});

	it('gives up after OG_MAX_ATTEMPTS marked fallbacks and returns null', async () => {
		const fetchSpy = vi.fn(async () =>
			imageResponse(PNG, 'image/jpeg', { 'x-og-fallback': '1' })
		);
		vi.stubGlobal('fetch', fetchSpy);
		await expect(
			resolveArtworkDataUrl({ cover: null, title: 'T', artist: 'A' })
		).resolves.toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(OG_MAX_ATTEMPTS);
	});

	it('does not retry the direct cover leg — one CORS failure goes straight to /api/og', async () => {
		const fetchSpy = vi.fn(async (input: unknown) => {
			if (String(input).includes('y.gtimg.cn')) throw new TypeError('Failed to fetch');
			return imageResponse(PNG, 'image/png');
		});
		vi.stubGlobal('fetch', fetchSpy);
		const out = await resolveArtworkDataUrl({
			cover: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000.jpg',
			title: 'T',
			artist: 'A'
		});
		expect(out).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
		const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
		expect(urls.filter((u) => u.includes('y.gtimg.cn'))).toHaveLength(1);
		expect(urls.filter((u) => u.includes('/api/og?'))).toHaveLength(1);
	});

	it('aborts the retry loop when isCancelled flips true mid-loop', async () => {
		let cancelled = false;
		const fetchSpy = vi.fn(async () => {
			// The track changed while the first attempt was in flight — the loop must stop here
			// instead of burning the remaining attempts (and their sleeps) on a stale track.
			cancelled = true;
			return imageResponse(PNG, 'image/jpeg', { 'x-og-fallback': '1' });
		});
		vi.stubGlobal('fetch', fetchSpy);
		await expect(
			resolveArtworkDataUrl(
				{ cover: null, title: 'T', artist: 'A' },
				{ isCancelled: () => cancelled }
			)
		).resolves.toBeNull();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('never rejects when every attempt throws (never-throws contract survives the loop)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		await expect(
			resolveArtworkDataUrl({ cover: 'https://cdn.example.com/a.jpg', title: 'T', artist: 'A' })
		).resolves.toBeNull();
	});
});
