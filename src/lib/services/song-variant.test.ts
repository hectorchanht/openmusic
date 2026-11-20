import { describe, it, expect } from 'vitest';
import { warmScript } from './zh-convert';
import {
	variantTagsOf,
	isAcceptableSubstitute,
	partitionOfficial,
	rankPool,
	isOfficialTitle,
	bracketQualifier,
	poolExpectedDuration,
	isImplausiblyShort,
	isPreviewSuspect,
	isPreviewLength,
	PREVIEW_BAND_SEC,
	isJunkTitle,
	junklessTitle,
	poolFullDuration,
	rankAutoCandidates,
	candidateTier,
	isNotableVersionMismatch,
	isAutoAcceptableArtist,
	ALLOW_COVER_AS_AUTO_SUBSTITUTE
} from './song-variant';

// quick-261102-t7i: findOfficial / pickOfficial were folded into rankPool; these pin the same
// behaviours through it (first acceptable row / best-scored row of the best pool).
const findOfficial = <T extends { title: string; duration?: number }>(
	c: T[],
	title: string,
	pred: (x: T) => boolean,
	opts?: { expectedSec?: number }
): T | undefined => rankPool(c.filter(pred), title, opts)[0];
const pickOfficial = <T extends { title: string; duration?: number }>(
	c: T[],
	q: { artist: string; title: string },
	scoreFn: (q: { artist: string; title: string }, x: T) => number,
	opts?: { expectedSec?: number }
): T | null => rankPool(c, q.title, { ...opts, score: (x) => scoreFn(q, x) })[0] ?? null;

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

// --- quick-261101-ring1: ringtone incident (Hector, 2026-11-01) --------------------------------
// Playing 陳百強's 偏偏喜歡你 auto-adopted suyin's 偏偏喜歡你（48秒鈴聲版） — a 48-second
// RINGTONE — over clean studio cuts from qq/joox/kuwo/kugou/migu. Three selection defects
// compounded: (1) 鈴聲/彩鈴/環繞/片段 were in NO marker list, so the ringtone classified as an
// OFFICIAL title; (2) ANY bracketed qualifier whose text matched no known tag counted as
// official too; (3) the findOfficial path never looked at duration. These tests pin all three.

describe('quick-261101-ring1 — junk markers + the parenthetical rule', () => {
	it('a ringtone title is NOT official', () => {
		expect(isOfficialTitle('偏偏喜歡你（48秒鈴聲版）')).toBe(false);
		expect(isOfficialTitle('偏偏喜歡你(48秒铃声版)')).toBe(false);
		expect(isOfficialTitle('偏偏喜歡你（彩鈴版）')).toBe(false);
		expect(isOfficialTitle('Song (Ringtone)')).toBe(false);
	});

	it('pseudo-surround / school / edit qualifiers are NOT official — any bracket counts', () => {
		expect(isOfficialTitle('偏偏喜歡你 (3D環繞版)')).toBe(false);
		expect(isOfficialTitle('偏偏喜歡你 (中四版)')).toBe(false);
		expect(isOfficialTitle('偏偏喜歡你 (剪輯版)')).toBe(false);
		expect(isOfficialTitle('Song (Radio Edit)')).toBe(false);
	});

	it('a plain title stays official', () => {
		expect(isOfficialTitle('偏偏喜歡你')).toBe(true);
		expect(isOfficialTitle('Song')).toBe(true);
	});

	it('bracketQualifier reads the first bracketed segment only', () => {
		expect(bracketQualifier('偏偏喜歡你（48秒鈴聲版）')).toBe('48秒鈴聲版');
		expect(bracketQualifier('Song (Live) [Remaster]')).toBe('Live');
		expect(bracketQualifier('偏偏喜歡你')).toBeNull();
		expect(bracketQualifier('Song ()')).toBeNull();
	});

	it('partitionOfficial: for a plain target, every qualified sibling is a variant', () => {
		const { official, variants } = partitionOfficial(
			[
				mk('偏偏喜歡你（48秒鈴聲版）'),
				mk('偏偏喜歡你 (3D環繞版)'),
				mk('偏偏喜歡你'),
				mk('偏偏喜歡你 (原版伴奏)')
			],
			'偏偏喜歡你'
		);
		expect(official.map((t) => t.title)).toEqual(['偏偏喜歡你']);
		expect(variants.map((t) => t.title)).toEqual([
			'偏偏喜歡你（48秒鈴聲版）',
			'偏偏喜歡你 (3D環繞版)',
			'偏偏喜歡你 (原版伴奏)'
		]);
	});

	// Hector's rule, second half: a deliberately-chosen qualified version must NOT be
	// demoted — its matching-qualifier candidates lead the official pool, clean second.
	it('partitionOfficial: a qualified target promotes its OWN qualifier first, clean second', () => {
		const { official, variants } = partitionOfficial(
			[mk('偏偏喜歡你'), mk('偏偏喜歡你 (伴奏)'), mk('偏偏喜歡你 (Live)')],
			'偏偏喜歡你 (Live)'
		);
		expect(official.map((t) => t.title)).toEqual(['偏偏喜歡你 (Live)', '偏偏喜歡你']);
		expect(variants.map((t) => t.title)).toEqual(['偏偏喜歡你 (伴奏)']);
	});

	it('findOfficial picks the clean cut over the ringtone in the incident pool shape', () => {
		const pool = [
			mk('偏偏喜歡你（48秒鈴聲版）'),
			mk('偏偏喜歡你 (3D環繞版)'),
			mk('偏偏喜歡你 (原版伴奏)'),
			mk('偏偏喜歡你')
		];
		const found = findOfficial(pool, '偏偏喜歡你', () => true);
		expect(found?.title).toBe('偏偏喜歡你');
	});

	it('findOfficial still returns the deliberately-chosen Live for a Live target', () => {
		const pool = [mk('偏偏喜歡你'), mk('偏偏喜歡你 (Live)')];
		const found = findOfficial(pool, '偏偏喜歡你 (Live)', () => true);
		expect(found?.title).toBe('偏偏喜歡你 (Live)');
	});
});

describe('quick-261101-ring1 — duration plausibility', () => {
	const mkD = (title: string, duration?: number) => ({ title, artist: '陳百強', duration });

	it('poolExpectedDuration medians the known durations, ignores unknowns', () => {
		expect(poolExpectedDuration([mkD('a', 48), mkD('b', 212), mkD('c', 208), mkD('d', 380)])).toBe(210);
		expect(poolExpectedDuration([mkD('a'), mkD('b')])).toBeUndefined();
		expect(poolExpectedDuration([mkD('a', 200), mkD('b')])).toBe(200);
	});

	it('isImplausiblyShort: sub-60s always; under half the expectation relatively; unknown never', () => {
		expect(isImplausiblyShort(mkD('a', 48))).toBe(true);
		expect(isImplausiblyShort(mkD('a', 59))).toBe(true);
		expect(isImplausiblyShort(mkD('a', 60))).toBe(false);
		expect(isImplausiblyShort(mkD('a', 100), 212)).toBe(true); // < 50% of 212
		expect(isImplausiblyShort(mkD('a', 120), 212)).toBe(false);
		expect(isImplausiblyShort(mkD('a'))).toBe(false);
		expect(isImplausiblyShort(mkD('a', 0))).toBe(false);
	});

	it('findOfficial: a full-length variant beats a SHORT clean-titled clip', () => {
		const pool = [mkD('Song', 40), mkD('Song (Live)', 200)];
		expect(findOfficial(pool, 'Song', () => true)?.title).toBe('Song (Live)');
	});

	it('findOfficial: the short clip is still reachable when it is the ONLY candidate', () => {
		const pool = [mkD('偏偏喜歡你（48秒鈴聲版）', 48)];
		expect(findOfficial(pool, '偏偏喜歡你', () => true)?.title).toBe('偏偏喜歡你（48秒鈴聲版）');
	});

	it('findOfficial: opts.expectedSec (the failed track duration) demotes a half-length cut', () => {
		const pool = [mkD('Song', 100), mkD('Song', 300)];
		// Same title twice (two sources' rows): the 100s row is < 50% of the expected 300.
		expect(findOfficial(pool, 'Song', () => true, { expectedSec: 300 })?.duration).toBe(300);
	});

	it('findOfficial: the incident pool WITH durations — clean studio wins, ringtone last', () => {
		const pool = [
			mkD('偏偏喜歡你（48秒鈴聲版）', 48),
			mkD('偏偏喜歡你 (3D環繞版)', 208),
			mkD('偏偏喜歡你', 212)
		];
		expect(findOfficial(pool, '偏偏喜歡你', () => true)?.title).toBe('偏偏喜歡你');
	});

	it('pickOfficial: scores within the best pool only — a high-scored clip cannot jump pools', () => {
		const pool = [mkD('Song', 40), mkD('Song (Live)', 200)];
		const picked = pickOfficial(pool, { artist: 'a', title: 'Song' }, (_q, c) =>
			c.duration === 40 ? 100 : 1
		);
		expect(picked?.title).toBe('Song (Live)');
	});

	it('candidateTier: clean+plausible = 0; variant or short = 1; chosen qualifier = 0', () => {
		const pool = [mkD('偏偏喜歡你', 212), mkD('偏偏喜歡你（48秒鈴聲版）', 48)];
		expect(candidateTier(mkD('偏偏喜歡你', 212), '偏偏喜歡你', pool)).toBe(0);
		expect(candidateTier(mkD('偏偏喜歡你（48秒鈴聲版）', 48), '偏偏喜歡你', pool)).toBe(1);
		expect(candidateTier(mkD('偏偏喜歡你 (Live)', 300), '偏偏喜歡你', pool)).toBe(1);
		expect(candidateTier(mkD('偏偏喜歡你 (Live)', 300), '偏偏喜歡你 (Live)', pool)).toBe(0);
	});
});

// quick-261102-cov1 (user report 2026-11-02): the artist-identity gate. A tapped
// 周杰倫 track auto-resolved to 阿傑's 同人 cover because no automatic seam ever
// compared the candidate's ARTIST. These pin the gate's accept/refuse shapes.
describe('isAutoAcceptableArtist — artist-identity gate (quick-261102-cov1)', () => {
	it('the policy flip ships OFF (covers are not auto-substitutes)', () => {
		expect(ALLOW_COVER_AS_AUTO_SUBSTITUTE).toBe(false);
	});

	it('same artist passes — including Traditional vs Simplified script', async () => {
		// The 繁/簡 comparison rides foldScript, which is identity while the t2s dict is
		// cold (the same cold/warm property sameSongKey documents) — warm it first,
		// exactly as dedupe.test.ts / discovery.test.ts do for script-fold assertions.
		await warmScript('zh-Hans');
		expect(isAutoAcceptableArtist('周杰倫', '周杰倫')).toBe(true);
		expect(isAutoAcceptableArtist('周杰倫', '周杰伦')).toBe(true);
		expect(isAutoAcceptableArtist('周杰伦', '周杰倫')).toBe(true);
	});

	it('a clearly DIFFERENT artist is refused (the incident pair)', () => {
		expect(isAutoAcceptableArtist('周杰倫', '阿傑')).toBe(false);
		expect(isAutoAcceptableArtist('周杰倫', '張錫陽')).toBe(false);
		expect(isAutoAcceptableArtist('周杰倫', '旺仔小喬')).toBe(false);
	});

	it('a duet / collab credit CONTAINING the target artist passes (either position)', () => {
		expect(isAutoAcceptableArtist('周杰倫', '周杰倫/蔡依林')).toBe(true);
		expect(isAutoAcceptableArtist('周杰倫', '蔡依林/周杰倫')).toBe(true);
		expect(isAutoAcceptableArtist('鄒沛沛', 'Max 李玄/鄒沛沛')).toBe(true);
	});

	it('a duet-credited target accepts its primary artist’s solo credit', () => {
		expect(isAutoAcceptableArtist('周杰倫/蔡依林', '周杰倫')).toBe(true);
	});

	it('a featuring tail is the same act, not a different artist', () => {
		expect(isAutoAcceptableArtist('周杰倫', '周杰倫 feat. 蔡依林')).toBe(true);
		expect(isAutoAcceptableArtist('周杰倫', '周杰倫 (Jay Chou)')).toBe(true);
	});

	it('alias forms pass (G.E.M. ↔ 鄧紫棋 combined credits)', () => {
		expect(isAutoAcceptableArtist('鄧紫棋', 'G.E.M.鄧紫棋')).toBe(true);
		expect(isAutoAcceptableArtist('G.E.M.', 'G.E.M.鄧紫棋')).toBe(true);
	});

	it('blank sides carry no identity to enforce', () => {
		expect(isAutoAcceptableArtist('周杰倫', '')).toBe(true); // unknown-artist candidate
		expect(isAutoAcceptableArtist('', '阿傑')).toBe(true); // title-only target
		expect(isAutoAcceptableArtist('', '')).toBe(true);
	});

	it('a shared name PREFIX is not the same artist (whole-segment rule)', () => {
		expect(isAutoAcceptableArtist('阿傑', '阿傑正傳')).toBe(false);
		expect(isAutoAcceptableArtist('Jay', 'Jay Park')).toBe(false); // different acts, shared first name
		// …while a pure script variant of the SAME name is the same artist （張杰 = 張傑）:
		expect(isAutoAcceptableArtist('張杰', '張傑')).toBe(true);
	});

	it('a group name with connectors still matches itself', () => {
		expect(isAutoAcceptableArtist('Earth, Wind & Fire', 'Earth, Wind & Fire')).toBe(true);
		expect(isAutoAcceptableArtist('Bones & The Boy', 'Bones & The Boy')).toBe(true);
	});
});

describe('43-D-08 — isNotableVersionMismatch', () => {
	it('flags a variant title tag at equal duration', () => {
		expect(
			isNotableVersionMismatch({ title: '晴天 (Live)', duration: 240 }, { title: '晴天', duration: 240 })
		).toBe(true);
	});

	it('flags a duration delta above the 30 s floor', () => {
		expect(isNotableVersionMismatch({ title: '晴天', duration: 280 }, { title: '晴天', duration: 240 })).toBe(true);
	});

	it('stays quiet on a small delta', () => {
		expect(isNotableVersionMismatch({ title: '晴天', duration: 250 }, { title: '晴天', duration: 240 })).toBe(false);
	});

	it('uses 15 % on long songs (beats the 30 s floor)', () => {
		expect(isNotableVersionMismatch({ title: 'Song', duration: 344 }, { title: 'Song', duration: 300 })).toBe(false);
		expect(isNotableVersionMismatch({ title: 'Song', duration: 346 }, { title: 'Song', duration: 300 })).toBe(true);
	});

	it('is neutral on unknown durations', () => {
		expect(isNotableVersionMismatch({ title: 'Song', duration: 200 }, { title: 'Song' })).toBe(false);
		expect(isNotableVersionMismatch({ title: 'Song' }, { title: 'Song', duration: 200 })).toBe(false);
		expect(isNotableVersionMismatch({ title: 'Song', duration: 0 }, { title: 'Song', duration: 200 })).toBe(false);
	});

	it('flags an implausibly short clip', () => {
		expect(isNotableVersionMismatch({ title: 'Song', duration: 20 }, { title: 'Song', duration: 240 })).toBe(true);
	});
});

// Hector 2026-11-19 — the preview band + verdict behind preview-rescue.ts. The incident
// shape: QQ mid 003b8p2c1T2JPF reports EXACTLY 60s (a paywall 試聽） for a song whose full
// studio cut runs 258s. `isImplausiblyShort`'s absolute clause (`d < 60`) waves exactly-60
// through — pinned above at line ~321 — so the preview judgement needs the band + an
// expectation, and the expectation is what keeps genuine ~1-minute songs innocent.
describe('preview band + verdict (Hector 2026-11-19)', () => {
	const mkD = (duration?: number) => ({ title: '永不失聯的愛', artist: '周興哲', duration });

	it('the band is 65s: 60s nominal preview + container slop', () => {
		expect(PREVIEW_BAND_SEC).toBe(65);
	});

	it('isPreviewSuspect: known duration inside the band only; unknown/past-band never', () => {
		expect(isPreviewSuspect(mkD(60))).toBe(true); // the incident's exact length
		expect(isPreviewSuspect(mkD(65))).toBe(true);
		expect(isPreviewSuspect(mkD(66))).toBe(false);
		expect(isPreviewSuspect(mkD(258))).toBe(false);
		expect(isPreviewSuspect(mkD())).toBe(false); // unknown is never a suspect (D-03)
		expect(isPreviewSuspect(mkD(0))).toBe(false);
	});

	it('isPreviewLength: the incident — exactly-60 IS a preview against the 258s full length', () => {
		expect(isPreviewLength(mkD(60), 258)).toBe(true);
		expect(isPreviewLength(mkD(45), 258)).toBe(true);
		expect(isPreviewLength(mkD(150), 258)).toBe(true); // ≤65% of the full length
		expect(isPreviewLength(mkD(200), 258)).toBe(false); // a real cut of the song
		expect(isPreviewLength(mkD(258), 258)).toBe(false);
	});

	it('isPreviewLength: no expectation, no verdict — the band alone never convicts', () => {
		expect(isPreviewLength(mkD(60))).toBe(false);
		expect(isPreviewLength(mkD(60), 0)).toBe(false);
	});

	it('isPreviewLength: a genuine ~1-minute song is innocent against its own pool', () => {
		expect(isPreviewLength(mkD(60), 60)).toBe(false); // every source agrees: ~60s song
		expect(isPreviewLength(mkD(58), 62)).toBe(false);
		expect(isPreviewLength(mkD(60), 70)).toBe(false); // marginally longer ≠ a preview
	});

	it('isPreviewLength: band + a song known ≥30s longer convicts even past the ratios', () => {
		expect(isPreviewLength(mkD(64), 95)).toBe(true);
	});

	it('isPreviewLength: unknown duration is never preview-length', () => {
		expect(isPreviewLength(mkD(), 258)).toBe(false);
		expect(isPreviewLength(mkD(0), 258)).toBe(false);
	});
});

// Hector 2026-11-19 — the DOWN-WEIGHT: the preview verdict feeds the shared ranking, not
// just the play-start rescue. A preview must sort below every full version in rankPool
// (search order / VersionPicker), in candidateTier (dedupe's canonical slot + fallback's
// race) and in rankAutoCandidates (auto-pick / generated queues) — while remaining in the
// pool, reachable as the last resort and by an explicit picker choice. The regression
// shape: pool [60, 62, 258] medians to 62, under which the median-only judgement called
// the 60s preview "plausible" and let it win on quality.
describe('preview down-weight in the shared ranking (Hector 2026-11-19)', () => {
	const mkP = (title: string, duration?: number) => ({ title, artist: '周興哲', duration });
	const pool = () => [
		mkP('永不失聯的愛', 60), // the preview (kugou/migu rows report durations)
		mkP('永不失聯的愛', 62),
		mkP('永不失聯的愛', 258) // the full studio cut
	];

	it('poolFullDuration: the yardstick is the longest OFFICIAL row — variant lengths never set it', () => {
		expect(poolFullDuration(pool(), '永不失聯的愛')).toBe(258);
		const withVariants = [
			...pool(),
			mkP('永不失聯的愛 (DJ版)', 720),
			mkP('永不失聯的愛 (Live)', 400)
		];
		expect(poolFullDuration(withVariants, '永不失聯的愛')).toBe(258);
		expect(poolFullDuration([mkP('永不失聯的愛')], '永不失聯的愛')).toBeUndefined();
	});

	it('candidateTier: the preview is tier 1 and the full cut tier 0 in a median-trap pool', () => {
		const p = pool();
		expect(candidateTier(p[0], '永不失聯的愛', p)).toBe(1);
		expect(candidateTier(p[2], '永不失聯的愛', p)).toBe(0);
	});

	it('rankPool (search order): the full version leads, previews trail — but stay listed', () => {
		const ranked = rankPool(pool(), '永不失聯的愛');
		expect(ranked.map((c) => c.duration)).toEqual([258, 60, 62]);
	});

	it('rankAutoCandidates (auto-pick / generated queues): the full version is the pick', () => {
		const ranked = rankAutoCandidates(pool(), { artist: '周興哲', title: '永不失聯的愛' });
		expect(ranked[0].duration).toBe(258);
		expect(ranked).toHaveLength(3); // down-weighted, never removed
	});

	it('a preview-only pool keeps the preview as the pick (last resort, never blocked)', () => {
		const only = [mkP('Intro', 60), mkP('Intro', 58)];
		const ranked = rankAutoCandidates(only, { artist: '周興哲', title: 'Intro' });
		expect(ranked).toHaveLength(2);
		expect(candidateTier(only[0], 'Intro', only)).toBe(0);
	});
});

// Hector 2026-11-19 — the junk-title gate: the title itself as junk evidence. The marker
// set is Hector's junk drawer （試聽/鈴聲/彩鈴/片段/sped/slowed/剪輯/環繞/升降調）; legitimate
// renditions (Live / Acoustic / 純音樂 / Remix) are NOT click-gate junk — they are demoted
// by the partition, never click-rescued.
describe('junk title gate (Hector 2026-11-19)', () => {
	it.each([
		'晴天（48秒鈴聲版）',
		'晴天（彩鈴版）',
		'晴天 片段',
		'晴天（試聽版）',
		'晴天 加速版',
		'晴天（減速版）',
		'晴天（環繞版）',
		'晴天 剪輯版',
		'Song (Sped Up)',
		'Song (Slowed + Reverb)',
		'Song Nightcore'
	])('isJunkTitle: %s is junk', (title) => {
		expect(isJunkTitle(title)).toBe(true);
	});

	it.each([
		'晴天',
		'晴天 (Live)',
		'晴天（純音樂）',
		'晴天 (Acoustic)',
		'告白氣球',
		'Live While We’re Young'
	])('isJunkTitle: %s is NOT click-gate junk', (title) => {
		expect(isJunkTitle(title)).toBe(false);
	});

	it('junklessTitle strips the dressing for the canonical search', () => {
		expect(junklessTitle('晴天（48秒鈴聲版）')).toBe('晴天');
		expect(junklessTitle('晴天 加速版')).toBe('晴天');
		expect(junklessTitle('Song (Sped Up)')).toBe('Song');
		expect(junklessTitle('晴天')).toBe('晴天');
	});

	it('rankAutoCandidates: a ringtone-titled row ranks below the studio cut', () => {
		const pool = [
			{ title: '晴天（48秒鈴聲版）', artist: '周杰倫', duration: 48 },
			{ title: '晴天', artist: '周杰倫', duration: 258 }
		];
		const ranked = rankAutoCandidates(pool, { artist: '周杰倫', title: '晴天' });
		expect(ranked[0].title).toBe('晴天');
	});
});
