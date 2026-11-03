// dead-cover-urls.test.ts (quick-261020-dcvr) — node tests for the session's dead-cover registry.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	markCoverUrlDead,
	unmarkCoverUrlDead,
	isCoverUrlDead,
	__resetDeadCoverUrls
} from '$lib/services/dead-cover-urls';

describe('dead-cover-urls', () => {
	beforeEach(__resetDeadCoverUrls);

	it('marks a URL dead and reads it back', () => {
		expect(isCoverUrlDead('https://cdn/a.jpg')).toBe(false);
		markCoverUrlDead('https://cdn/a.jpg');
		expect(isCoverUrlDead('https://cdn/a.jpg')).toBe(true);
	});

	it('unmark clears the mark (a transient blip self-corrects)', () => {
		markCoverUrlDead('https://cdn/b.jpg');
		unmarkCoverUrlDead('https://cdn/b.jpg');
		expect(isCoverUrlDead('https://cdn/b.jpg')).toBe(false);
	});

	it('nullish / empty input is never dead', () => {
		expect(isCoverUrlDead(null)).toBe(false);
		expect(isCoverUrlDead(undefined)).toBe(false);
		expect(isCoverUrlDead('')).toBe(false);
	});

	it('mark is idempotent; unmark of an unknown URL is a no-op', () => {
		markCoverUrlDead('https://cdn/c.jpg');
		markCoverUrlDead('https://cdn/c.jpg');
		expect(isCoverUrlDead('https://cdn/c.jpg')).toBe(true);
		unmarkCoverUrlDead('https://cdn/never-marked.jpg');
		expect(isCoverUrlDead('https://cdn/never-marked.jpg')).toBe(false);
	});
});
