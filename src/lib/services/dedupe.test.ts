import { describe, it, expect, vi, beforeAll } from 'vitest';
import { dedupeBest, groupVariants, collapseVariants, variantTag, sameSongKey, sameSongStrings, rankByArtistExactness } from './dedupe';
import { warmScript } from './zh-convert';
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

// 32-D-08: the FIRST winner-SOURCE assertions this file has ever carried. Until Phase 32 the
// tie-break rank was justified only in prose (dedupe.ts:8-25) and pinned by nothing, so the
// netease-wins-every-search-row behavior was invisible to the suite. These cases pin the swap AND
// the reason for it: at search time every stub is quality:null → qualityRank 0 → SOURCE_RANK is the
// SOLE tie-break, and a qq survivor is the row that already carries `song_mid` in the search body,
// which is what makes most FIRST plays lossless with no extra lookup (32-D-10b: this rank, not the
// edge mid cache, is the latency lever).
describe('dedupeBest — SOURCE_RANK tie-break (32-D-08)', () => {
	it('qq beats netease on an equal-quality (both null) tie, in EITHER input order', () => {
		const nStub = mk('netease', 'n1', 'Hello', 'Adele');
		const qStub = mk('qq', 'q1', 'Hello', 'Adele', { songMid: '003aAYrm3GE0Ac' });

		const forward = dedupeBest([nStub, qStub]);
		expect(forward).toHaveLength(1);
		expect(forward[0].source).toBe('qq');

		// Reverse order — the win is rank-driven, not first-appearance-driven.
		const reverse = dedupeBest([qStub, nStub]);
		expect(reverse).toHaveLength(1);
		expect(reverse[0].source).toBe('qq');
	});

	it('the surviving row carries the qq song_mid (the 32-D-10b premise, pinned)', () => {
		const nStub = mk('netease', 'n1', 'Hello', 'Adele');
		const qStub = mk('qq', 'q1', 'Hello', 'Adele', { songMid: '003aAYrm3GE0Ac' });
		const winner = dedupeBest([nStub, qStub])[0];
		expect(winner.songMid).toBe('003aAYrm3GE0Ac');
		expect(winner.songid).toBe('q1');
	});

	it('an explicit preferred source still outranks the static rank (existing contract unchanged)', () => {
		const nStub = mk('netease', 'n1', 'Hello', 'Adele');
		const qStub = mk('qq', 'q1', 'Hello', 'Adele', { songMid: '003aAYrm3GE0Ac' });
		expect(dedupeBest([nStub, qStub], 'netease')[0].source).toBe('netease');
		expect(dedupeBest([qStub, nStub], 'netease')[0].source).toBe('netease');
	});
});

// quick-260926-n0r: the same song kept showing twice in the NowPlaying Related tab and Up Next.
// Every row below is a REAL Gareth.T search row (qq / joox / ytmusic). Three identity classes the
// old key() missed: Simplified vs Traditional twins, ytmusic's "<CJK> - <english>" titles, and
// bilingual "<Han> <Latin>" titles whose ytmusic copy drops the Han.
describe('key() cross-script + bilingual identity (quick-260926-n0r)', () => {
	const G = 'Gareth.T';
	beforeAll(async () => {
		await warmScript('zh-Hans');
	});

	it.each([
		['浅粉红 pale pink', '淺粉紅 pale pink'],
		['紧急联络人', '緊急聯絡人'],
		['颜色', '顏色'],
		['去北极忘记你', '去北極忘記你']
	])('script twins collapse: qq %s == joox %s', (simp, trad) => {
		const pair = [mk('joox', 'j1', trad, G), mk('qq', 'q1', simp, G)];
		const out = dedupeBest(pair);
		expect(out).toHaveLength(1);
		expect(out[0].source).toBe('qq');
		expect(groupVariants(pair).size).toBe(1);
	});

	it.each([
		['玻璃 - glass', '玻璃'],
		['用背脊唱情歌 - no full frontal', '用背脊唱情歌'],
		['國際孤獨等級 - loner anthem', '国际孤独等级'],
		['早到的U - your ride is here', '早到的U'],
		['顏色 - colors', '颜色'],
		['泥菩薩 - thanos', '泥菩萨'],
		['緊急聯絡人 - emergency contact', '紧急联络人']
	])('ytmusic english suffix collapses: %s == qq %s', (yt, qq) => {
		const out = dedupeBest([mk('ytmusic', 'y1', yt, G), mk('qq', 'q1', qq, G)]);
		expect(out).toHaveLength(1);
		expect(out[0].source).toBe('qq');
	});

	it('the playing qq song matches its ytmusic Traditional + english copy (Related self-appearance)', () => {
		expect(sameSongKey(mk('qq', 'q1', '跟悲伤结了帐', G), mk('ytmusic', 'y1', '跟悲傷結了帳 - No More', G))).toBe(true);
	});

	it('a bilingual "<Han> <Latin>" title collapses with its Latin-only twin; pale pink != baby pink', () => {
		const palePink = [mk('qq', 'q1', '浅粉红 pale pink', G), mk('ytmusic', 'y1', 'pale pink', G)];
		const babyPink = [mk('joox', 'j1', '淺粉紅 baby pink', G), mk('ytmusic', 'y2', 'baby pink', G)];
		expect(dedupeBest(palePink)).toHaveLength(1);
		expect(dedupeBest(babyPink)).toHaveLength(1);
		expect(dedupeBest([...palePink, ...babyPink])).toHaveLength(2);
	});

	it('distinct renditions and single-word Latin tails are NOT merged', () => {
		const n = (a: string, b: string) => dedupeBest([mk('ytmusic', 'y1', a, G), mk('qq', 'q1', b, G)]).length;
		expect(n('玻璃 demo - glass demo', '玻璃')).toBe(2);
		expect(n('玻璃 demo - glass demo', '玻璃 demo')).toBe(1);
		expect(dedupeBest([mk('qq', 'q1', '玻璃 - remix', G), mk('qq', 'q2', '玻璃', G)])).toHaveLength(2);
		expect(n('玻璃 - part 2', '玻璃')).toBe(2);
		expect(n('我的 baby', '你的 baby')).toBe(2);
		// no Han anywhere → the pre-fix key, pinning Western identity
		expect(n('Song - Remix', 'Song')).toBe(2);
	});

	// Live E2E rows (Gareth.T search): ytmusic video uploads prefix the title with the track's OWN
	// artist ("gareth.t - …"). Stripped only when that prefix IS the row's artist.
	it('an own-artist "<artist> - " title prefix collapses into the plain song', () => {
		const n = (a: string, aArtist: string, b: string) =>
			dedupeBest([mk('ytmusic', 'y1', a, aArtist), mk('qq', 'q1', b, G)]).length;
		expect(n('gareth.t - 淺粉紅 pale pink (official video)', G, '浅粉红 pale pink')).toBe(1);
		expect(n('gareth.t - 淺粉紅 baby pink (official video)', G, '浅粉红 baby pink')).toBe(1);
		// a different uploader naming the artist in the title is a different row (KLAI piano cover)
		expect(n('Gareth.T - 玻璃 (Glass) - Stripped Piano BGM w/ Lyrics', 'KLAI', '玻璃')).toBe(2);
		// an arrangement tail after the prefix is not a translation — stays its own row
		expect(n('gareth.t - 用背脊唱情歌 canon in d (lyric video)', G, '用背脊唱情歌')).toBe(2);
	});

	it('Up-Next shape: an appended ytmusic copy collapses into the history row and keeps slot 0', () => {
		const out = dedupeBest([
			mk('qq', 'q1', '颜色', G),
			mk('netease', 'n1', 'Hello', 'Adele'),
			mk('ytmusic', 'y1', '顏色 - colors', G)
		]);
		expect(out).toHaveLength(2);
		expect(out[0].title).toBe('颜色');
	});
});

// quick-260927-2wt: a Deezer/Last.fm radio stub (`G.E.M. | 多遠都要在一起`) resolved by a CN source
// (`G.E.M.邓紫棋 | 多远都要在一起`) never anchored into its own slot in queueWithAnchor: the title keys
// already agree after the n0r fold, the ARTIST halves (`gem` vs `gem邓紫棋`) did not. Artists are
// always passed explicitly here — mk()'s default artist 'a' would hide an alias bug.
describe('sameSongKey — bilingual artist alias (quick-260927-2wt)', () => {
	const T_TRAD = '多遠都要在一起';
	const T_SIMP = '多远都要在一起';
	beforeAll(async () => {
		await warmScript('zh-Hans');
	});

	it('the observed radio pair matches, both ways', () => {
		const stub = mk('joox', 's1', T_TRAD, 'G.E.M.');
		const resolved = mk('qq', 'q1', T_SIMP, 'G.E.M.邓紫棋');
		expect(sameSongKey(stub, resolved)).toBe(true);
		expect(sameSongKey(resolved, stub)).toBe(true);
	});

	it('regression pins: pure script twin and the Last.fm-style Han-only alias', () => {
		expect(sameSongKey(mk('joox', 'j1', T_TRAD, '鄧紫棋'), mk('qq', 'q1', T_SIMP, '邓紫棋'))).toBe(true);
		expect(sameSongKey(mk('joox', 'j1', T_TRAD, '鄧紫棋'), mk('qq', 'q1', T_SIMP, 'G.E.M. 鄧紫棋'))).toBe(true);
	});

	it('different songs stay apart', () => {
		const s = (ta: string, aa: string, tb: string, ab: string) => sameSongKey(mk('qq', 'q1', ta, aa), mk('joox', 'j1', tb, ab));
		// same alias artists, different title
		expect(s(T_SIMP, 'G.E.M.', '泡沫', 'G.E.M.邓紫棋')).toBe(false);
		// runs compare WHOLE, never as substrings
		expect(s('Hello', 'A', 'Hello', 'A-Lin')).toBe(false);
		expect(s('Hello', 'Jay', 'Hello', 'Jay Chou')).toBe(false);
		// shared Latin run, different Han runs — neither side a subset
		expect(s(T_SIMP, 'G.E.M.某', T_SIMP, 'G.E.M.另')).toBe(false);
		// a blank artist on one side, then both
		expect(s(T_SIMP, '', T_SIMP, 'G.E.M.邓紫棋')).toBe(false);
		expect(s(T_SIMP, 'G.E.M.邓紫棋', T_SIMP, '')).toBe(false);
		// both blank: no alias rule applies, the exact-key rule is today's (unchanged) behaviour
		expect(s(T_SIMP, '', T_SIMP, '')).toBe(true);
		// two unrelated artists, same title
		expect(s(T_SIMP, 'Adele', T_SIMP, 'G.E.M.邓紫棋')).toBe(false);
	});

	// debug album-rows-miss-liked-downloaded-on-load: the raw-string form library.stubTrack uses to
	// match an {artist,title} stub row against a persisted entry — same predicate, no Track needed.
	it('sameSongStrings is the raw-string form of sameSongKey', () => {
		expect(sameSongStrings('G.E.M.', T_TRAD, 'G.E.M.邓紫棋', T_SIMP)).toBe(true);
		expect(sameSongStrings('G.E.M.', T_SIMP, 'G.E.M.邓紫棋', '泡沫')).toBe(false);
		expect(sameSongStrings('', '', 'G.E.M.', T_SIMP)).toBe(false);
	});

	it('key() is NOT loosened: dedupeBest / groupVariants keep the pair as 2 rows', () => {
		const pair = [mk('joox', 's1', T_TRAD, 'G.E.M.'), mk('qq', 'q1', T_SIMP, 'G.E.M.邓紫棋')];
		expect(dedupeBest(pair)).toHaveLength(2);
		expect(groupVariants(pair).size).toBe(2);
	});

	it('queueWithAnchor lookup: the resolved anchor finds its stub at slot 2 (was -1)', () => {
		const list = [mk('qq', 'q9', '泡沫', 'G.E.M.'), mk('netease', 'n2', '光年之外', 'G.E.M.'), mk('joox', 's1', T_TRAD, 'G.E.M.')];
		const anchor = mk('qq', 'q1', T_SIMP, 'G.E.M.邓紫棋');
		expect(dedupeBest(list).findIndex((t) => sameSongKey(t, anchor))).toBe(2);
	});
});

// quick-261006-aex: rankByArtistExactness — the artist page's hit songs are search hits, so a
// fuzzy upstream can outrank the artist's own songs. Tiers: 0 exact, 1 collaboration/alias,
// 2 everything else (kept, demoted). Stable within a tier.
describe('rankByArtistExactness — hit songs prioritize artist-name exactness', () => {
	beforeAll(async () => {
		await warmScript('zh-Hans');
	});
	const artists = (ts: Track[]) => ts.map((t) => t.artist);
	it('puts the exact artist first, demoting fuzzy lookalikes', () => {
		const tracks = [
			mk('qq', 'q1', 'Hara Kiri', 'Hara Kiri'),
			mk('qq', 'q2', 'ne.kurili', 'Карина Полякова'),
			mk('qq', 'q3', '20 Questions', 'Kiri T')
		];
		expect(artists(rankByArtistExactness(tracks, 'Kiri T'))).toEqual(['Kiri T', 'Hara Kiri', 'Карина Полякова']);
	});
	it('is case/punct/space-insensitive for the exact tier', () => {
		const tracks = [mk('qq', 'q1', 'a', 'Hara Kiri'), mk('qq', 'q2', 'b', 'kiri t'), mk('qq', 'q3', 'c', 'Kiri T.')];
		expect(artists(rankByArtistExactness(tracks, 'Kiri T'))).toEqual(['kiri t', 'Kiri T.', 'Hara Kiri']);
	});
	it('drops feat. tails before comparing', () => {
		const tracks = [mk('qq', 'q1', 'a', 'Hara Kiri'), mk('qq', 'q2', 'b', 'Kiri T (feat. MC)')];
		expect(artists(rankByArtistExactness(tracks, 'Kiri T'))[0]).toBe('Kiri T (feat. MC)');
	});
	it('ranks collaborations tier 1 via whole-run subset, not substring', () => {
		const tracks = [
			mk('qq', 'q1', 'Shield', 'Hara Kiri'),
			mk('qq', 'q2', '世一', 'MC 張天賦/Kiri T'),
			mk('qq', 'q3', '20 Questions', 'Kiri T')
		];
		// "Hara Kiri" merely CONTAINS "kiri" as a substring — whole runs don't subset-match,
		// so it stays tier 2 while the real collaboration lands tier 1.
		expect(artists(rankByArtistExactness(tracks, 'Kiri T'))).toEqual([
			'Kiri T',
			'MC 張天賦/Kiri T',
			'Hara Kiri'
		]);
	});
	it('folds Traditional/Simplified for tier 1, below script-exact tier 0', () => {
		// quick-261010-exact: a folded-only match is no longer "exact" — 姜涛 (a mainland folk
		// singer) must not outrank Keung To's own tracks on the 姜濤 page. It still outranks a
		// total stranger (tier 2).
		const tracks = [
			mk('qq', 'q1', 'a', 'Hara Kiri'),
			mk('qq', 'q2', 'b', '张天赋'),
			mk('qq', 'q3', 'c', '張天賦')
		];
		expect(artists(rankByArtistExactness(tracks, '張天賦'))).toEqual(['張天賦', '张天赋', 'Hara Kiri']);
	});
	it('puts the exact artist first, demoting a same-folded different person (姜濤 vs 姜涛)', () => {
		// The reported case: ytmusic/fivesing credit the mainland folk singer 姜涛, joox credits
		// the real 姜濤, qq/netease credit "Keung To 姜涛". Aliases come from the page's
		// MusicBrainz identity ({en:'Keung To', zh-Hant:'姜濤', zh-Hans:'姜涛'}).
		const aliases = ['Keung To', '姜涛', '姜濤'];
		const tracks = [
			mk('ytmusic', 'y1', '三顾', '姜涛'), // mainland singer — folded twin, tier 1
			mk('joox', 'j1', '你要倔強', '姜濤'), // script-exact — tier 0
			mk('fivesing', 'f1', '农民', '姜涛'), // mainland singer — tier 1
			mk('qq', 'q1', '蒙着嘴说爱你', 'Keung To 姜涛'), // distinctive alias — tier 0
			mk('kuwo', 'k1', '常回家看看', '江涛'), // different person entirely — tier 2
			mk('netease', 'n1', '流星雨', '李幸倪/Keung To 姜涛') // duet via alias — tier 0
		];
		expect(artists(rankByArtistExactness(tracks, '姜濤', aliases))).toEqual([
			'姜濤',
			'Keung To 姜涛',
			'李幸倪/Keung To 姜涛',
			'姜涛',
			'姜涛',
			'江涛'
		]);
	});
	it('the script-twin alias alone never promotes (it names a different person here)', () => {
		// Only the folded twin is known — the mainland singer's tracks must stay tier 1,
		// never tier 0.
		const tracks = [mk('ytmusic', 'y1', '三顾', '姜涛'), mk('joox', 'j1', '你要倔強', '姜濤')];
		expect(artists(rankByArtistExactness(tracks, '姜濤', ['姜涛']))).toEqual(['姜濤', '姜涛']);
	});
	it('without aliases the ranking degrades to the folded behaviour', () => {
		const tracks = [mk('ytmusic', 'y1', '三顾', '姜涛'), mk('joox', 'j1', '你要倔強', '姜濤')];
		expect(artists(rankByArtistExactness(tracks, '姜濤'))).toEqual(['姜濤', '姜涛']);
	});
	it('is stable within a tier and never drops rows', () => {
		const tracks = [
			mk('qq', 'q1', 'b-song', 'Kiri T'),
			mk('qq', 'q2', 'junk', 'Someone Else'),
			mk('qq', 'q3', 'a-song', 'Kiri T'),
			mk('qq', 'q4', 'no-artist', '')
		];
		const ranked = rankByArtistExactness(tracks, 'Kiri T');
		expect(ranked).toHaveLength(4);
		expect(ranked.map((t) => t.title)).toEqual(['b-song', 'a-song', 'junk', 'no-artist']);
		expect(tracks[0].title).toBe('b-song'); // input not mutated
	});
	it('blank page artist proves nothing — everything stays in relevance order', () => {
		const tracks = [mk('qq', 'q1', 'b', 'Kiri T'), mk('qq', 'q2', 'a', 'Hara Kiri')];
		expect(artists(rankByArtistExactness(tracks, ''))).toEqual(['Kiri T', 'Hara Kiri']);
	});
});

// quick-260926-n0r: cold t2s dict. MUST stay the last block — resetModules hands back a fresh
// zh-convert whose sync handle is null, so this is the first-paint case: no fold, no throw, and
// key() itself fires warmT2S so a later call folds (no explicit warm here).
describe('key() with the t2s dict cold (quick-260926-n0r)', () => {
	it('degrades to no-fold, never throws, and self-warms so a later call folds', async () => {
		vi.resetModules();
		const fresh = await import('./dedupe');
		const pair = [mk('qq', 'q1', '颜色', 'Gareth.T'), mk('joox', 'j1', '顏色', 'Gareth.T')];
		expect(() => fresh.dedupeBest(pair)).not.toThrow();
		expect(fresh.dedupeBest(pair)).toHaveLength(2);
		await vi.waitFor(() => expect(fresh.dedupeBest(pair)).toHaveLength(1), { timeout: 5000 });
	}, 10_000);
});
