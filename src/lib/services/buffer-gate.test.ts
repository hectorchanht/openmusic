import { describe, it, expect, vi } from 'vitest';
import {
	SLOW_BUFFER_TARGET_SEC,
	SLOW_BUFFER_TIMEOUT_MS,
	SLOW_RESUME_TARGET_SEC,
	SLOW_RESUME_TIMEOUT_MS,
	isSlowBufferSource,
	shouldBufferGate,
	bufferedAheadSec,
	bufferedToEnd,
	waitForBufferGate,
	type BufferGateElement
} from './buffer-gate';

/** TimeRanges-like fake with mutable ranges. */
function ranges(list: Array<[number, number]>) {
	return {
		length: list.length,
		start: (i: number) => list[i][0],
		end: (i: number) => list[i][1]
	};
}

function elWith(
	r: Array<[number, number]>,
	extra: Partial<BufferGateElement> = {}
): BufferGateElement {
	return { buffered: ranges(r), currentTime: 0, duration: 300, readyState: 2, ...extra };
}

describe('buffer-gate — slow source classification', () => {
	it('treats the China-CDN sources as slow (incl. gdnetease = same 126.net CDN as netease)', () => {
		for (const s of ['kuwo', 'qq', 'netease', 'gdnetease', 'joox', 'kugou', 'migu'])
			expect(isSlowBufferSource(s)).toBe(true);
	});

	it('does NOT treat global-CDN / local sources as slow', () => {
		for (const s of ['ytmusic', 'audius', 'bilibili', 'jamendo', 'archive', 'bandcamp', 'fivesing', 'suyin', 'ccmixter'])
			expect(isSlowBufferSource(s)).toBe(false);
		expect(isSlowBufferSource(null)).toBe(false);
		expect(isSlowBufferSource(undefined)).toBe(false);
		expect(isSlowBufferSource('device')).toBe(false);
	});
});

describe('buffer-gate — shouldBufferGate', () => {
	const url = 'https://car-er.kuwo.cn/x/track.mp3';
	it('gates a fresh remote play of a slow source (url + direct-url)', () => {
		expect(shouldBufferGate({ source: 'kuwo', kind: 'url', src: url })).toBe(true);
		expect(shouldBufferGate({ source: 'qq', kind: 'direct-url', src: url })).toBe(true);
		expect(shouldBufferGate({ source: 'netease', kind: 'url', src: 'https://m801.music.126.net/x.mp3' })).toBe(true);
	});

	it('never gates blobs — downloads / prebuffer / device bytes are instant', () => {
		expect(shouldBufferGate({ source: 'kuwo', kind: 'download-blob', src: 'blob:abc' })).toBe(false);
		expect(shouldBufferGate({ source: 'kuwo', kind: 'prebuffer-blob', src: 'blob:abc' })).toBe(false);
		// Even mislabelled: a blob: src is local by construction.
		expect(shouldBufferGate({ source: 'kuwo', kind: 'url', src: 'blob:abc' })).toBe(false);
	});

	it('never gates a fast source, even remote', () => {
		expect(shouldBufferGate({ source: 'ytmusic', kind: 'url', src: url })).toBe(false);
		expect(shouldBufferGate({ source: 'audius', kind: 'direct-url', src: url })).toBe(false);
	});
});

describe('buffer-gate — bufferedAheadSec / bufferedToEnd', () => {
	it('measures the range covering the playhead', () => {
		expect(bufferedAheadSec(elWith([[0, 42]]))).toBe(42);
		expect(bufferedAheadSec(elWith([[0, 42]], { currentTime: 10 }))).toBe(32);
		expect(bufferedAheadSec(elWith([[20, 50]], { currentTime: 0 }))).toBe(0); // gap ahead — not playable-through
		expect(bufferedAheadSec(elWith([[0.2, 30]], { currentTime: 0 }))).toBe(30); // hair-ahead range counts
		expect(bufferedAheadSec(elWith([]))).toBe(0);
		expect(bufferedAheadSec(null)).toBe(0);
		expect(bufferedAheadSec({})).toBe(0);
	});

	it('bufferedToEnd only for a finite duration reached by a range', () => {
		expect(bufferedToEnd(elWith([[0, 300]]))).toBe(true);
		expect(bufferedToEnd(elWith([[0, 100]]))).toBe(false);
		expect(bufferedToEnd(elWith([[0, 300]], { duration: NaN }))).toBe(false);
	});
});

describe('buffer-gate — resume hysteresis constants', () => {
	it('resume threshold sits well above a sliver but below the initial gate, with a finite timeout', () => {
		// The hysteresis gap IS the fix: resume too low = the stop-start loop
		// survives; resume at the full initial target = needless mid-song waits.
		expect(SLOW_RESUME_TARGET_SEC).toBeGreaterThanOrEqual(10);
		expect(SLOW_RESUME_TARGET_SEC).toBeLessThan(SLOW_BUFFER_TARGET_SEC);
		expect(SLOW_RESUME_TIMEOUT_MS).toBeGreaterThan(0);
		expect(SLOW_RESUME_TIMEOUT_MS).toBeLessThanOrEqual(SLOW_BUFFER_TIMEOUT_MS);
	});

	it('the same wait releases a mid-song resume only once the healthy threshold is back', async () => {
		const el = elWith([[0, 1]]); // the sliver the browser would resume on
		let slept = 0;
		const sleep = async () => {
			slept++;
			if (slept === 2) (el as { buffered: unknown }).buffered = ranges([[0, SLOW_RESUME_TARGET_SEC + 2]]);
		};
		await expect(
			waitForBufferGate(el, { targetSec: SLOW_RESUME_TARGET_SEC, timeoutMs: SLOW_RESUME_TIMEOUT_MS, sleep, pollMs: 1 })
		).resolves.toBe('ready');
		expect(slept).toBe(2);
	});
});

describe('buffer-gate — waitForBufferGate', () => {
	it('resolves ready IMMEDIATELY when the buffer already covers the target (cached / repeat play)', async () => {
		const el = elWith([[0, SLOW_BUFFER_TARGET_SEC + 5]]);
		await expect(waitForBufferGate(el, { sleep: () => Promise.resolve() })).resolves.toBe('ready');
	});

	it('resolves ready for a short track buffered to its end (can never hold the target)', async () => {
		const el = elWith([[0, 20]], { duration: 20 });
		await expect(waitForBufferGate(el)).resolves.toBe('ready');
	});

	it('resolves ready on HAVE_ENOUGH_DATA even below the numeric target', async () => {
		const el = elWith([[0, 5]], { readyState: 4 });
		await expect(waitForBufferGate(el)).resolves.toBe('ready');
	});

	it('WAITS while the head start is thin, then releases when the buffer fills (slow source first play)', async () => {
		const el = elWith([[0, 3]]);
		let slept = 0;
		const sleep = async () => {
			slept++;
			// CDN delivers: after 3 polls the element holds the full target.
			if (slept === 3) (el as { buffered: unknown }).buffered = ranges([[0, SLOW_BUFFER_TARGET_SEC + 1]]);
		};
		await expect(waitForBufferGate(el, { sleep, pollMs: 1 })).resolves.toBe('ready');
		expect(slept).toBe(3);
	});

	it('releases on the hard timeout with whatever is buffered — a dead CDN never hangs playback', async () => {
		vi.useFakeTimers();
		try {
			const el = elWith([[0, 2]]); // never grows
			const p = waitForBufferGate(el);
			await vi.advanceTimersByTimeAsync(SLOW_BUFFER_TIMEOUT_MS + 500);
			await expect(p).resolves.toBe('timeout');
		} finally {
			vi.useRealTimers();
		}
	});

	it('releases at once on an element error (the player failover chain owns dead bytes)', async () => {
		const listeners = new Map<string, () => void>();
		const el: BufferGateElement = {
			...elWith([[0, 1]]),
			addEventListener: (t, cb) => listeners.set(t, cb),
			removeEventListener: (t) => listeners.delete(t)
		};
		const p = waitForBufferGate(el, { sleep: () => new Promise((r) => setTimeout(r, 5)) });
		listeners.get('error')?.();
		await expect(p).resolves.toBe('error');
	});

	it('aborts as superseded when a newer play takes over', async () => {
		const el = elWith([[0, 1]]);
		await expect(
			waitForBufferGate(el, { isSuperseded: () => true, sleep: () => Promise.resolve() })
		).resolves.toBe('superseded');
	});

	it('an element with no observable buffer resolves ready at once (never a hang)', async () => {
		await expect(waitForBufferGate({})).resolves.toBe('ready');
		await expect(waitForBufferGate(null)).resolves.toBe('ready');
	});
});
