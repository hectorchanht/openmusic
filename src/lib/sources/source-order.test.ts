// quick-261102-sqn (DECISIONS.md §5) — characterization + invariants for the source priority tables.
import { describe, it, expect, vi } from 'vitest';
import { SOURCES, TIER_1_SOURCES } from '$lib/sources/registry';
import { fallbackOrder } from '$lib/services/fallback';
import { dedupeBest } from '$lib/services/dedupe';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

vi.mock('$lib/stores/actionLog.svelte', () => ({ logAction: vi.fn() }));

function row(source: SourceId, cover: string | null = null): Track {
	return {
		uid: makeUid(source, '1'),
		source,
		songid: '1',
		title: '晴天',
		artist: '周杰伦',
		album: '',
		cover,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 0
	};
}

describe('source priority (characterization: current behaviour)', () => {
	it('registry literal order starts with qq', () => {
		expect(Object.keys(SOURCES)[0]).toBe('qq');
	});

	it('tier-1 search set', () => {
		expect([...TIER_1_SOURCES]).toEqual(['qq', 'joox', 'kuwo', 'netease', 'suyin']);
	});

	it('fallback floor re-sorts by its own pass-rate table', () => {
		expect(fallbackOrder('netease')).toEqual([
			'joox', 'kuwo', 'kugou', 'qq', 'gdnetease', 'migu', 'fivesing', 'jamendo', 'audius', 'suyin'
		]);
	});

	it('dedupe picks qq over joox for the same song at equal quality (SOURCE_RANK)', () => {
		expect(dedupeBest([row('joox'), row('qq')])[0].source).toBe('qq');
	});
});
