import { describe, it, expect, vi } from 'vitest';
import type { Track } from '$lib/sources/types';
import type { DownloadResult } from '$lib/services/download-track';
import { findMissing, sweepMissing } from './sweep';

// sweep.ts (35-03, D-06/D-07) is the "re-download the songs whose bytes are missing here" loop.
// No vi.mock anywhere in this file: the module takes `has` and `download` as INJECTED deps
// precisely so it stays pure and node-testable — download-track.ts transitively imports the
// player/library/settings runes stores, which the single node Vitest project cannot load.
//
// The load-bearing assertion is "sequential, no overlap": the audio fetch inside downloadTrack is
// a RAW fetch outside the apiFetch governor, so a parallel sweep over a few hundred songs is the
// api-fetch-flood-freeze incident with multi-megabyte bodies. `peak === 1` is the regression guard.

const t = (n: number) => ({ uid: `kuwo:${n}`, source: 'kuwo', songid: String(n) }) as Track;
const tracks = [1, 2, 3, 4, 5].map(t);

/** `has` that reports the given uids as present and everything else as missing. */
const hasOnly = (...present: string[]) => vi.fn(async (uid: string) => present.includes(uid));

describe('sweepMissing', () => {
	it('skips uids whose bytes are already here and downloads the rest', async () => {
		const has = hasOnly('kuwo:1', 'kuwo:3');
		const download = vi.fn(async (): Promise<DownloadResult> => 'saved');
		const res = await sweepMissing(tracks, { has, download, delayMs: 0 });
		expect(download.mock.calls.map((c) => (c[0] as Track).uid)).toEqual(['kuwo:2', 'kuwo:4', 'kuwo:5']);
		expect(res).toEqual({ saved: 3, failed: 0, skipped: 2, stopped: false });
	});

	it('runs strictly one download at a time and re-probes per iteration', async () => {
		const log: string[] = [];
		let inflight = 0;
		let peak = 0;
		const has = vi.fn(async (uid: string) => {
			log.push(`has ${uid}`);
			return false;
		});
		const download = vi.fn(async (track: Track): Promise<DownloadResult> => {
			log.push(`download ${track.uid}`);
			inflight++;
			peak = Math.max(peak, inflight);
			await new Promise((r) => setTimeout(r, 5));
			inflight--;
			return 'saved';
		});
		await sweepMissing(tracks.slice(0, 3), { has, download, delayMs: 0 });
		expect(peak).toBe(1);
		// Interleaved, not probe-everything-then-download-everything: the per-iteration re-probe is
		// what makes a half-finished run resumable with no bookmark (D-06).
		expect(log).toEqual([
			'has kuwo:1',
			'download kuwo:1',
			'has kuwo:2',
			'download kuwo:2',
			'has kuwo:3',
			'download kuwo:3'
		]);
	});

	it('stops when the abort signal fires mid-run', async () => {
		const ctl = new AbortController();
		const has = hasOnly();
		const download = vi.fn(async (track: Track): Promise<DownloadResult> => {
			if (track.uid === 'kuwo:2') ctl.abort();
			return 'saved';
		});
		const res = await sweepMissing(tracks, { has, download, delayMs: 0, signal: ctl.signal });
		expect(download).toHaveBeenCalledTimes(2);
		expect(res.stopped).toBe(true);
		expect(res.saved).toBe(2);
	});

	it("counts 'no-audio' and a thrown download as failed", async () => {
		const results: DownloadResult[] = ['saved', 'failed', 'no-audio'];
		let i = 0;
		const download = vi.fn(async (): Promise<DownloadResult> => results[i++]);
		const res = await sweepMissing(tracks.slice(0, 3), { has: hasOnly(), download, delayMs: 0 });
		// The user needs ONE number for "did not come back" — 'no-audio' is not a separate story here.
		expect(res).toEqual({ saved: 1, failed: 2, skipped: 0, stopped: false });

		const thrower = vi.fn(async (): Promise<DownloadResult> => {
			throw new Error('boom');
		});
		const res2 = await sweepMissing(tracks.slice(0, 1), { has: hasOnly(), download: thrower, delayMs: 0 });
		expect(res2).toEqual({ saved: 0, failed: 1, skipped: 0, stopped: false });
	});

	it('reports progress once per processed track, skipped ones included', async () => {
		const onProgress = vi.fn();
		const download = vi.fn(async (): Promise<DownloadResult> => 'saved');
		await sweepMissing(tracks, { has: hasOnly('kuwo:1'), download, delayMs: 0, onProgress });
		expect(onProgress).toHaveBeenCalledTimes(5);
		expect(onProgress).toHaveBeenLastCalledWith(5, 5);
	});
});

describe('findMissing', () => {
	it('returns the absent tracks in input order', async () => {
		const missing = await findMissing(tracks, hasOnly('kuwo:1', 'kuwo:3'));
		expect(missing.map((m) => m.uid)).toEqual(['kuwo:2', 'kuwo:4', 'kuwo:5']);
	});

	it('treats a probe that throws as absent', async () => {
		const has = vi.fn(async (uid: string) => {
			if (uid === 'kuwo:2') throw new Error('idb gone');
			return true;
		});
		const missing = await findMissing(tracks, has);
		expect(missing.map((m) => m.uid)).toEqual(['kuwo:2']);
	});
});
