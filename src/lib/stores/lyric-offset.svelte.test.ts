import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetGovernor } from '$lib/services/api-base';
import { lyricOffsetKey } from '$lib/services/lyric-offset-shared';
import {
	getLyricOffset,
	setLyricOffset,
	lyricOffsetVersion,
	clearLyricOffset,
	hasLocalLyricOffset,
	getEffectiveLyricOffset,
	isSharedLyricOffset,
	ensureSharedLyricOffset,
	scheduleLyricOffsetVote,
	resetLyricOffset,
	VOTE_DEBOUNCE_MS,
	__resetSharedLyricOffsets
} from './lyric-offset.svelte';

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
		__resetSharedLyricOffsets();
		__resetGovernor();
		store = new MemStorage();
		Object.defineProperty(globalThis, 'localStorage', {
			value: store,
			configurable: true,
			writable: true
		});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
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

	// quick-260926-mzn: flipped from "0 deletes". An explicit 0 is the opt-out from a shared
	// consensus, so unset and 0 must be distinguishable — only clearLyricOffset deletes.
	it('0 (and NaN) is STORED as an explicit 0; clearLyricOffset deletes', () => {
		expect(hasLocalLyricOffset('netease:1')).toBe(false);
		setLyricOffset('netease:1', 2);
		setLyricOffset('netease:1', 0);
		expect(JSON.parse(store.getItem(KEY) as string)).toEqual({ 'netease:1': 0 });
		expect(hasLocalLyricOffset('netease:1')).toBe(true);
		setLyricOffset('netease:1', 2);
		setLyricOffset('netease:1', NaN);
		expect(JSON.parse(store.getItem(KEY) as string)).toEqual({ 'netease:1': 0 });
		expect(getLyricOffset('netease:1')).toBe(0);
		clearLyricOffset('netease:1');
		expect(JSON.parse(store.getItem(KEY) as string)).toEqual({});
		expect(hasLocalLyricOffset('netease:1')).toBe(false);
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

	// ---- quick-260926-mzn: shared consensus layer ----

	const UID = 'netease:1';
	const LRC = '[00:01.00]a';
	const LRC2 = '[00:01.00]b';

	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	const sharedFetch = (offset: number | null = 1.5) => {
		const f = vi.fn(async (..._a: unknown[]) => json({ ok: true, offset, n: 3 }));
		vi.stubGlobal('fetch', f);
		return f;
	};
	const flush = async () => {
		for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
	};
	const posts = (f: ReturnType<typeof vi.fn>) =>
		f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');

	it('effective precedence: local > shared > 0, and an explicit local 0 beats shared', async () => {
		sharedFetch(1.5);
		expect(getEffectiveLyricOffset(UID)).toBe(0);
		expect(isSharedLyricOffset(UID)).toBe(false);
		await ensureSharedLyricOffset(UID, LRC);
		expect(getEffectiveLyricOffset(UID)).toBe(1.5);
		expect(isSharedLyricOffset(UID)).toBe(true);
		setLyricOffset(UID, 2);
		expect(getEffectiveLyricOffset(UID)).toBe(2);
		expect(isSharedLyricOffset(UID)).toBe(false);
		setLyricOffset(UID, 0);
		expect(getEffectiveLyricOffset(UID)).toBe(0);
		expect(isSharedLyricOffset(UID)).toBe(false);
	});

	it('ensure writes nothing synchronously, then lands the shared value', async () => {
		sharedFetch(1.5);
		const p = ensureSharedLyricOffset(UID, LRC);
		expect(isSharedLyricOffset(UID)).toBe(false);
		await p;
		expect(getEffectiveLyricOffset(UID)).toBe(1.5);
	});

	it('ensure dedupes by (uid, lrc); a new lrc refetches; a local offset skips the fetch', async () => {
		const f = sharedFetch(1.5);
		const p = ensureSharedLyricOffset(UID, LRC);
		await ensureSharedLyricOffset(UID, LRC);
		await p;
		expect(f).toHaveBeenCalledTimes(1);
		await ensureSharedLyricOffset(UID, LRC2);
		expect(f).toHaveBeenCalledTimes(2);
		setLyricOffset('qq:2', 1);
		await ensureSharedLyricOffset('qq:2', LRC);
		expect(f).toHaveBeenCalledTimes(2);
	});

	it('ensure drops a superseded reply for the old lyrics', async () => {
		const kOld = await lyricOffsetKey(UID, LRC);
		let release: (r: Response) => void = () => {};
		const pending = new Promise<Response>((r) => (release = r));
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => (url.includes(kOld as string) ? pending : json({ ok: true, offset: 1.5, n: 3 })))
		);
		const p1 = ensureSharedLyricOffset(UID, LRC);
		const p2 = ensureSharedLyricOffset(UID, LRC2);
		await p2;
		release(json({ ok: true, offset: 9, n: 3 }));
		await p1;
		expect(getEffectiveLyricOffset(UID)).toBe(1.5);
	});

	it('a null consensus leaves nothing shared; empty uid / null lrc never fetch', async () => {
		const f = sharedFetch(null);
		await ensureSharedLyricOffset(UID, LRC);
		expect(isSharedLyricOffset(UID)).toBe(false);
		await ensureSharedLyricOffset('', LRC);
		await ensureSharedLyricOffset(UID, null);
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('the vote fires once, VOTE_DEBOUNCE_MS after the last change, with the final local value', async () => {
		expect(VOTE_DEBOUNCE_MS).toBe(4000);
		const f = sharedFetch();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		setLyricOffset(UID, 2);
		scheduleLyricOffsetVote(UID, LRC);
		await vi.advanceTimersByTimeAsync(3999);
		await flush();
		expect(posts(f)).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		await flush();
		expect(posts(f)).toHaveLength(1);
		const body = JSON.parse((posts(f)[0][1] as RequestInit).body as string);
		expect(body.k).toMatch(/^[0-9a-f]{32}$/);
		expect(body.offset).toBe(2);
	});

	it('a burst of nudges yields ONE vote with the last offset', async () => {
		const f = sharedFetch();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		for (const o of [1, 1.5, 2]) {
			setLyricOffset(UID, o);
			scheduleLyricOffsetVote(UID, LRC);
			await vi.advanceTimersByTimeAsync(1000);
		}
		await vi.advanceTimersByTimeAsync(VOTE_DEBOUNCE_MS);
		await flush();
		expect(posts(f)).toHaveLength(1);
		expect(JSON.parse((posts(f)[0][1] as RequestInit).body as string).offset).toBe(2);
	});

	it('reset inside the window cancels the vote; a cleared offset at fire time sends nothing', async () => {
		const f = sharedFetch();
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		setLyricOffset(UID, 2);
		scheduleLyricOffsetVote(UID, LRC);
		await vi.advanceTimersByTimeAsync(1000);
		resetLyricOffset(UID);
		await vi.advanceTimersByTimeAsync(10_000);
		await flush();
		expect(posts(f)).toHaveLength(0);

		setLyricOffset(UID, 2);
		scheduleLyricOffsetVote(UID, LRC);
		clearLyricOffset(UID);
		await vi.advanceTimersByTimeAsync(VOTE_DEBOUNCE_MS);
		await flush();
		expect(posts(f)).toHaveLength(0);
	});

	it('reset: local → back to shared; shared-only → explicit 0 opt-out; nothing → no-op', async () => {
		sharedFetch(1.5);
		await ensureSharedLyricOffset(UID, LRC);
		setLyricOffset(UID, 2);
		resetLyricOffset(UID);
		expect(hasLocalLyricOffset(UID)).toBe(false);
		expect(getEffectiveLyricOffset(UID)).toBe(1.5);
		expect(isSharedLyricOffset(UID)).toBe(true);

		resetLyricOffset(UID);
		expect(JSON.parse(store.getItem(KEY) as string)).toEqual({ [UID]: 0 });
		expect(getEffectiveLyricOffset(UID)).toBe(0);
		expect(isSharedLyricOffset(UID)).toBe(false);

		const before = lyricOffsetVersion();
		resetLyricOffset('qq:none');
		expect(lyricOffsetVersion()).toBe(before);
		expect(JSON.parse(store.getItem(KEY) as string)).toEqual({ [UID]: 0 });
	});
});
