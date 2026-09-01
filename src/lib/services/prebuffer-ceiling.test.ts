import { describe, it, expect } from 'vitest';
import { PREBUFFER_MAX_BYTES, overPrebufferCeiling } from './prebuffer-ceiling';

// 32-D-15: the pure seam for the next-track prebuffer size ceiling. prebufferNext is private and
// does a real network fetch, so the DECISION is extracted here and the store thin-calls it (the
// house "pure functions extracted for testability" convention). The byte figures below are the
// live-probed tang ladder for 晴天 (32-RESEARCH § Q1), not invented fixtures.

describe('overPrebufferCeiling', () => {
	it('rejects the measured 52.8MB sq FLAC', () => {
		expect(overPrebufferCeiling('55397039')).toBe(true);
	});

	it('rejects the measured 29.7MB pq FLAC', () => {
		expect(overPrebufferCeiling('31168013')).toBe(true);
	});

	it('admits the measured 6.2MB hq tier — the bg-lockscreen-stall-noskip path stays protected', () => {
		expect(overPrebufferCeiling('6519764')).toBe(false);
	});

	it('admits the measured 3.1MB standard tier', () => {
		expect(overPrebufferCeiling('3283546')).toBe(false);
	});

	it('admits the exact boundary — only STRICTLY above the ceiling skips', () => {
		expect(overPrebufferCeiling(String(PREBUFFER_MAX_BYTES))).toBe(false);
	});

	it('skips one byte above the boundary', () => {
		expect(overPrebufferCeiling(String(PREBUFFER_MAX_BYTES + 1))).toBe(true);
	});

	it('falls through on a missing header (CDN without access-control-expose-headers)', () => {
		expect(overPrebufferCeiling(null)).toBe(false);
	});

	it('falls through on an empty header', () => {
		expect(overPrebufferCeiling('')).toBe(false);
	});

	it('falls through on a garbage header — a parse, never a truthiness check', () => {
		expect(overPrebufferCeiling('not-a-number')).toBe(false);
	});

	it('pins the ceiling at 24 MB', () => {
		expect(PREBUFFER_MAX_BYTES).toBe(24 * 1024 * 1024);
	});
});
