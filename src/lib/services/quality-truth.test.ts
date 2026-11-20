// quick-261102-to0 (DECISIONS.md §7) — characterization + invariants for the ONE quality truth.
// Golden fixture: 最後一次 / 高爾宣 OSN — Track Detail said LOSSLESS while the pill said 320K.
import { describe, it, expect } from 'vitest';
import { qualityRank } from '$lib/sources/quality';
import { displayQualityLabel } from '$lib/services/display-quality';
import { donorRank, currentQualityMeets } from '$lib/services/download-track';

describe('one quality ranker (quick-261102-to0)', () => {
	it('every ranker agrees: atmos / 母带 / FLAC are lossless, hq is 320, std is standard', () => {
		for (const l of ['Dolby Atmos', '母带', 'FLAC', 'LOSSLESS', 'SQ']) {
			expect(qualityRank(l)).toBe(3);
			expect(donorRank({ container: null, quality: l })).toBe(3);
		}
		expect(qualityRank('HQ')).toBe(2);
		expect(qualityRank('320K')).toBe(2);
		expect(qualityRank('STD')).toBe(1);
		expect(qualityRank(null)).toBe(0);
	});

	it('currentQualityMeets ranks the label — a FLAC stream meets a lossless want (was string equality)', () => {
		expect(currentQualityMeets('FLAC', 'lossless')).toBe(true);
		expect(currentQualityMeets('320K', 'lossless')).toBe(false);
		expect(currentQualityMeets('320K', '320')).toBe(true);
	});

	it('display precedence: download record > the track\'s stamps (最後一次 / 高爾宣 OSN)', () => {
		const track = { uid: 'joox:1', source: 'joox', quality: '320', qualityLabel: '320K' } as never;
		expect(displayQualityLabel(track, { quality: 'lossless', qualityLabel: 'FLAC' })).toBe('FLAC');
		expect(displayQualityLabel(track, null)).toBe('320K');
	});
});
