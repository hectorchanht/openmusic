import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getLyricOffset, setLyricOffset, lyricOffsetVersion } from './lyric-offset.svelte';

// quick-260926-mis — the per-uid lyric timing offset store, over a MemStorage stub (node, no jsdom).

const KEY = 'openmusic:lyric-offset:v1';

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
}

describe('lyric-offset store (quick-260926-mis)', () => {
	const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
	let store: MemStorage;

	beforeEach(() => {
		store = new MemStorage();
		Object.defineProperty(globalThis, 'localStorage', {
			value: store,
			configurable: true,
			writable: true
		});
	});
	afterEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: originalLocalStorage,
			configurable: true,
			writable: true
		});
	});

	it('reads 0 when nothing is stored, and for an empty / missing uid', () => {
		expect(getLyricOffset('netease:1')).toBe(0);
		expect(getLyricOffset('')).toBe(0);
		expect(getLyricOffset(undefined)).toBe(0);
		expect(getLyricOffset(null)).toBe(0);
	});

	it('stores the normalized value under the uid', () => {
		setLyricOffset('netease:1', 2.34);
		expect(getLyricOffset('netease:1')).toBe(2.3);
		expect(JSON.parse(store.getItem(KEY) as string)).toEqual({ 'netease:1': 2.3 });
	});

	it('0 (and NaN) deletes the key — only non-zero values are stored', () => {
		setLyricOffset('netease:1', 2);
		setLyricOffset('netease:1', 0);
		expect(JSON.parse(store.getItem(KEY) as string)).toEqual({});
		setLyricOffset('netease:1', 2);
		setLyricOffset('netease:1', NaN);
		expect(JSON.parse(store.getItem(KEY) as string)).toEqual({});
		expect(getLyricOffset('netease:1')).toBe(0);
	});

	it('keeps a live and a studio uid independent', () => {
		setLyricOffset('qq:live', 31.5);
		setLyricOffset('qq:studio', -1);
		expect(getLyricOffset('qq:live')).toBe(31.5);
		expect(getLyricOffset('qq:studio')).toBe(-1);
	});

	it('corrupt JSON reads as 0 and the next write overwrites cleanly', () => {
		store.setItem(KEY, '{not json');
		expect(getLyricOffset('netease:1')).toBe(0);
		setLyricOffset('netease:1', 4);
		expect(JSON.parse(store.getItem(KEY) as string)).toEqual({ 'netease:1': 4 });
	});

	it('a tampered non-number or out-of-range value is sanitised on read', () => {
		store.setItem(KEY, JSON.stringify({ a: 'abc', b: 1e9 }));
		expect(getLyricOffset('a')).toBe(0);
		expect(getLyricOffset('b')).toBe(600);
	});

	it('bumps the version synchronously, exactly once per write', () => {
		const before = lyricOffsetVersion();
		setLyricOffset('netease:1', 1);
		expect(lyricOffsetVersion()).toBe(before + 1);
		setLyricOffset('netease:1', 0);
		expect(lyricOffsetVersion()).toBe(before + 2);
	});

	it('an empty uid is a no-op — no write, no bump', () => {
		const before = lyricOffsetVersion();
		setLyricOffset('', 3);
		expect(store.getItem(KEY)).toBeNull();
		expect(lyricOffsetVersion()).toBe(before);
	});
});
