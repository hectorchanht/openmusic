// quick-261102-to0 (DECISIONS.md §7) — characterization + invariants for the ONE quality truth.
// Golden fixture: 最後一次 / 高爾宣 OSN — Track Detail said LOSSLESS while the pill said 320K.
import { describe, it, expect } from 'vitest';
import { qualityRank } from '$lib/services/download-upgrade';
import { donorRank, currentQualityMeets } from '$lib/services/download-track';

describe('quality rankers (characterization: current behaviour)', () => {
	it('the upgrade ranker does not know atmos / 母带 (dedupe does)', () => {
		expect(qualityRank('Dolby Atmos')).toBe(0);
		expect(donorRank({ container: null, quality: '母带' })).toBe(0);
	});

	it('currentQualityMeets treats auto as met by any stream', () => {
		expect(currentQualityMeets('320', 'auto')).toBe(true);
	});
});
