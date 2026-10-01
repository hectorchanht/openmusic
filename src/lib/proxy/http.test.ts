import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { corsHeaders, fetchWithHeadDeadline } from './http';

describe('corsHeaders (T-01-02 — never an open relay)', () => {
	it('echoes an allowed own-origin, never `*`', () => {
		const h = corsHeaders('https://openmusic.lol');
		expect(h['Access-Control-Allow-Origin']).toBe('https://openmusic.lol');
		// the scoped origin must NOT be the wildcard
		expect(h['Access-Control-Allow-Origin']).not.toBe('*');
	});

	it('allows localhost dev origins', () => {
		expect(corsHeaders('http://localhost:5173')['Access-Control-Allow-Origin']).toBe(
			'http://localhost:5173'
		);
	});

	it('allows CF preview subdomains of openmusic.lol', () => {
		const o = 'https://abc123.openmusic.lol';
		expect(corsHeaders(o)['Access-Control-Allow-Origin']).toBe(o);
	});

	it('emits NO Access-Control-Allow-Origin for a disallowed origin (never `*` fallback)', () => {
		const h = corsHeaders('https://evil.example.com');
		expect(h['Access-Control-Allow-Origin']).toBeUndefined();
		// never falls back to wildcard for ANY value in the header map
		expect(Object.values(h)).not.toContain('*');
	});

	it('emits NO Access-Control-Allow-Origin when origin is null', () => {
		const h = corsHeaders(null);
		expect(h['Access-Control-Allow-Origin']).toBeUndefined();
		expect(Object.values(h)).not.toContain('*');
	});

	it('advertises Authorization in Allow-Headers without widening origin trust (T-33-06/T-33-10)', () => {
		// https://localhost is the Capacitor WebView origin that preflights the bearer POST.
		const allowed = corsHeaders('https://localhost')['Access-Control-Allow-Headers']
			.split(',')
			.map((h) => h.trim());
		// The fix must ADD, not replace — Range in particular carries audio seeking.
		expect(allowed).toContain('Authorization');
		expect(allowed).toContain('Content-Type');
		expect(allowed).toContain('Range');
		// Advertising a header must not make a foreign origin allowed.
		expect(corsHeaders('https://evil.example.com')['Access-Control-Allow-Origin']).toBeUndefined();
	});

	it('always sets Vary: Origin so caches do not cross-pollinate', () => {
		expect(corsHeaders('https://openmusic.lol').Vary).toBe('Origin');
	});
});

// quick-260930-x3q: the catch-all's AbortSignal.timeout(8000) covered the whole streamed body, so
// netease /url audio truncated at exactly 8.00 s. A media body must stream past the head deadline;
// a JSON body must not.
describe('fetchWithHeadDeadline (quick-260930-x3q)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const abortErr = () => new DOMException('Aborted', 'AbortError');

	/** Fetch stub honouring init.signal: answers headers at once, body stalls ~200 ms mid-stream. */
	function stubStalledBody(contentType: string) {
		vi.stubGlobal('fetch', async (_url: string, init: RequestInit = {}) => {
			const signal = init.signal;
			if (signal?.aborted) throw abortErr();
			const body = new ReadableStream<Uint8Array>({
				start(c) {
					signal?.addEventListener('abort', () => {
						try {
							c.error(abortErr());
						} catch {
							/* already closed */
						}
					});
					c.enqueue(new Uint8Array([1]));
					setTimeout(() => {
						if (signal?.aborted) return;
						c.enqueue(new Uint8Array([2]));
						c.close();
					}, 200);
				}
			});
			return new Response(body, { status: 200, headers: { 'content-type': contentType } });
		});
	}

	it('streams a media body to completion past the deadline', async () => {
		stubStalledBody('audio/mpeg');
		const res = await fetchWithHeadDeadline('https://up.example/a', 50, 2);
		const buf = new Uint8Array(await res.arrayBuffer());
		expect([...buf]).toEqual([1, 2]);
	});

	it('still bounds a JSON body by the deadline', async () => {
		stubStalledBody('application/json');
		const res = await fetchWithHeadDeadline('https://up.example/j', 50, 2);
		await expect(res.arrayBuffer()).rejects.toThrow();
	});

	it('rejects when headers never arrive within the deadline', async () => {
		vi.stubGlobal(
			'fetch',
			(_url: string, init: RequestInit = {}) =>
				new Promise((_res, rej) => {
					if (init.signal?.aborted) return rej(abortErr());
					init.signal?.addEventListener('abort', () => rej(abortErr()));
				})
		);
		await expect(fetchWithHeadDeadline('https://up.example/h', 50, 2)).rejects.toThrow();
	});

	it('the catch-all route uses it instead of a whole-response timeout', () => {
		const src = readFileSync('src/routes/api/[source]/[...path]/+server.ts', 'utf8');
		expect(src).toContain('fetchWithHeadDeadline(upstream');
		expect(src).not.toContain('AbortSignal.timeout(8000)');
	});
});
