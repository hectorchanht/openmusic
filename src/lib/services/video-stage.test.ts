import { describe, it, expect } from 'vitest';
import { syncDecision, probeDirectVideo } from './video-stage';

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

// quick-261029-vidgate — the direct-mode preflight: a gated 503 must never reach the
// <video> element as a blind src (that is exactly what "media error 4" was).
describe('probeDirectVideo', () => {
	const noSleep = async () => {};
	function res(status: number, reason?: string): Response {
		return new Response(null, {
			status,
			headers: reason ? { 'x-ytmusic-reason': reason } : {}
		});
	}

	it('an OK range answer passes in one attempt', async () => {
		const fetchFn = async () => res(206);
		const r = await probeDirectVideo('layNDqkZQnQ', 720, { fetchFn: fetchFn as typeof fetch, sleep: noSleep });
		expect(r).toEqual({ ok: true, status: 206, kind: 'none', attempts: 1 });
	});

	it('retries a 503 gate with cache-busting and recovers', async () => {
		const urls: string[] = [];
		let n = 0;
		const fetchFn = async (u: unknown) => {
			urls.push(String(u));
			return ++n < 3 ? res(503, "Sign in to confirm you're not a bot") : res(206);
		};
		const r = await probeDirectVideo('layNDqkZQnQ', 720, { fetchFn: fetchFn as typeof fetch, sleep: noSleep });
		expect(r.ok).toBe(true);
		expect(r.attempts).toBe(3);
		expect(urls[1]).toContain('&retry=1');
		expect(urls[2]).toContain('&retry=2');
	});

	it('a persistent gate reports kind gated with the REAL reason', async () => {
		const fetchFn = async () => res(503, "Sign in to confirm you're not a bot");
		const r = await probeDirectVideo('x', 720, { fetchFn: fetchFn as typeof fetch, sleep: noSleep });
		expect(r.ok).toBe(false);
		expect(r.kind).toBe('gated');
		expect(r.reason).toContain('not a bot');
	});

	it('a 404 is definitive none — no retries burned on it', async () => {
		let n = 0;
		const fetchFn = async () => {
			n++;
			return res(404);
		};
		const r = await probeDirectVideo('x', 720, { fetchFn: fetchFn as typeof fetch, sleep: noSleep });
		expect(r.kind).toBe('none');
		expect(n).toBe(1);
	});
});
