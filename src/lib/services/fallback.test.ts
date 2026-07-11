import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// CR-03 / WR-06 regression. fallbackOrder must EXCLUDE every already-attempted source so a
// resolve-but-unplayable A↔B ping-pong terminates (the order empties → tryFallback returns null →
// the caller's loop-guard engages). tryFallback must (a) thread + populate the attempted set and
// (b) adopt a candidate only when it is the SAME song (normalized title+artist), not blindly the
// first deduped result.

// Control the enabled-source set + registry without touching real settings/network.
// Phase 26 (RESOLVE-01): the mock mirrors the real registry's kuwo-FIRST order, so fallbackOrder's
// inherited default walks kuwo → qq → netease → joox.
vi.mock('$lib/sources/registry', () => ({
	SOURCES: {
		kuwo: { id: 'kuwo' },
		qq: { id: 'qq' },
		netease: { id: 'netease' },
		joox: { id: 'joox' }
	},
	getEnabledAdapters: vi.fn(() => [
		{ id: 'kuwo' },
		{ id: 'qq' },
		{ id: 'netease' },
		{ id: 'joox' }
	])
}));
vi.mock('$lib/services/catalog', () => ({ searchAll: vi.fn(), ensureTrackDetails: vi.fn() }));

import { fallbackOrder, tryFallback } from './fallback';
import { searchAll, ensureTrackDetails } from '$lib/services/catalog';

const mockSearch = vi.mocked(searchAll);
const mockEnsure = vi.mocked(ensureTrackDetails);

function mk(source: SourceId, songid: string, artist: string, title: string, audioUrl: string | null): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title,
		artist,
		album: '',
		cover: null,
		audioUrl,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1
	};
}

describe('fallbackOrder — attempted-source exclusion (CR-03)', () => {
	it('drops the failed source', () => {
		// kuwo-first default order minus the failed source.
		expect(fallbackOrder('netease')).toEqual(['kuwo', 'qq', 'joox']);
	});

	it('also drops every source in the attempted set', () => {
		const attempted = new Set<SourceId>(['netease', 'qq']);
		expect(fallbackOrder('netease', undefined, attempted)).toEqual(['kuwo', 'joox']);
	});

	it('empties the order once all sources have been attempted (→ total failure upstream)', () => {
		const attempted = new Set<SourceId>(['qq', 'kuwo', 'joox']);
		expect(fallbackOrder('netease', undefined, attempted)).toEqual([]);
	});

	it('surfaces preferred first among the remaining (non-attempted) sources', () => {
		const attempted = new Set<SourceId>(['netease']);
		expect(fallbackOrder('netease', 'joox', attempted)).toEqual(['joox', 'kuwo', 'qq']);
	});
});

describe('fallbackOrder — kuwo-first resolve floor (RESOLVE-01, POLICY.md)', () => {
	it('defaults to kuwo FIRST when no preferred source is set', () => {
		expect(fallbackOrder('netease', undefined, new Set())[0]).toBe('kuwo');
	});

	it('walks kuwo → qq → joox after a kuwo failure with no preferred source', () => {
		// kuwo just failed → dropped; the rest keep the registry (kuwo-first) order.
		expect(fallbackOrder('kuwo', undefined, new Set())).toEqual(['qq', 'netease', 'joox']);
	});

	it('an explicit user preferred source still wins over the kuwo default', () => {
		// preferred=qq is hoisted first even though kuwo is the registry floor.
		expect(fallbackOrder('kuwo', 'qq', new Set())[0]).toBe('qq');
	});
});

describe('tryFallback — attempted set + identity check', () => {
	beforeEach(() => {
		mockSearch.mockReset();
		mockEnsure.mockReset();
	});

	it('CR-03: populates the attempted set with every source it touches', async () => {
		// No source yields a candidate → every remaining source is tried (and recorded), returns null.
		mockSearch.mockResolvedValue({ interleaved: [], perSource: [] } as never);
		const failed = mk('netease', '1', 'Artist', 'Song', null);
		const attempted = new Set<SourceId>(['netease']);

		const out = await tryFallback(failed, undefined, undefined, attempted);

		expect(out).toBeNull();
		// netease was the seed; qq/kuwo/joox each got tried → all four now in the set.
		expect([...attempted].sort()).toEqual(['joox', 'kuwo', 'netease', 'qq']);
	});

	it('CR-03: a pre-populated attempted set narrows the sources tried', async () => {
		mockSearch.mockResolvedValue({ interleaved: [], perSource: [] } as never);
		const failed = mk('qq', '1', 'Artist', 'Song', null);
		const attempted = new Set<SourceId>(['netease', 'kuwo']); // already tried

		await tryFallback(failed, undefined, undefined, attempted);

		// failed=qq is excluded by source; netease/kuwo by the set → only joox searched.
		expect(mockSearch).toHaveBeenCalledTimes(1);
	});

	it('WR-06: adopts only a candidate that is the SAME song (normalized title+artist)', async () => {
		// The first deduped candidate is an UNRELATED song; must NOT be adopted.
		const wrong = mk('qq', 'w', 'Other Artist', 'Totally Different', 'https://cdn/wrong.mp3');
		mockSearch.mockResolvedValue({ interleaved: [wrong], perSource: [] } as never);
		mockEnsure.mockImplementation(async (t) => t);

		const failed = mk('netease', '1', 'Real Artist', 'Real Song', null);
		const out = await tryFallback(failed, undefined);

		expect(out).toBeNull(); // wrong-song candidate rejected on every source
		expect(mockEnsure).not.toHaveBeenCalled(); // never even resolved the mismatch
	});

	it('WR-06: adopts a same-song candidate (case/punctuation-insensitive match)', async () => {
		const match = mk('qq', 'm', 'real artist', 'Real Song!', 'https://cdn/right.mp3');
		mockSearch.mockResolvedValue({ interleaved: [match], perSource: [] } as never);
		mockEnsure.mockImplementation(async (t) => t);

		const failed = mk('netease', '1', 'Real Artist', 'Real Song', null);
		const out = await tryFallback(failed, undefined);

		expect(out?.uid).toBe(match.uid);
	});
});
