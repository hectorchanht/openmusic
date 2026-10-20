import { describe, it, expect } from 'vitest';
// PURE module — no runes, no $app, no store imports — so the node Vitest project compiles it.
import { qualityRank, shouldAdoptDownloaded, ADOPT_MIN_REMAINING_SEC } from './download-upgrade';

describe('qualityRank', () => {
	it('ranks the standard band at 1', () => {
		for (const q of ['standard', 'std', '128', '128k', 'low', 'AAC 192']) {
			expect(qualityRank(q), q).toBe(1);
		}
	});
	it('ranks the 320k band at 2 (qq hq is its 320 tier)', () => {
		for (const q of ['320', '320k', 'hq', 'HQ', '320K']) {
			expect(qualityRank(q), q).toBe(2);
		}
	});
	it('ranks the lossless band at 3', () => {
		for (const q of ['lossless', 'flac', 'FLAC', '无损', 'SQ']) {
			expect(qualityRank(q), q).toBe(3);
		}
	});
	it('ranks null/empty/unknown tags at 0 (conservative — never swap toward an unnamed tier)', () => {
		for (const q of [null, undefined, '', 'unknown']) {
			expect(qualityRank(q), String(q)).toBe(0);
		}
	});
});

describe('shouldAdoptDownloaded (quick-261020-hqswitch)', () => {
	const base = {
		currentUid: 'qq:1',
		downloadedUid: 'qq:1',
		currentQuality: 'standard',
		downloadedQuality: '320k',
		remainingSec: 100
	};

	it('adopts when the downloaded tier is strictly higher for the loaded track', () => {
		expect(shouldAdoptDownloaded(base)).toBe(true);
		expect(
			shouldAdoptDownloaded({ ...base, currentQuality: '128k', downloadedQuality: 'lossless' })
		).toBe(true);
		// null streaming tag (rank 0) is upgradeable from — the conservative direction.
		expect(shouldAdoptDownloaded({ ...base, currentQuality: null })).toBe(true);
	});

	it('refuses when the download is for a different track or uids are missing', () => {
		expect(shouldAdoptDownloaded({ ...base, downloadedUid: 'qq:2' })).toBe(false);
		expect(shouldAdoptDownloaded({ ...base, downloadedUid: null })).toBe(false);
		expect(shouldAdoptDownloaded({ ...base, currentUid: null })).toBe(false);
	});

	it('refuses when the downloaded tier is equal or lower (no glitch for a same-tier file, no downgrade)', () => {
		expect(shouldAdoptDownloaded({ ...base, currentQuality: '320k' })).toBe(false);
		expect(
			shouldAdoptDownloaded({ ...base, currentQuality: '320k', downloadedQuality: '128k' })
		).toBe(false);
		expect(
			shouldAdoptDownloaded({ ...base, currentQuality: 'lossless', downloadedQuality: '320k' })
		).toBe(false);
	});

	it('refuses when the saved tier is unnamed (never swap toward an unknown file)', () => {
		expect(shouldAdoptDownloaded({ ...base, downloadedQuality: null })).toBe(false);
	});

	it('refuses when the track is about to end (the next play takes the blob anyway)', () => {
		expect(
			shouldAdoptDownloaded({ ...base, remainingSec: ADOPT_MIN_REMAINING_SEC - 0.5 })
		).toBe(false);
		expect(shouldAdoptDownloaded({ ...base, remainingSec: ADOPT_MIN_REMAINING_SEC })).toBe(true);
		// Unknown duration: the swap proceeds (nothing about the ending is known).
		expect(shouldAdoptDownloaded({ ...base, remainingSec: null })).toBe(true);
	});
});
