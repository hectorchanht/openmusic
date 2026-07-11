import { describe, it, expect } from 'vitest';
import { dedupeBest, groupVariants } from './dedupe';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// groupVariants (Phase 26-04, VERSIONS-01) is the version-picker's data source: it retains the
// pre-dedupe search variants that dedupeBest collapses away. It groups a flat interleaved Track[]
// by the SAME normalized title+artist identity dedupeBest uses (case/space/punct-insensitive,
// bracket/suffix-dropped), preserving first-appearance order within each group. It NEVER re-implements
// identity (one source of truth: the private key()) and NEVER merges a blank/untitled key.

function mk(source: SourceId, songid: string, title: string, artist = 'a', extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title,
		artist,
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1,
		...extra
	};
}

describe('groupVariants — retains pre-dedupe cross-source variants', () => {
	it('groups netease+qq+kuwo variants of one song under a single key', () => {
		const tracks = [
			mk('netease', 'n1', '告白氣球', '周杰倫'),
			mk('qq', 'q1', '告白气球', '周杰伦'), // simplified — normalizes same after punct/space strip? NO, different chars
			mk('kuwo', 'k1', '告白氣球', '周杰倫')
		];
		// Use identical traditional spelling for the cross-source group so identity matches.
		const same = [
			mk('netease', 'n1', '告白氣球 (Live)', '周杰倫'),
			mk('qq', 'q1', '告白氣球', '周杰倫'),
			mk('kuwo', 'k1', '告白氣球', '周杰倫')
		];
		const groups = groupVariants(same);
		expect(groups.size).toBe(1);
		const [variants] = [...groups.values()];
		expect(variants).toHaveLength(3);
		// first-appearance order preserved
		expect(variants.map((t) => t.source)).toEqual(['netease', 'qq', 'kuwo']);
		// silence the unused var lint for the descriptive example above
		expect(tracks.length).toBe(3);
	});

	it('keeps two genuinely different songs in separate groups', () => {
		const tracks = [
			mk('netease', 'n1', 'Hello', 'Adele'),
			mk('qq', 'q1', 'Hello', 'Adele'),
			mk('kuwo', 'k1', 'Someone Like You', 'Adele')
		];
		const groups = groupVariants(tracks);
		expect(groups.size).toBe(2);
	});

	it('the group for a deduped winner key contains that winner (dedupeBest winner ∈ its group)', () => {
		const tracks = [
			mk('kuwo', 'k1', 'Yellow', 'Coldplay', { qualityLabel: '128' }),
			mk('netease', 'n1', 'Yellow', 'Coldplay', { qualityLabel: 'FLAC' }),
			mk('qq', 'q1', 'Yellow', 'Coldplay', { qualityLabel: '320' })
		];
		const winners = dedupeBest(tracks);
		expect(winners).toHaveLength(1);
		const winner = winners[0];
		const groups = groupVariants(tracks);
		expect(groups.size).toBe(1);
		const [variants] = [...groups.values()];
		expect(variants.map((t) => t.uid)).toContain(winner.uid);
		expect(variants).toHaveLength(3);
	});

	it('never merges distinct songs under a blank/untitled key', () => {
		const tracks = [
			mk('netease', 'n1', '', ''),
			mk('qq', 'q1', '', ''),
			mk('kuwo', 'k1', 'Real Song', 'Someone')
		];
		const groups = groupVariants(tracks);
		// two blank-key stubs must NOT collapse into one group; each stays distinct
		expect(groups.size).toBe(3);
	});
});
