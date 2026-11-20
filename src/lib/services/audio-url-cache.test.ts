// Tests for the persisted resolved-audio-url cache (quick-261119-mcache).
//
// Contract: a successful resolve is persisted per (uid, quality tier) and served inside the
// 45-min TTL — across a "reload" (mirror reset, storage kept) — so a replay attaches the SAME
// url and the browser media cache can hit. Past the TTL it is never served. A dead url is
// evicted via reportDeadAudioUrl (self-gating — unknown urls are a no-op). Tiers never leak
// into each other; non-https urls are never stored; the record is bounded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	getCachedAudioUrl,
	setCachedAudioUrl,
	reportDeadAudioUrl,
	__resetAudioUrlCache,
	__dropAudioUrlMirrorForTest,
	AUDIO_URL_TTL_MS
} from './audio-url-cache';

const KUWO_URL_A = 'https://car-er.kuwo.cn/aaaa1111/6affbba9/resource/30106/trackmedia/M800002D6AwU0KgO4w.mp3';
const KUWO_URL_B = 'https://car-lv.kuwo.cn/bbbb2222/6affbbbd/resource/30106/trackmedia/M5000000MxZk0noO3l.mp3';

// Minimal in-memory localStorage stub (the cover-cache.test.ts pattern — no jsdom).
function stubLocalStorage() {
	const map = new Map<string, string>();
	const stub = {
		getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
		setItem: (k: string, v: string) => void map.set(k, String(v)),
		removeItem: (k: string) => void map.delete(k),
		clear: () => map.clear(),
		key: (i: number) => [...map.keys()][i] ?? null,
		get length() {
			return map.size;
		}
	} as Storage;
	(globalThis as { localStorage?: Storage }).localStorage = stub;
	return map;
}

let store: Map<string, string>;
const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

beforeEach(() => {
	store = stubLocalStorage();
	__resetAudioUrlCache();
	vi.useFakeTimers();
	vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
	__resetAudioUrlCache();
	(globalThis as { localStorage?: Storage }).localStorage = originalLocalStorage;
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('audio-url-cache', () => {
	it('misses on an empty cache', () => {
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBeNull();
	});

	it('serves the persisted url within the TTL (the replay hit)', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBe(KUWO_URL_A);
	});

	it('survives a reload: dropping the mirror re-reads the stored entry', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		const raw = store.get('openmusic:audio-url-cache:v1');
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw!)['kuwo:493469900|320k'].u).toBe(KUWO_URL_A);
		__dropAudioUrlMirrorForTest(); // a page reload: module state gone, storage kept
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBe(KUWO_URL_A);
	});

	it('never serves a url past the TTL', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		vi.setSystemTime(1_700_000_000_000 + AUDIO_URL_TTL_MS + 1);
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBeNull();
	});

	it('serves a url one ms inside the TTL', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		vi.setSystemTime(1_700_000_000_000 + AUDIO_URL_TTL_MS - 1);
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBe(KUWO_URL_A);
	});

	it('tiers never leak: a lossless url does not serve a 320k caller', () => {
		setCachedAudioUrl('kuwo:493469900', 'zp', KUWO_URL_B);
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBeNull();
		expect(getCachedAudioUrl('kuwo:493469900', 'zp')).toBe(KUWO_URL_B);
	});

	it('uids never leak into each other', () => {
		setCachedAudioUrl('kuwo:1', '320k', KUWO_URL_A);
		expect(getCachedAudioUrl('kuwo:2', '320k')).toBeNull();
	});

	it('reportDeadAudioUrl evicts every tier serving the dead url', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		setCachedAudioUrl('kuwo:493469900', 'zp', KUWO_URL_A);
		setCachedAudioUrl('kuwo:7', '320k', KUWO_URL_B);
		reportDeadAudioUrl(KUWO_URL_A);
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBeNull();
		expect(getCachedAudioUrl('kuwo:493469900', 'zp')).toBeNull();
		expect(getCachedAudioUrl('kuwo:7', '320k')).toBe(KUWO_URL_B);
	});

	it('reportDeadAudioUrl is self-gating: an unknown url is a no-op', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		reportDeadAudioUrl('https://car-er.kuwo.cn/never-served.mp3');
		reportDeadAudioUrl('');
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBe(KUWO_URL_A);
	});

	it('never stores a non-https url', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', 'http://car-er.kuwo.cn/x.mp3');
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBeNull();
	});

	it('a re-resolve overwrites the old url and refreshes the TTL', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		vi.setSystemTime(1_700_000_000_000 + AUDIO_URL_TTL_MS - 1000);
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_B);
		vi.setSystemTime(1_700_000_000_000 + AUDIO_URL_TTL_MS + 1000);
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBe(KUWO_URL_B);
	});

	it('is bounded: oldest-written entries are evicted past the cap', () => {
		for (let i = 0; i < 140; i++) {
			vi.setSystemTime(1_700_000_000_000 + i * 1000);
			setCachedAudioUrl(`kuwo:${i}`, '320k', KUWO_URL_A);
		}
		expect(getCachedAudioUrl('kuwo:0', '320k')).toBeNull();
		expect(getCachedAudioUrl('kuwo:139', '320k')).toBe(KUWO_URL_A);
	});
});
