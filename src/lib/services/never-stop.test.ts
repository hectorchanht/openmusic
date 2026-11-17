import { describe, it, expect } from 'vitest';
import {
	orderFallbackPool,
	SourceCooldowns,
	ProbeBudget,
	NS_COOLDOWN_BASE_MS,
	NS_COOLDOWN_CAP_MS,
	NS_SMALL_POOL
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
