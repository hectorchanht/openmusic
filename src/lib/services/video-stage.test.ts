import { describe, it, expect } from 'vitest';
import { syncDecision } from './video-stage';

// quick-261024-vid2 — the follower sync rules that replaced the freeze-prone naive loop.
describe('syncDecision — never seek into unbuffered time', () => {
	const base = { masterTime: 50, videoTime: 50, bufferedEnd: 90, masterPlaying: true };

	it('waits when the playhead is ahead of the buffer (the live freeze)', () => {
		expect(syncDecision({ ...base, masterTime: 95 }).action).toBe('wait');
		expect(syncDecision({ ...base, masterTime: 89.9 }).action).toBe('wait'); // 0.25 guard band
	});

	it('pauses when the master pauses, whatever the buffer says', () => {
		expect(syncDecision({ ...base, masterPlaying: false }).action).toBe('pause');
		expect(syncDecision({ ...base, masterPlaying: false, masterTime: 95 }).action).toBe('pause');
	});

	it('snaps on a large drift inside the buffer', () => {
		expect(syncDecision({ ...base, videoTime: 48 }).action).toBe('snap');
		expect(syncDecision({ ...base, videoTime: 52 }).action).toBe('snap');
	});

	it('nudges the rate for small drifts instead of seeking', () => {
		expect(syncDecision({ ...base, videoTime: 49.8 })).toEqual({ action: 'play', rate: 1.12 });
		expect(syncDecision({ ...base, videoTime: 50.2 })).toEqual({ action: 'play', rate: 0.88 });
		expect(syncDecision({ ...base, videoTime: 50.05 })).toEqual({ action: 'play', rate: 1 });
	});
});
