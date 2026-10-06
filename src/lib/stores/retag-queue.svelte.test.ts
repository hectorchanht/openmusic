// retag-queue store — the persistent background retag queue (2026-10-06, Hector).
// Pins: enqueue persists + drains sequentially; a killed session resumes via resume();
// per-file outcomes are terminal (a processed entry never re-runs); cancel/supersede works.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const retagOne = vi.hoisted(() => vi.fn(async (): Promise<import('$lib/services/retag').RetagItemResult> => 'tagged'));
vi.mock('$lib/services/retag', () => ({ retagOne }));

// In-memory localStorage, same shape device-import.svelte.test.ts uses.
const memStore = new Map<string, string>();
const localStorageMock: Storage = {
	get length() {
		return memStore.size;
	},
	clear: () => void memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
	setItem: (k: string, v: string) => void memStore.set(k, v),
	removeItem: (k: string) => void memStore.delete(k),
	key: (i: number) => [...memStore.keys()][i] ?? null
};
vi.stubGlobal('localStorage', localStorageMock);

import { retagQueue } from './retag-queue.svelte';
import type { RetagEntry } from '$lib/services/retag';

const entry = (uid: string): RetagEntry => ({ uid, title: 'T', artist: 'A', album: '', cover: null });

function tick(ms = 10): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function drain(): Promise<void> {
	// The pump yields via setTimeout(0) between files; wait until it settles.
	for (let i = 0; i < 50 && retagQueue.phase === 'running'; i++) await tick();
}

beforeEach(async () => {
	memStore.clear();
	retagOne.mockReset();
	retagOne.mockResolvedValue('tagged');
	retagQueue.cancel();
	// Let any in-flight pump observe the generation bump and bail before the next test.
	await tick(20);
	vi.stubGlobal('localStorage', localStorageMock);
});

describe('enqueue', () => {
	it('persists the queue and drains it sequentially in the background', async () => {
		retagQueue.enqueue([entry('u1'), entry('u2'), entry('u3')]);
		expect(retagQueue.phase).toBe('running');
		expect(retagQueue.total).toBe(3);
		// Persisted immediately, so a kill mid-run has something to resume.
		expect(JSON.parse(memStore.get('openmusic:retag-queue:v1')!).length).toBe(3);
		await drain();
		expect(retagOne).toHaveBeenCalledTimes(3);
		expect(retagQueue.phase).toBe('idle');
		expect(retagQueue.done).toBe(3);
		expect(retagQueue.lastReport).toMatchObject({ total: 3, tagged: 3 });
		// Queue cleared from storage when empty.
		expect(memStore.get('openmusic:retag-queue:v1')).toBe('[]');
	});

	it('drops each entry from storage as it completes (crash-safe)', async () => {
		retagOne.mockResolvedValueOnce('tagged').mockResolvedValueOnce('error');
		retagQueue.enqueue([entry('u1'), entry('u2')]);
		await drain();
		// Both terminal outcomes removed the entry; nothing left to resume.
		expect(JSON.parse(memStore.get('openmusic:retag-queue:v1')!)).toEqual([]);
		expect(retagQueue.lastReport).toMatchObject({ total: 2, tagged: 1, skipped: { error: 1 } });
	});

	it('ignores entries without a uid', () => {
		retagQueue.enqueue([entry('u1'), { uid: '', title: 'x', artist: 'y', album: '', cover: null }]);
		expect(retagQueue.total).toBe(1);
	});
});

describe('resume', () => {
	it('picks up a queue left by a previous session', async () => {
		// Simulate a killed session: queue in storage, store idle.
		memStore.set('openmusic:retag-queue:v1', JSON.stringify([entry('u9'), entry('u8')]));
		retagQueue.resume();
		expect(retagQueue.phase).toBe('running');
		expect(retagQueue.total).toBe(2);
		await drain();
		expect(retagOne).toHaveBeenCalledTimes(2);
		expect(retagQueue.lastReport).toMatchObject({ total: 2, tagged: 2 });
	});

	it('is a no-op when storage is empty or corrupt', () => {
		retagQueue.resume();
		expect(retagQueue.phase).toBe('idle');
		memStore.set('openmusic:retag-queue:v1', 'not-json{{{');
		retagQueue.resume();
		expect(retagQueue.phase).toBe('idle');
		memStore.set('openmusic:retag-queue:v1', JSON.stringify([{ nope: 1 }, null]));
		retagQueue.resume();
		expect(retagQueue.phase).toBe('idle');
	});
});

describe('cancel', () => {
	it('stops the pump and clears storage', async () => {
		retagQueue.enqueue([entry('u1'), entry('u2'), entry('u3')]);
		retagQueue.cancel();
		expect(retagQueue.phase).toBe('idle');
		expect(memStore.get('openmusic:retag-queue:v1')).toBe('[]');
		await tick(30);
		// The in-flight pump bailed on the generation guard; at most the first file ran.
		expect(retagOne.mock.calls.length).toBeLessThanOrEqual(1);
	});
});
