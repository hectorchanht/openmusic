// Tests for the persisted resolved-audio-url cache (quick-261119-mcache).
//
// Contract (CACHE-UNTIL-DEATH, Hector 2026-11-19 — supersedes the shipped 45-min TTL): a
// successful resolve is persisted per (uid, quality tier) and served with NO age limit —
// across a "reload" (mirror reset, storage kept), at 24h, at 7d — so a replay attaches the
// SAME url and the browser media cache can hit. An entry leaves only when its url is reported
// dead via reportDeadAudioUrl (self-gating — unknown urls are a no-op) or under cap pressure.
// Tiers never leak into each other; non-https urls are never stored; the record is bounded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	getCachedAudioUrl,
	setCachedAudioUrl,
	reportDeadAudioUrl,
	__resetAudioUrlCache,
	__dropAudioUrlMirrorForTest
} from './audio-url-cache';

const DAY_MS = 24 * 60 * 60 * 1000;

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

	it('serves the persisted url (the replay hit)', () => {
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

	it('cache-until-death: still serves an entry 24h old (past the retired 45-min TTL)', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		vi.setSystemTime(1_700_000_000_000 + DAY_MS);
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBe(KUWO_URL_A);
	});

	it('cache-until-death: still serves an entry 7 days old, even across a reload', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		vi.setSystemTime(1_700_000_000_000 + 7 * DAY_MS);
		__dropAudioUrlMirrorForTest(); // a page reload a week later: storage is the only memory
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBe(KUWO_URL_A);
	});

	it('a dead-reported entry is never served again, however old it is', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		vi.setSystemTime(1_700_000_000_000 + 7 * DAY_MS);
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBe(KUWO_URL_A); // alive until reported
		reportDeadAudioUrl(KUWO_URL_A); // death is the only expiry
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBeNull();
		__dropAudioUrlMirrorForTest(); // and the eviction is persisted, not just in-memory
		expect(getCachedAudioUrl('kuwo:493469900', '320k')).toBeNull();
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

	it('a re-resolve overwrites the old url (the fresh url is the one served)', () => {
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_A);
		vi.setSystemTime(1_700_000_000_000 + 3 * DAY_MS);
		setCachedAudioUrl('kuwo:493469900', '320k', KUWO_URL_B);
		vi.setSystemTime(1_700_000_000_000 + 6 * DAY_MS);
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
