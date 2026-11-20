// Tests for the client-side direct-URL resolve cache (quick-261006-r2).
//
// Contract: successful resolves are memoized for 10 minutes keyed by source+songid; a URL is NEVER
// served past the TTL; a dead URL is invalidated via reportDeadDirectUrl (self-gating — unknown
// URLs are a no-op); keys never leak into each other; the map is bounded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	getCachedDirectUrl,
	setCachedDirectUrl,
	invalidateDirectUrl,
	reportDeadDirectUrl,
	__resetDirectUrlCache
} from './direct-url-cache';

const NETEASE_URL = 'https://m801.music.126.net/song.mp3?id=1';
const AUDIUS_URL = 'https://storage.googleapis.com/audius-files/x.mp3?sig=abc';

beforeEach(() => {
	__resetDirectUrlCache();
	vi.useFakeTimers();
	vi.setSystemTime(1_000_000);
});

afterEach(() => {
	__resetDirectUrlCache();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('direct-url-cache', () => {
	it('misses on an empty cache', () => {
		expect(getCachedDirectUrl('netease', '1')).toBeNull();
	});

	it('serves a cached URL within the TTL', () => {
		setCachedDirectUrl('netease', '1', NETEASE_URL);
		expect(getCachedDirectUrl('netease', '1')).toBe(NETEASE_URL);
	});

	it('never serves a URL past the 10-minute TTL', () => {
		setCachedDirectUrl('netease', '1', NETEASE_URL);
		vi.setSystemTime(1_000_000 + 10 * 60 * 1000 - 1); // 1ms before expiry
		expect(getCachedDirectUrl('netease', '1')).toBe(NETEASE_URL);
		vi.setSystemTime(1_000_000 + 10 * 60 * 1000); // at expiry
		expect(getCachedDirectUrl('netease', '1')).toBeNull();
		vi.setSystemTime(1_000_000 + 60 * 60 * 1000); // well past
		expect(getCachedDirectUrl('netease', '1')).toBeNull();
	});

	it('re-caching refreshes the TTL', () => {
		setCachedDirectUrl('netease', '1', NETEASE_URL);
		vi.setSystemTime(1_000_000 + 9 * 60 * 1000);
		setCachedDirectUrl('netease', '1', NETEASE_URL);
		vi.setSystemTime(1_000_000 + 11 * 60 * 1000); // past the FIRST expiry, inside the second
		expect(getCachedDirectUrl('netease', '1')).toBe(NETEASE_URL);
	});

	it('invalidateDirectUrl drops the entry by key', () => {
		setCachedDirectUrl('netease', '1', NETEASE_URL);
		invalidateDirectUrl('netease', '1');
		expect(getCachedDirectUrl('netease', '1')).toBeNull();
	});

	it('reportDeadDirectUrl drops the entry by URL (playback/download error path)', () => {
		setCachedDirectUrl('netease', '1', NETEASE_URL);
		reportDeadDirectUrl(NETEASE_URL);
		expect(getCachedDirectUrl('netease', '1')).toBeNull();
	});

	it('reportDeadDirectUrl is a no-op for a URL the cache never served (self-gating)', () => {
		setCachedDirectUrl('netease', '1', NETEASE_URL);
		expect(() => reportDeadDirectUrl('https://cdn.example/unrelated.mp3')).not.toThrow();
		expect(() => reportDeadDirectUrl('')).not.toThrow();
		// the real entry is untouched
		expect(getCachedDirectUrl('netease', '1')).toBe(NETEASE_URL);
	});

	it('keys do not leak: same id on another source, same source on another id', () => {
		setCachedDirectUrl('netease', '1', NETEASE_URL);
		setCachedDirectUrl('audius', '1', AUDIUS_URL);
		setCachedDirectUrl('netease', '2', NETEASE_URL);
		// invalidate one key…
		invalidateDirectUrl('netease', '1');
		expect(getCachedDirectUrl('netease', '1')).toBeNull();
		// …the others survive
		expect(getCachedDirectUrl('audius', '1')).toBe(AUDIUS_URL);
		expect(getCachedDirectUrl('netease', '2')).toBe(NETEASE_URL);
		// a URL-based report only kills the entries that served THAT url
		reportDeadDirectUrl(AUDIUS_URL);
		expect(getCachedDirectUrl('audius', '1')).toBeNull();
		expect(getCachedDirectUrl('netease', '2')).toBe(NETEASE_URL);
	});

	it('is bounded: the oldest entry is evicted past the cap', () => {
		for (let i = 0; i < 64; i++) setCachedDirectUrl('netease', String(i), `${NETEASE_URL}&n=${i}`);
		setCachedDirectUrl('netease', '64', `${NETEASE_URL}&n=64`);
		expect(getCachedDirectUrl('netease', '0')).toBeNull(); // oldest evicted
		expect(getCachedDirectUrl('netease', '1')).toContain('n=1');
		expect(getCachedDirectUrl('netease', '64')).toContain('n=64');
	});
});
