// quick-261102-sqn (DECISIONS.md §5) — characterization + invariants for the source priority tables.
import { describe, it, expect, vi } from 'vitest';
import { SOURCES, TIER_1_SOURCES } from '$lib/sources/registry';
import { PLAYBACK_ORDER, COVER_ORDER } from '$lib/sources/source-order';
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

describe('source priority — one table per purpose (quick-261102-sqn)', () => {
	it('SOURCES (and every getEnabledAdapters walk) follows PLAYBACK_ORDER', () => {
		expect(Object.keys(SOURCES)).toEqual([...PLAYBACK_ORDER]);
		expect(PLAYBACK_ORDER.slice(0, 7)).toEqual(['joox', 'kuwo', 'kugou', 'qq', 'netease', 'gdnetease', 'migu']);
	});

	it('tier-1 search set = the first five auto-resolvable sources', () => {
		expect([...TIER_1_SOURCES]).toEqual(['joox', 'kuwo', 'kugou', 'qq', 'netease']);
	});

	it('fallback floor is PLAYBACK_ORDER (suyin last of the auto floor, search-only sources never)', () => {
		expect(fallbackOrder('netease')).toEqual([
			'joox', 'kuwo', 'kugou', 'qq', 'gdnetease', 'migu', 'fivesing', 'jamendo', 'audius', 'suyin'
		]);
	});

	it('dedupe tie-break agrees with the fallback ladder (joox over qq at equal quality)', () => {
		expect(dedupeBest([row('qq'), row('joox')])[0].source).toBe('joox');
	});

	it('cover swap follows COVER_ORDER (a migu cover beats a qq cover on a joox-less group)', () => {
		const out = dedupeBest([row('qq', 'https://qq/c.jpg'), row('migu', 'https://migu/c.jpg')]);
		expect(COVER_ORDER.indexOf('migu')).toBeLessThan(COVER_ORDER.indexOf('qq'));
		expect(out[0].cover).toBe('https://migu/c.jpg');
	});
});
