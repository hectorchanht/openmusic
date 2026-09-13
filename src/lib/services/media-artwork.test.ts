import { describe, it, expect, vi, afterEach } from 'vitest';
// PURE module — no runes, no $app/environment — so the node Vitest project compiles it.
import {
	resolveArtworkDataUrl,
	bytesToBase64,
	MAX_ART_BYTES
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

function imageResponse(bytes: Uint8Array, type = 'image/jpeg'): Response {
	// Response's BodyInit rejects Uint8Array<ArrayBufferLike>, and `bytes.buffer` widens to
	// ArrayBuffer | SharedArrayBuffer. Copying into a fresh ArrayBuffer types exactly, no cast.
	const body = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(body).set(bytes);
	return new Response(body, { status: 200, headers: { 'content-type': type } });
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

	it('never returns a remote URL for any outcome (the crash-shaped invariant)', async () => {
		for (const stub of [
			async () => imageResponse(PNG),
			async () => new Response('x', { status: 500 }),
			async () => {
				throw new TypeError('Failed to fetch');
			}
		]) {
			vi.stubGlobal('fetch', vi.fn(stub));
			const out = await resolveArtworkDataUrl({
				cover: 'https://cdn.example.com/a.jpg',
				title: 'T',
				artist: 'A'
			});
			expect(out === null || out.startsWith('data:')).toBe(true);
		}
	});
});
