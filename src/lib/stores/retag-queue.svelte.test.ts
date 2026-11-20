// retag-queue store — the persistent background retag queue (2026-10-06, Hector).
// Pins: enqueue persists + drains sequentially; a killed session resumes via resume();
// per-file outcomes are terminal (a processed entry never re-runs); cancel/supersede works.
//
// quick-261020-rtg pins: pause keeps the persisted queue + resume continues it; the consent gate
// asks on boot-resume when device entries are pending (never when none); a denied batch drops the
// device entries (no per-file dialog fallthrough); a mid-run 'denied' re-batches consent ONCE.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const retagOne = vi.hoisted(() => vi.fn(async (): Promise<import('$lib/services/retag').RetagItemResult> => 'tagged'));
vi.mock('$lib/services/retag', () => ({ retagOne }));

// quick-261020-rtg: the store gates on the batch consent — mock it so tests control the answer.
// The real module would early-return true in node (not a native platform), which would make the
// denied-path tests untestable.
const requestDeviceWriteConsent = vi.hoisted(() => vi.fn(async (_uids: string[]): Promise<boolean> => true));
vi.mock('$lib/services/media-store', () => ({ requestDeviceWriteConsent }));

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
// quick-261020-rtg: `device:` uids are the imported files — the only ones the consent gate asks about.
const deviceEntry = (id: string): RetagEntry => entry(`device:${id}`);

function tick(ms = 10): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

async function drain(): Promise<void> {
	// The pump yields via setTimeout(0) between files; wait until it settles. The mid-run
	// 'denied' branch parks in 'paused' while it re-asks consent — that park is transient, not a
	// user pause, so keep waiting through it.
	for (let i = 0; i < 200 && (retagQueue.phase === 'running' || retagQueue.phase === 'paused'); i++)
		await tick();
}

function persistedUids(): string[] {
	return (JSON.parse(memStore.get('openmusic:retag-queue:v1')!) as RetagEntry[]).map((e) => e.uid);
}

function calledUids(): string[] {
	return retagOne.mock.calls.map((c) => ((c as unknown[])[0] as RetagEntry).uid);
}

beforeEach(async () => {
	memStore.clear();
	retagOne.mockReset();
	retagOne.mockResolvedValue('tagged');
	requestDeviceWriteConsent.mockReset();
	requestDeviceWriteConsent.mockResolvedValue(true);
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

	it('skips the consent gate when the page already asked (consentBypass)', async () => {
		retagQueue.enqueue([deviceEntry('1'), entry('u2')], { consentBypass: true });
		await drain();
		expect(requestDeviceWriteConsent).not.toHaveBeenCalled();
		expect(calledUids()).toEqual(['device:1', 'u2']);
		expect(retagQueue.lastReport).toMatchObject({ total: 2, tagged: 2 });
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

	it('asks batch consent on boot-resume when device entries are pending', async () => {
		memStore.set('openmusic:retag-queue:v1', JSON.stringify([deviceEntry('1'), entry('u2')]));
		retagQueue.resume();
		await drain();
		// THE 531-dialogs fix: the gate asks once up front instead of letting every device file
		// hit writeInPlace's per-file consent rung.
		expect(requestDeviceWriteConsent).toHaveBeenCalledTimes(1);
		expect(requestDeviceWriteConsent).toHaveBeenCalledWith(['device:1']);
		expect(calledUids()).toEqual(['device:1', 'u2']);
	});

	it('does not ask consent on boot-resume when no device entries are pending', async () => {
		memStore.set('openmusic:retag-queue:v1', JSON.stringify([entry('u1'), entry('u2')]));
		retagQueue.resume();
		await drain();
		expect(requestDeviceWriteConsent).not.toHaveBeenCalled();
		expect(retagOne).toHaveBeenCalledTimes(2);
	});

	it('drops device entries when the boot-resume batch consent is denied', async () => {
		requestDeviceWriteConsent.mockResolvedValue(false);
		memStore.set(
			'openmusic:retag-queue:v1',
			JSON.stringify([deviceEntry('1'), entry('u2'), deviceEntry('3')])
		);
		retagQueue.resume();
		await drain();
		// Only the app download ran; the device files were skipped WITHOUT per-file dialogs.
		expect(calledUids()).toEqual(['u2']);
		expect(requestDeviceWriteConsent).toHaveBeenCalledTimes(1);
		expect(retagQueue.lastReport).toMatchObject({
			total: 1,
			tagged: 1,
			skipped: { 'denied-batch': 2 }
		});
		expect(retagQueue.phase).toBe('idle');
		// Nothing left to resume — the dropped entries are gone from storage.
		expect(memStore.get('openmusic:retag-queue:v1')).toBe('[]');
	});
});

describe('pause / resume', () => {
	it('pause keeps the persisted queue and resume continues it', async () => {
		// Park the pump on the second file so the pause lands deterministically mid-run.
		let releaseSecond!: () => void;
		const secondGate = new Promise<import('$lib/services/retag').RetagItemResult>((r) => {
			releaseSecond = () => r('tagged');
		});
		retagOne.mockResolvedValueOnce('tagged').mockImplementationOnce(() => secondGate);
		retagQueue.enqueue([entry('u1'), entry('u2'), entry('u3')]);
		await tick(10);
		retagQueue.pause();
		expect(retagQueue.phase).toBe('paused');
		releaseSecond();
		await tick(30);
		// u1 counted; u2's in-flight retagOne resolved but the pump bailed on the gen guard
		// BEFORE dropping it — so u2 is still in the persisted queue, not lost.
		expect(retagQueue.done).toBe(1);
		expect(persistedUids()).toEqual(['u2', 'u3']);
		const callsAtPause = retagOne.mock.calls.length;
		await tick(30);
		// No further progress while paused.
		expect(retagOne.mock.calls.length).toBe(callsAtPause);
		expect(retagQueue.phase).toBe('paused');

		retagQueue.resume();
		expect(retagQueue.phase).toBe('running');
		await drain();
		expect(retagQueue.phase).toBe('idle');
		expect(retagQueue.done).toBe(3);
		expect(persistedUids()).toEqual([]);
	});

	it('pause is a no-op when not running', () => {
		retagQueue.pause();
		expect(retagQueue.phase).toBe('idle');
	});

	it('cancel from paused wipes the persisted queue', async () => {
		let releaseSecond!: () => void;
		const secondGate = new Promise<import('$lib/services/retag').RetagItemResult>((r) => {
			releaseSecond = () => r('tagged');
		});
		retagOne.mockResolvedValueOnce('tagged').mockImplementationOnce(() => secondGate);
		retagQueue.enqueue([entry('u1'), entry('u2')]);
		await tick(10);
		retagQueue.pause();
		releaseSecond();
		await tick(30);
		expect(retagQueue.phase).toBe('paused');
		retagQueue.cancel();
		expect(retagQueue.phase).toBe('idle');
		expect(memStore.get('openmusic:retag-queue:v1')).toBe('[]');
		// The bailed pump must NOT restart after a cancel.
		await tick(30);
		expect(retagQueue.phase).toBe('idle');
	});
});

describe("mid-run 'denied'", () => {
	it('re-asks the batch ONCE and resumes the pump when granted', async () => {
		retagOne.mockResolvedValueOnce('denied').mockResolvedValue('tagged');
		retagQueue.enqueue([deviceEntry('1'), deviceEntry('2'), entry('u3')]);
		await drain();
		// 1 gate ask + 1 mid-run re-ask for the REMAINING device files only.
		expect(requestDeviceWriteConsent).toHaveBeenCalledTimes(2);
		expect(requestDeviceWriteConsent).toHaveBeenNthCalledWith(1, ['device:1', 'device:2']);
		expect(requestDeviceWriteConsent).toHaveBeenNthCalledWith(2, ['device:2']);
		expect(calledUids()).toEqual(['device:1', 'device:2', 'u3']);
		expect(retagQueue.lastReport).toMatchObject({
			total: 3,
			tagged: 2,
			skipped: { denied: 1 }
		});
		expect(retagQueue.phase).toBe('idle');
	});

	it('drops the remaining device entries when the re-ask is denied — no per-file fallthrough', async () => {
		requestDeviceWriteConsent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		retagOne.mockResolvedValueOnce('denied').mockResolvedValue('tagged');
		retagQueue.enqueue([deviceEntry('1'), deviceEntry('2'), entry('u3'), deviceEntry('4')]);
		await drain();
		// device:2 and device:4 NEVER reached retagOne — the queue never fell through to the
		// per-file consent rung. Only one re-ask happened, not one dialog per file.
		expect(calledUids()).toEqual(['device:1', 'u3']);
		expect(requestDeviceWriteConsent).toHaveBeenCalledTimes(2);
		expect(retagQueue.lastReport).toMatchObject({
			total: 2,
			tagged: 1,
			skipped: { denied: 1, 'denied-batch': 2 }
		});
		expect(retagQueue.phase).toBe('idle');
		expect(memStore.get('openmusic:retag-queue:v1')).toBe('[]');
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
