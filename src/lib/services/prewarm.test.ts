import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Track } from '$lib/sources/types';

// The ONE dependency: the shared resolve seam. Mocked so every assertion is a CALL COUNT —
// "did the pre-warm issue a resolve, and exactly how many" is the whole contract (31-D-03).
vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: vi.fn(async (t: Track) => t) }));

import { ensureTrackDetails } from '$lib/services/catalog';
import { prewarmTrack, __resetPrewarm } from './prewarm';

const resolve = vi.mocked(ensureTrackDetails);

function track(uid: string, over: Partial<Track> = {}): Track {
	const [source, songid] = uid.split(':');
	return {
		uid,
		source: source as Track['source'],
		songid,
		title: 'Song',
		artist: 'Artist',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '',
		displayIndex: 1,
		...over
	};
}

describe('prewarmTrack (31-D-03)', () => {
	beforeEach(() => {
		resolve.mockReset();
		resolve.mockImplementation(async (t: Track) => t);
		__resetPrewarm();
	});

	it('resolves the handed-in track exactly once', () => {
		prewarmTrack(track('kuwo:1'));
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(resolve.mock.calls[0][0].uid).toBe('kuwo:1');
	});

	it('does not re-issue for the same uid, even while the first resolve is still in flight', () => {
		// A never-settling resolve = permanently in flight, so a second call can only be
		// suppressed by the uid Set (the search page re-ranks 4-8× per query — Pitfall 5).
		resolve.mockImplementation(() => new Promise<Track>(() => {}));
		prewarmTrack(track('kuwo:1'));
		prewarmTrack(track('kuwo:1')); // a DIFFERENT object with the SAME uid — identity is the uid
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it('does resolve a different uid', () => {
		prewarmTrack(track('kuwo:1'));
		prewarmTrack(track('kuwo:2'));
		expect(resolve).toHaveBeenCalledTimes(2);
	});

	it('skips a track that is already resolved', () => {
		prewarmTrack(track('kuwo:1', { detailsLoaded: true, audioUrl: 'https://cdn/x.mp3' }));
		expect(resolve).not.toHaveBeenCalled();
	});

	it('is a silent no-op on a null/undefined/uid-less track', () => {
		prewarmTrack(null);
		prewarmTrack(undefined);
		prewarmTrack(track(''));
		expect(resolve).not.toHaveBeenCalled();
	});

	it('never throws or rejects when the resolve fails', async () => {
		resolve.mockRejectedValue(new Error('upstream down'));
		expect(() => prewarmTrack(track('kuwo:1'))).not.toThrow();
		// Flush the microtask queue: an unhandled rejection would surface here, not synchronously.
		await Promise.resolve();
		await Promise.resolve();
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it('__resetPrewarm clears the dedupe state', () => {
		prewarmTrack(track('kuwo:1'));
		__resetPrewarm();
		prewarmTrack(track('kuwo:1'));
		expect(resolve).toHaveBeenCalledTimes(2);
	});
});
