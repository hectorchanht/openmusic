// heal.svelte.test.ts — the Heal-all run state (quick-261105-heal): claim-once, sequential
// sweep through downloadTrackWithDonor in silent-repair shape, live job counter, and the
// settled {saved,total} the Library page toasts. blob-store + download-track are mocked;
// the REAL sweep loop runs, so the per-iteration blob re-probe (skip what already healed)
// is exercised, not restated.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '$lib/sources/types';

const mocks = vi.hoisted(() => ({
	has: vi.fn(async (_uid: string) => false),
	downloadWithDonor: vi.fn(async (_t: Track, _o?: unknown) => 'saved' as string)
}));

vi.mock('$lib/services/blob-store', () => ({ blobStore: { has: mocks.has } }));
vi.mock('$lib/services/download-track', () => ({ downloadTrackWithDonor: mocks.downloadWithDonor }));

import { healDownloads } from './heal.svelte';

const mk = (n: number): Track =>
	({ uid: `qq:${n}`, source: 'qq', songid: String(n), title: `Song${n}`, artist: 'Artist' }) as Track;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.has.mockResolvedValue(false);
	mocks.downloadWithDonor.mockResolvedValue('saved');
});

describe('healDownloads.healAll (quick-261105-heal)', () => {
	it('heals every missing track via the donor download in silent-repair shape', async () => {
		const r = await healDownloads.healAll([mk(1), mk(2)]);
		expect(r).toEqual({ saved: 2, total: 2 });
		expect(mocks.downloadWithDonor).toHaveBeenCalledTimes(2);
		expect(mocks.downloadWithDonor.mock.calls[0][1]).toEqual({ save: false });
		expect(healDownloads.job).toBeNull();
	});

	it('skips a track whose blob appeared before its turn (healed elsewhere mid-run)', async () => {
		mocks.has.mockImplementation(async (uid: string) => uid === 'qq:2');
		const r = await healDownloads.healAll([mk(1), mk(2)]);
		expect(r).toEqual({ saved: 2, total: 2 }); // 1 downloaded + 1 already present
		expect(mocks.downloadWithDonor).toHaveBeenCalledTimes(1);
	});

	it('counts a failed heal as not saved and keeps going', async () => {
		mocks.downloadWithDonor.mockImplementation(async (t: Track) => (t.uid === 'qq:1' ? 'failed' : 'saved'));
		const r = await healDownloads.healAll([mk(1), mk(2)]);
		expect(r).toEqual({ saved: 1, total: 2 });
		expect(healDownloads.job).toBeNull();
	});

	it('is claim-once: a concurrent second call is a no-op, and an empty list never starts a job', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		mocks.downloadWithDonor.mockImplementation(async () => {
			await gate;
			return 'saved';
		});
		const run = healDownloads.healAll([mk(1)]);
		expect(healDownloads.job).toEqual({ done: 0, total: 1, saved: 0 });
		expect(await healDownloads.healAll([mk(2)])).toBeNull();
		release();
		expect(await run).toEqual({ saved: 1, total: 1 });
		expect(await healDownloads.healAll([])).toBeNull();
		expect(healDownloads.job).toBeNull();
	});
});
