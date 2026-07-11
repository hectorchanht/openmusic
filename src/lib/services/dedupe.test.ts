import { describe, it, expect } from 'vitest';
import { dedupeBest, groupVariants, collapseVariants, variantTag } from './dedupe';
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

// Gap 5 (Phase 26-08): the version picker used to show N visually-identical rows because one
// source returns many same-name hits and every row rendered as title·artist·"unknown quality".
// collapseVariants de-dups INTRA-source (same source + album + version tag → one, best quality
// kept) WITHOUT collapsing cross-source variants (a real choice). variantTag derives the
// distinguishing label from the title parens. groupVariants is unchanged (above block still green).
describe('collapseVariants — intra-source de-dup (Gap 5)', () => {
	it('collapses 10 same-source same-title blank-album no-tag hits to ONE, keeping the best quality', () => {
		const rows: Track[] = [];
		for (let i = 0; i < 10; i++) {
			// one of them is FLAC (best), the rest carry no quality (unknown pre-resolve).
			const extra = i === 4 ? { qualityLabel: 'FLAC' } : {};
			rows.push(mk('joox', `j${i}`, 'That Should Be Me', 'Justin Bieber', extra));
		}
		const out = collapseVariants(rows);
		expect(out).toHaveLength(1);
		// the surviving row is the best-quality (FLAC) one, not merely the first-seen.
		expect(out[0].qualityLabel).toBe('FLAC');
		expect(out[0].uid).toBe(makeUid('joox', 'j4'));
	});

	it("keeps a source's (Live) take and its studio take as TWO rows (distinct version tag)", () => {
		const out = collapseVariants([
			mk('joox', 'j1', 'That Should Be Me (Live)', 'Justin Bieber'),
			mk('joox', 'j2', 'That Should Be Me', 'Justin Bieber')
		]);
		expect(out).toHaveLength(2);
	});

	it("keeps a source's two distinct albums as TWO rows", () => {
		const out = collapseVariants([
			mk('qq', 'q1', 'Yellow', 'Coldplay', { album: 'Parachutes' }),
			mk('qq', 'q2', 'Yellow', 'Coldplay', { album: 'Live 2003' })
		]);
		expect(out).toHaveLength(2);
	});

	it('NEVER collapses cross-source variants — netease + qq + kuwo of one song stay as 3 rows', () => {
		const out = collapseVariants([
			mk('netease', 'n1', 'Hello', 'Adele'),
			mk('qq', 'q1', 'Hello', 'Adele'),
			mk('kuwo', 'k1', 'Hello', 'Adele')
		]);
		expect(out).toHaveLength(3);
		expect(out.map((t) => t.source)).toEqual(['netease', 'qq', 'kuwo']);
	});

	it('preserves first-appearance order of the surviving buckets', () => {
		const out = collapseVariants([
			mk('kuwo', 'k1', 'Hello', 'Adele'),
			mk('netease', 'n1', 'Hello', 'Adele'),
			mk('kuwo', 'k2', 'Hello', 'Adele') // same bucket as k1 → collapses into it, order unchanged
		]);
		expect(out).toHaveLength(2);
		expect(out.map((t) => t.source)).toEqual(['kuwo', 'netease']);
	});
});

describe('variantTag — title-parens version-tag parser (Gap 5 label)', () => {
	it('maps EN markers to the enum', () => {
		expect(variantTag('That Should Be Me (Live)')?.key).toBe('live');
		expect(variantTag('Song (Acoustic)')?.key).toBe('acoustic');
		expect(variantTag('Song (Demo)')?.key).toBe('demo');
		expect(variantTag('Song (Cover)')?.key).toBe('cover');
		expect(variantTag('Song (Remix)')?.key).toBe('remix');
		expect(variantTag('Song (Instrumental)')?.key).toBe('instrumental');
		expect(variantTag('Song [Remastered]')?.key).toBe('remaster');
	});

	it('maps CN markers to the enum', () => {
		expect(variantTag('告白氣球 (现场)')?.key).toBe('live');
		expect(variantTag('告白氣球 (翻唱)')?.key).toBe('cover');
		expect(variantTag('告白氣球 (伴奏)')?.key).toBe('instrumental');
		expect(variantTag('告白氣球【重製】')?.key).toBe('remaster');
	});

	it('passes an unrecognized marker through as raw text with a null key', () => {
		const vt = variantTag('Song (Radio Edit)');
		expect(vt).toEqual({ key: null, text: 'Radio Edit' });
	});

	it('returns null when the title has no parenthetical marker', () => {
		expect(variantTag('Plain Title')).toBeNull();
		expect(variantTag('')).toBeNull();
	});
});
