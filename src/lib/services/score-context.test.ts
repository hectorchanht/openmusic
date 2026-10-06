import { describe, it, expect } from 'vitest';
import { computeSetContext, LYRIC_MIN_HAN, type SetContext } from './score-context';
import { matchKey } from './match-key';
import { warmScript } from './zh-convert';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// computeSetContext (SRCH-01 / D-05) is the PURE per-result-set summary scoreMatch reads to
// award the cross-source artist boost. It keys each row on `matchKey(artist, '')` (artist-only,
// mirroring artistCoverCacheKey) and records the DISTINCT SourceIds that artist appears under —
// so the boost rewards cross-source PRESENCE, never raw row count from a single source.

function mk(source: SourceId, songid: string, artist: string, title = 't'): Track {
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
		displayIndex: 1
	};
}

describe('computeSetContext — cross-source artist map (D-05)', () => {
	it('an artist appearing from 2 DISTINCT sources yields a Set of size 2', () => {
		const rows = [mk('qq', '1', '周杰倫'), mk('netease', '2', '周杰倫')];
		const ctx = computeSetContext(rows, '周杰倫 稻香');
		const set = ctx.artistSources.get(matchKey('周杰倫', ''));
		expect(set?.size).toBe(2);
		expect(set?.has('qq')).toBe(true);
		expect(set?.has('netease')).toBe(true);
	});

	it('an artist in 5 rows but ALL from one source yields a Set of size 1 (rows ≠ sources)', () => {
		const rows = [
			mk('qq', '1', '周杰倫', 'a'),
			mk('qq', '2', '周杰倫', 'b'),
			mk('qq', '3', '周杰倫', 'c'),
			mk('qq', '4', '周杰倫', 'd'),
			mk('qq', '5', '周杰倫', 'e')
		];
		const ctx = computeSetContext(rows, '周杰倫');
		expect(ctx.artistSources.get(matchKey('周杰倫', ''))?.size).toBe(1);
	});

	it('queryLen equals the TRIMMED query length', () => {
		const ctx: SetContext = computeSetContext([], '  稻香  ');
		expect(ctx.queryLen).toBe('稻香'.length);
	});

	it('keys are artist-ONLY: two different titles by the same artist collapse to one entry', () => {
		const rows = [mk('qq', '1', '周杰倫', '稻香'), mk('qq', '2', '周杰倫', '晴天')];
		const ctx = computeSetContext(rows, '周杰倫');
		// one artist-only key, regardless of differing titles
		expect(ctx.artistSources.size).toBe(1);
		expect(ctx.artistSources.has(matchKey('周杰倫', ''))).toBe(true);
		// and it correctly records the single source once
		expect(ctx.artistSources.get(matchKey('周杰倫', ''))?.size).toBe(1);
	});
});

describe('computeSetContext — lyric mode (quick-261006-lyr LYRIC-01)', () => {
	it('a query with >= LYRIC_MIN_HAN Han chars engages lyric mode', () => {
		expect(computeSetContext([], '如果一手鋸開枯樹木').lyricMode).toBe(true); // 9 Han
		expect(computeSetContext([], '如果一手鋸開枯').lyricMode).toBe(true); // exactly 7 Han
	});

	it('a short CJK query does NOT engage lyric mode', () => {
		expect(computeSetContext([], '如果一手鋸開').lyricMode).toBe(false); // 6 Han
		expect(computeSetContext([], '木紋').lyricMode).toBe(false);
	});

	it('a long LATIN query never engages lyric mode (a verbatim long title keeps exact credit)', () => {
		expect(computeSetContext([], 'Bohemian Rhapsody').lyricMode).toBe(false);
		expect(computeSetContext([], 'never gonna give you up').lyricMode).toBe(false);
	});

	it('a mixed query with enough Han chars engages lyric mode', () => {
		expect(computeSetContext([], '如果一手鋸開枯樹木 yeah').lyricMode).toBe(true);
	});
});

describe('computeSetContext — lyric consensus (quick-261006-lyr LYRIC-02)', () => {
	it('elects the most-shared title-only key across artists and scripts', async () => {
		await warmScript('zh-Hans');
		const rows = [
			mk('qq', '1', '邓千荧', '木纹'),
			mk('kuwo', '2', '洪卓立', '木紋'), // Traditional — folds to the same key
			mk('joox', '3', 'Edz造夢赫茲', '木紋 (R&B版)'), // bracketed variant — same key
			mk('ytmusic', '4', 'HOCC', '木紋 - Mu Wen'), // translation tail stripped — same key
			mk('netease', '5', '南木碎碎唱', '如果一手鋸開枯樹木') // the pasted-lyric mistitle: bucket of one
		];
		const ctx = computeSetContext(rows, '如果一手鋸開枯樹木');
		expect(ctx.lyricMode).toBe(true);
		expect(ctx.lyricConsensus).toBe('木纹');
	});

	it('returns null when no title is shared by >= 2 candidates', () => {
		const rows = [mk('qq', '1', 'a', 'alpha'), mk('kuwo', '2', 'b', 'beta')];
		const ctx = computeSetContext(rows, '如果一手鋸開枯樹木');
		expect(ctx.lyricMode).toBe(true);
		expect(ctx.lyricConsensus).toBeNull();
	});

	it('returns null when lyric mode is off, even with a repeated title', () => {
		const rows = [mk('qq', '1', '周杰倫', '稻香'), mk('netease', '2', '周杰伦', '稻香')];
		const ctx = computeSetContext(rows, '稻香');
		expect(ctx.lyricMode).toBe(false);
		expect(ctx.lyricConsensus).toBeNull();
	});

	it('breaks a count tie deterministically by first appearance', async () => {
		await warmScript('zh-Hans');
		const rows = [mk('qq', '1', 'a', 'alpha'), mk('kuwo', '2', 'b', 'beta')];
		const ctx = computeSetContext(rows, '如果一手鋸開枯樹木');
		// both buckets have count 1 < 2 — no consensus at all, not a tie-break
		expect(ctx.lyricConsensus).toBeNull();
		const rows2 = [
			mk('qq', '1', 'a', 'alpha'),
			mk('kuwo', '2', 'b', 'alpha'),
			mk('joox', '3', 'c', 'beta'),
			mk('ytmusic', '4', 'd', 'beta')
		];
		const ctx2 = computeSetContext(rows2, '如果一手鋸開枯樹木');
		expect(ctx2.lyricConsensus).toBe('alpha'); // tie 2-2 → first-seen wins
	});
});
