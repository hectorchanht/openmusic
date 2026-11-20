import { describe, it, expect } from 'vitest';
import { caaReleaseGroupCover } from './cover-art';

// FIX-B: caaReleaseGroupCover builds a Cover Art Archive release-group cover URL from a
// MusicBrainz id, CLIENT-SIDE (the browser <img> does the request; a 404 degrades to the
// gradient via onerror). It only BUILDS the URL — never fetches. A no-mbid item returns null
// so the caller renders no <img>.

describe('caaReleaseGroupCover (FIX-B)', () => {
	it('builds the release-group/front-250 URL for a real mbid', () => {
		const mbid = 'b1a9c0e9-d987-4042-ae91-78d6a3267d69';
		expect(caaReleaseGroupCover(mbid)).toBe(
			`https://coverartarchive.org/release-group/${mbid}/front-250`
		);
	});

	it('encodeURIComponent-encodes the mbid (no raw special chars in the path)', () => {
		// A (hypothetical) mbid with characters needing encoding must be encoded, not raw.
		const out = caaReleaseGroupCover('a b/c?d#e');
		expect(out).toBe('https://coverartarchive.org/release-group/a%20b%2Fc%3Fd%23e/front-250');
		// Sanity: no raw space / slash / query / hash leaked into the path.
		expect(out).not.toContain(' ');
		expect(out).not.toContain('a b');
	});

	it('trims surrounding whitespace before building', () => {
		expect(caaReleaseGroupCover('  abc  ')).toBe(
			'https://coverartarchive.org/release-group/abc/front-250'
		);
	});

	it('returns null for an empty string', () => {
		expect(caaReleaseGroupCover('')).toBeNull();
	});

	it('returns null for a whitespace-only string', () => {
		expect(caaReleaseGroupCover('   ')).toBeNull();
	});

	it('returns null for undefined', () => {
		expect(caaReleaseGroupCover(undefined)).toBeNull();
	});

	it('returns null for null', () => {
		expect(caaReleaseGroupCover(null)).toBeNull();
	});
});
