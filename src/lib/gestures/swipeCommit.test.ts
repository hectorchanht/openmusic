import { describe, it, expect } from 'vitest';
import { swipeCommitDistance, shouldCommitSwipe, SWIPE_COMMIT_MAX_PX } from './swipeCommit';

// quick-261104-swipe: the shared horizontal-swipe commit rule. The cap is the desktop fix —
// an 804px Nowbar used to need a 225px mouse drag; a 1400px one, 400px.
describe('swipeCommitDistance', () => {
	it('is 28% of the width on a phone-sized surface', () => {
		expect(swipeCommitDistance(300)).toBeCloseTo(84);
		expect(swipeCommitDistance(390)).toBeCloseTo(109.2);
	});
	it('caps at 120px on wide desktop surfaces', () => {
		expect(swipeCommitDistance(804)).toBe(SWIPE_COMMIT_MAX_PX);
		expect(swipeCommitDistance(1400)).toBe(SWIPE_COMMIT_MAX_PX);
	});
	it('falls back when the width is unknown (0 / NaN / negative)', () => {
		expect(swipeCommitDistance(0)).toBe(96);
		expect(swipeCommitDistance(NaN, 50)).toBe(50);
		expect(swipeCommitDistance(-10)).toBe(96);
	});
});

describe('shouldCommitSwipe', () => {
	it('commits a far slow drag in either direction', () => {
		expect(shouldCommitSwipe(120, 0.05, 96)).toBe(true);
		expect(shouldCommitSwipe(-120, -0.05, 96)).toBe(true);
	});
	it('does not commit a moderate slow drag below the distance', () => {
		expect(shouldCommitSwipe(60, 0.1, 96)).toBe(false);
	});
	it('commits a fast flick below the distance when the flick points the drag way', () => {
		expect(shouldCommitSwipe(40, 1.4, 96)).toBe(true);
		expect(shouldCommitSwipe(-40, -1.4, 96)).toBe(true);
	});
	it('never commits a flick BACK toward rest (the user is cancelling)', () => {
		expect(shouldCommitSwipe(40, -1.4, 96)).toBe(false);
	});
	it('never commits a sub-slop tap, however fast', () => {
		expect(shouldCommitSwipe(5, 3, 96)).toBe(false);
	});
});
