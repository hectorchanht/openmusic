import { describe, it, expect } from 'vitest';
import {
	orderFallbackPool,
	SourceCooldowns,
	ProbeBudget,
	NS_COOLDOWN_BASE_MS,
	NS_COOLDOWN_CAP_MS,
	NS_SMALL_POOL,
	measureLocalPool,
	planBufferTopUp,
	planBufferEvictions,
	bufferTierFor,
	estimateTrackSec,
	NS_POOL_TARGET_SEC,
	NS_DEFAULT_TRACK_SEC
} from './never-stop';
import type { SourceId } from '$lib/sources/types';

// quick-261116-nstop: the pure decision core of the Never-Stop Engine. The player store
// thin-calls these; everything asserted here is a settled grill decision (Q10/Q13/Q14).

const t = (uid: string) => ({ uid });

describe('orderFallbackPool — least-recently-played rotation (Q13)', () => {
	it('never-played tracks lead, then oldest-played first', () => {
		// history is most-recent-first: 'new' played latest, 'old' earliest.
		const pool = orderFallbackPool(
			[t('new'), t('old'), t('never')],
			[],
			['new', 'mid', 'old'],
			new Set()
		);
		expect(pool.map((x) => x.uid)).toEqual(['never', 'old', 'new']);
	});

	it('played-this-cycle tracks sort after unplayed ones (no repeat until exhausted)', () => {
		const pool = orderFallbackPool(
			[t('a'), t('b'), t('c')],
			[],
			[],
			new Set(['a', 'b'])
		);
		expect(pool.map((x) => x.uid)).toEqual(['c', 'a', 'b']);
	});

	it('big Downloads pool: Cached tracks append after Downloads', () => {
		const dl = Array.from({ length: NS_SMALL_POOL }, (_, i) => t(`d${i}`));
		const pool = orderFallbackPool(dl, [t('c0'), t('c1')], [], new Set());
		expect(pool.map((x) => x.uid)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4', 'c0', 'c1']);
	});

	it('small Downloads pool: Cached tracks interleave 1:1', () => {
		const pool = orderFallbackPool([t('d0'), t('d1')], [t('c0'), t('c1'), t('c2')], [], new Set());
		expect(pool.map((x) => x.uid)).toEqual(['d0', 'c0', 'd1', 'c1', 'c2']);
	});

	it('dedupes by uid (Downloads win) and drops uid-less entries', () => {
		const pool = orderFallbackPool(
			[t('x'), { uid: '' } as { uid: string }, t('x')],
			[t('x'), t('y')],
			[],
			new Set()
		);
		expect(pool.map((x) => x.uid)).toEqual(['x', 'y']);
	});

	it('never throws on empty inputs', () => {
		expect(orderFallbackPool([], [], [], new Set())).toEqual([]);
	});
});

describe('SourceCooldowns — exponential probe cooldown (Q10)', () => {
	const src = 'netease' as SourceId;

	it('first mark cools for the base window, then becomes eligible', () => {
		const cd = new SourceCooldowns();
		cd.markFailed(src, 1_000);
		expect(cd.isCooling(src, 1_000 + NS_COOLDOWN_BASE_MS - 1)).toBe(true);
		expect(cd.isCooling(src, 1_000 + NS_COOLDOWN_BASE_MS)).toBe(false);
		expect(cd.anyEligible([src], 1_000 + NS_COOLDOWN_BASE_MS)).toBe(true);
	});

	it('each failed probe doubles the window, capped at ~15 min', () => {
		const cd = new SourceCooldowns();
		let now = 0;
		cd.markFailed(src, now); // 60s
		now += NS_COOLDOWN_BASE_MS;
		cd.markFailed(src, now); // 120s
		expect(cd.isCooling(src, now + NS_COOLDOWN_BASE_MS * 2 - 1)).toBe(true);
		expect(cd.isCooling(src, now + NS_COOLDOWN_BASE_MS * 2)).toBe(false);
		// Drive the streak high: the window must never exceed the cap.
		for (let i = 0; i < 10; i++) cd.markFailed(src, now);
		expect(cd.isCooling(src, now + NS_COOLDOWN_CAP_MS - 1)).toBe(true);
		expect(cd.isCooling(src, now + NS_COOLDOWN_CAP_MS)).toBe(false);
	});

	it('markOk recovers instantly (health-gate recordOk semantics)', () => {
		const cd = new SourceCooldowns();
		cd.markFailed(src, 0);
		cd.markOk(src);
		expect(cd.isCooling(src, 0)).toBe(false);
		expect(cd.markedSources()).toEqual([]);
	});

	it('anyEligible: one cooled-down source is enough; empty list is eligible', () => {
		const cd = new SourceCooldowns();
		const a = 'qq' as SourceId;
		const b = 'kuwo' as SourceId;
		cd.markFailed(a, 0);
		cd.markFailed(b, 0);
		expect(cd.anyEligible([a, b], 1_000)).toBe(false);
		expect(cd.anyEligible([a, b], NS_COOLDOWN_BASE_MS)).toBe(true);
		expect(cd.anyEligible([], 0)).toBe(true);
	});
});

describe('ProbeBudget — at most one probe per interlude track (Q10)', () => {
	it('no token before any interlude track starts', () => {
		const b = new ProbeBudget();
		expect(b.tryConsume()).toBe(false);
	});

	it('one token per track start, never accumulating', () => {
		const b = new ProbeBudget();
		b.onInterludeTrackStart();
		b.onInterludeTrackStart(); // a second start without a spend must NOT bank a token
		expect(b.tryConsume()).toBe(true);
		expect(b.tryConsume()).toBe(false);
		b.onInterludeTrackStart();
		expect(b.tryConsume()).toBe(true);
	});
});

// quick-261116-prebuf: Adaptive Pre-Buffer pure math (Car Mode plan Phase 2, Q7/Q15).
// Q15 threshold as corrected by Hector: 30 minutes of local audio is enough.

const d = (uid: string, duration?: number) => ({ uid, duration });

describe('measureLocalPool — the 30-minute pool measurement (Q15)', () => {
	it('sums real durations across Downloads + Cached, Downloads winning duplicates', () => {
		const m = measureLocalPool([d('a', 300), d('b', 240)], [d('b', 999), d('c', 60)]);
		expect(m.totalSec).toBe(600);
		expect(m.knownTracks).toBe(3);
		expect(m.estimatedTracks).toBe(0);
	});

	it('estimates a duration-less track at the pool average of known durations', () => {
		const m = measureLocalPool([d('a', 300), d('b', 100), d('c')], []);
		expect(m.fallbackSec).toBe(200);
		expect(m.totalSec).toBe(600);
		expect(m.estimatedTracks).toBe(1);
	});

	it('falls back to the conservative default when NO track reports a duration', () => {
		const m = measureLocalPool([d('a'), d('b')], []);
		expect(m.fallbackSec).toBe(NS_DEFAULT_TRACK_SEC);
		expect(m.totalSec).toBe(2 * NS_DEFAULT_TRACK_SEC);
		expect(m.knownTracks).toBe(0);
	});

	it('an empty pool measures zero', () => {
		const m = measureLocalPool([], []);
		expect(m.totalSec).toBe(0);
		expect(NS_POOL_TARGET_SEC).toBe(30 * 60);
	});
});

describe('planBufferTopUp — top the pool up to the target, in queue order (Q15)', () => {
	it('plans nothing when the pool already meets the target (no wasted data)', () => {
		expect(planBufferTopUp(NS_POOL_TARGET_SEC, NS_POOL_TARGET_SEC, [d('x', 300)])).toEqual([]);
		expect(planBufferTopUp(NS_POOL_TARGET_SEC + 1, NS_POOL_TARGET_SEC, [d('x', 300)])).toEqual(
			[]
		);
	});

	it('takes the in-order prefix whose durations close the gap, overshooting by one track', () => {
		const plan = planBufferTopUp(1200, 1800, [d('a', 300), d('b', 400), d('c', 300)]);
		expect(plan.map((x) => x.uid)).toEqual(['a', 'b']); // 1200+300+400 = 1900 ≥ 1800, c unneeded
	});

	it('passes over skipped uids without counting them toward the gap', () => {
		const plan = planBufferTopUp(
			1500,
			1800,
			[d('owned', 900), d('next', 300)],
			new Set(['owned'])
		);
		expect(plan.map((x) => x.uid)).toEqual(['next']);
	});

	it('estimates duration-less candidates at the supplied fallback', () => {
		const plan = planBufferTopUp(1700, 1800, [d('a')], new Set(), 200);
		expect(plan.map((x) => x.uid)).toEqual(['a']); // 1700 + est. 200 ≥ 1800
	});

	it('returns what exists when the queue cannot fill the gap', () => {
		const plan = planBufferTopUp(0, 1800, [d('a', 300)]);
		expect(plan.map((x) => x.uid)).toEqual(['a']);
	});
});

describe('bufferTierFor — the 320K buffer cap (Q7)', () => {
	it('pulls lossless and auto down to 320', () => {
		expect(bufferTierFor('lossless')).toBe('320');
		expect(bufferTierFor('auto')).toBe('320');
		expect(bufferTierFor('320')).toBe('320');
	});

	it("respects an explicit 128 data-saving choice (never upscaled)", () => {
		expect(bufferTierFor('128')).toBe('128');
	});
});

describe('planBufferEvictions — LRU down to the target, downloads untouchable', () => {
	const e = (uid: string, at: number, sec: number) => ({ uid, at, sec });

	it('evicts nothing at or under the keep target', () => {
		expect(planBufferEvictions([e('a', 1, 900), e('b', 2, 900)], new Set(), 1800)).toEqual([]);
	});

	it('evicts oldest-first until the remainder fits', () => {
		const out = planBufferEvictions(
			[e('new', 300, 600), e('old', 100, 600), e('mid', 200, 600)],
			new Set(),
			1200
		);
		expect(out.map((x) => x.uid)).toEqual(['old']);
	});

	it('never evicts a protected (now-downloaded) uid, even when still over target', () => {
		const out = planBufferEvictions(
			[e('dl', 100, 1200), e('cache', 200, 1200)],
			new Set(['dl']),
			600
		);
		expect(out.map((x) => x.uid)).toEqual(['cache']);
	});
});

describe('estimateTrackSec', () => {
	it('prefers a real positive duration, else the fallback', () => {
		expect(estimateTrackSec(245, 200)).toBe(245);
		expect(estimateTrackSec(undefined, 200)).toBe(200);
		expect(estimateTrackSec(0, 200)).toBe(200);
		expect(estimateTrackSec(Number.NaN, 200)).toBe(200);
	});
});
