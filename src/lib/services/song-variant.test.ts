import { describe, it, expect } from 'vitest';
import { variantTagsOf, isAcceptableSubstitute, partitionOfficial, findOfficial, pickOfficial } from './song-variant';

// The guard exists because sameSongKey CANNOT tell renditions apart: dedupe's key() strips bracketed
// suffixes, so `告白氣球（純音樂版）` and `告白氣球` are the same key. Without this, a cross-source
// failover silently adopts the instrumental under the original song's name.

describe('variantTagsOf — only reads bracketed / dash-suffix segments', () => {
	it('tags CJK instrumental and karaoke markers', () => {
		expect(variantTagsOf('告白氣球（純音樂版）').has('instrumental')).toBe(true);
		expect(variantTagsOf('告白气球(纯音乐)').has('instrumental')).toBe(true);
		expect(variantTagsOf('演員【伴奏】').has('instrumental')).toBe(true);
		expect(variantTagsOf('演员 - 无人声').has('instrumental')).toBe(true);
		expect(variantTagsOf('小幸運（卡拉OK版）').has('instrumental')).toBe(true);
	});

	it('tags latin instrumental / karaoke markers', () => {
		expect(variantTagsOf('Dynamite (Instrumental)').has('instrumental')).toBe(true);
		expect(variantTagsOf('Dynamite (Inst.)').has('instrumental')).toBe(true);
		expect(variantTagsOf('Dynamite - Karaoke Version').has('instrumental')).toBe(true);
		expect(variantTagsOf('Dynamite (Off Vocal)').has('instrumental')).toBe(true);
	});

	it('tags covers', () => {
		expect(variantTagsOf('七里香（翻唱）').has('cover')).toBe(true);
		expect(variantTagsOf('Yesterday (Cover)').has('cover')).toBe(true);
	});

	it('leaves a plain title untagged', () => {
		expect(variantTagsOf('告白氣球').size).toBe(0);
		expect(variantTagsOf('Dynamite').size).toBe(0);
	});

	// THE false-positive guard. Scanning the whole title for these words would reject real songs, so
	// markers only count inside a bracketed or trailing-dash segment.
	it('does NOT tag a marker word that is part of the actual song title', () => {
		expect(variantTagsOf('Cover Me in Sunshine').size).toBe(0);
		expect(variantTagsOf('Karaoke Superstars').size).toBe(0);
		expect(variantTagsOf('Instrumental Break Forever').size).toBe(0);
	});

	// Whole-token matching for latin: `inst` must not fire on words that merely contain it.
	it('does NOT tag a latin marker that is only a substring of another word', () => {
		expect(variantTagsOf('Song (Instant Crush)').size).toBe(0);
		expect(variantTagsOf('Song (Recovery)').size).toBe(0);
	});

	// Spider-Man produces a trailing segment "Man" — liberal extraction is safe because the MARKER
	// list is what decides, and nothing matches.
	it('a harmless dash suffix produces no tag', () => {
		expect(variantTagsOf('Spider-Man').size).toBe(0);
	});
});

describe('isAcceptableSubstitute — relative, never absolute', () => {
	it('rejects an instrumental standing in for the vocal original', () => {
		expect(isAcceptableSubstitute('告白氣球', '告白氣球（純音樂版）')).toBe(false);
		expect(isAcceptableSubstitute('Dynamite', 'Dynamite (Karaoke Version)')).toBe(false);
	});

	it('rejects a cover standing in for the original', () => {
		expect(isAcceptableSubstitute('七里香', '七里香（翻唱）')).toBe(false);
	});

	it('accepts a plain candidate for a plain original', () => {
		expect(isAcceptableSubstitute('告白氣球', '告白氣球')).toBe(true);
	});

	// The point of being RELATIVE: if the user deliberately asked for the instrumental, another
	// instrumental is the CORRECT substitute and swapping in the vocal take would be the error.
	it('accepts an instrumental standing in for an instrumental', () => {
		expect(isAcceptableSubstitute('告白氣球（純音樂）', '告白氣球(纯音乐版)')).toBe(true);
	});

	it('accepts the vocal original standing in for an instrumental request', () => {
		// Candidate carries no tag, so there is nothing to object to.
		expect(isAcceptableSubstitute('告白氣球（純音樂）', '告白氣球')).toBe(true);
	});

	// Explicit user call: a live take by the same artist is a fine stand-in. Remix likewise passes —
	// it was not in the request, and silently narrowing substitution is worse than an odd remix.
	it('accepts LIVE and remix takes — deliberately not disqualifying', () => {
		expect(isAcceptableSubstitute('告白氣球', '告白氣球（Live）')).toBe(true);
		expect(isAcceptableSubstitute('Dynamite', 'Dynamite - Live')).toBe(true);
		expect(isAcceptableSubstitute('Dynamite', 'Dynamite (Remix)')).toBe(true);
	});
});

// --- OFFICIAL SONG PRIORITIZER (quick-261020-off1) -------------------------------------------
// A track is official when its title carries NO variant markers. The prioritizer is a HARD
// preference: official wins outright; variants are only used when no official exists.

const mk = (title: string) => ({ title, artist: '周杰伦', source: 'joox' as const });

describe('partitionOfficial', () => {
	it('splits official from 伴奏/live/DJ/cover variants', () => {
		const { official, variants } = partitionOfficial(
			[
				mk('給我一首歌的時間'),
				mk('給我一首歌的時間 (伴奏)'),
				mk('給我一首歌的時間 (Live)'),
				mk('給我一首歌的時間 (DJ版)')
			],
			'給我一首歌的時間'
		);
		expect(official.map((t) => t.title)).toEqual(['給我一首歌的時間']);
		expect(variants.map((t) => t.title)).toEqual([
			'給我一首歌的時間 (伴奏)',
			'給我一首歌的時間 (Live)',
			'給我一首歌的時間 (DJ版)'
		]);
	});

	// quick-261020-dj1: DJ name between DJ and 版 — "DJ 阿樂版", "DJ LUX 煜版" etc.
	it('catches DJ versions with a DJ name (DJ 阿樂版 / DJ LUX 煜版)', () => {
		const { official, variants } = partitionOfficial(
			[
				mk('記憶棉'),
				mk('記憶棉 (DJ 阿樂版)'),
				mk('記憶棉 (DJ LUX 煜版)'),
				mk('記憶棉 (1.1x DJ 慢搖版)')
			],
			'記憶棉'
		);
		expect(official.map((t) => t.title)).toEqual(['記憶棉']);
		expect(variants.map((t) => t.title)).toEqual([
			'記憶棉 (DJ 阿樂版)',
			'記憶棉 (DJ LUX 煜版)',
			'記憶棉 (1.1x DJ 慢搖版)'
		]);
	});

	it('bypasses the partition when the query asks for a variant', () => {
		const cands = [mk('給我一首歌的時間'), mk('給我一首歌的時間 (伴奏)')];
		const { official, variants } = partitionOfficial(cands, '給我一首歌的時間 伴奏');
		expect(official).toHaveLength(2);
		expect(variants).toHaveLength(0);
	});

	it('returns everything as variants when no official exists', () => {
		const { official, variants } = partitionOfficial(
			[mk('給我一首歌的時間 (伴奏)'), mk('給我一首歌的時間 (Live)')],
			'給我一首歌的時間'
		);
		expect(official).toHaveLength(0);
		expect(variants).toHaveLength(2);
	});
});

describe('findOfficial', () => {
	it('prefers the official even when a variant matches first', () => {
		const cands = [mk('給我一首歌的時間 (伴奏)'), mk('給我一首歌的時間')];
		const found = findOfficial(cands, '給我一首歌的時間', () => true);
		expect(found?.title).toBe('給我一首歌的時間');
	});

	it('falls back to variants when no official matches the predicate', () => {
		const cands = [mk('給我一首歌的時間 (伴奏)'), mk('青花瓷')];
		const found = findOfficial(
			cands,
			'給我一首歌的時間',
			(c) => c.title.includes('伴奏')
		);
		expect(found?.title).toBe('給我一首歌的時間 (伴奏)');
	});

	it('returns undefined when nothing matches', () => {
		expect(findOfficial([mk('青花瓷')], '給我一首歌的時間', () => false)).toBeUndefined();
	});
});

describe('pickOfficial', () => {
	it('picks the best-scoring official, ignoring higher-scoring variants', () => {
		const cands = [mk('給我一首歌的時間 (伴奏)'), mk('給我一首歌的時間')];
		// Score fn deliberately favors the 伴奏 — the prioritizer must still pick the official.
		const picked = pickOfficial(
			cands,
			{ artist: '周杰伦', title: '給我一首歌的時間' },
			(_q, c) => (c.title.includes('伴奏') ? 100 : 1)
		);
		expect(picked?.title).toBe('給我一首歌的時間');
	});

	it('picks the best variant when no official exists', () => {
		const cands = [mk('給我一首歌的時間 (伴奏)'), mk('給我一首歌的時間 (Live)')];
		const picked = pickOfficial(
			cands,
			{ artist: '周杰伦', title: '給我一首歌的時間' },
			(_q, c) => (c.title.includes('Live') ? 10 : 1)
		);
		expect(picked?.title).toBe('給我一首歌的時間 (Live)');
	});

	it('returns null for an empty list', () => {
		expect(pickOfficial([], { artist: 'a', title: 't' }, () => 1)).toBeNull();
	});
});
