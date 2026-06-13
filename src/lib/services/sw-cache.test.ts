import { describe, it, expect } from 'vitest';
import { shouldBypass, cacheNameFor } from './sw-cache';

const ORIGIN = 'https://music.example.com';

/** Build the structural request input shouldBypass takes (a plain { method, headers }). */
function req(method: string, headers: Record<string, string> = {}): {
	method: string;
	headers: Headers;
} {
	return { method, headers: new Headers(headers) };
}

describe('shouldBypass', () => {
	// OFFL-01 / T-24-01: non-GET requests are never cached (no stale mutations).
	it('returns true for non-GET methods (POST/HEAD/PUT/DELETE)', () => {
		for (const m of ['POST', 'HEAD', 'PUT', 'DELETE', 'PATCH']) {
			expect(shouldBypass(new URL(`${ORIGIN}/foo.js`), req(m), ORIGIN)).toBe(true);
		}
	});

	// OFFL-01 / T-24-01: same-origin /api/* never cached (no stale-auth / cross-user metadata leak).
	it('returns true for a same-origin /api/* GET request', () => {
		expect(shouldBypass(new URL(`${ORIGIN}/api/search?q=x`), req('GET'), ORIGIN)).toBe(true);
	});

	it('returns true for a same-origin /api/ path with no further segment', () => {
		expect(shouldBypass(new URL(`${ORIGIN}/api/`), req('GET'), ORIGIN)).toBe(true);
	});

	// OFFL-01 / T-24-01: ALL cross-origin requests bypass — covers every audio CDN.
	it('returns true for any cross-origin GET request (audio CDN)', () => {
		expect(shouldBypass(new URL('https://cdn.audio.net/song.mp3'), req('GET'), ORIGIN)).toBe(true);
		expect(shouldBypass(new URL('http://other.host/asset.js'), req('GET'), ORIGIN)).toBe(true);
	});

	// OFFL-01 / T-24-01: range requests (206 partial streams) are never cached.
	it('returns true when the request carries a range header', () => {
		expect(
			shouldBypass(new URL(`${ORIGIN}/track.mp3`), req('GET', { range: 'bytes=0-' }), ORIGIN)
		).toBe(true);
	});

	// The cacheable case: a same-origin, GET, non-/api/, no-range asset.
	it('returns false for a same-origin GET non-/api/ asset with no range header', () => {
		expect(shouldBypass(new URL(`${ORIGIN}/_app/immutable/chunk.js`), req('GET'), ORIGIN)).toBe(
			false
		);
		expect(shouldBypass(new URL(`${ORIGIN}/`), req('GET'), ORIGIN)).toBe(false);
	});

	// A path that merely contains "api" but does not start with /api/ is still cacheable.
	it('returns false for a same-origin path that only contains "api" mid-path', () => {
		expect(shouldBypass(new URL(`${ORIGIN}/assets/api-docs.js`), req('GET'), ORIGIN)).toBe(false);
	});
});

describe('cacheNameFor', () => {
	it("returns `cache-${version}` for a version string", () => {
		expect(cacheNameFor('abc123')).toBe('cache-abc123');
	});

	it('yields a different cache name for a different version (deploy rotates the cache)', () => {
		expect(cacheNameFor('abc123')).not.toBe(cacheNameFor('def456'));
	});
});
