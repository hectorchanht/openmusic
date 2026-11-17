// quick-261102-t7i (DECISIONS.md §4) — characterization + invariants for THE pool ranker.
import { describe, it, expect, beforeAll } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import { dedupeBest } from '$lib/services/dedupe';
import { rankPool, rankAutoCandidates } from '$lib/services/song-variant';
import { scoreMatch } from '$lib/services/score-match';
import { computeSetContext } from '$lib/services/score-context';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

function mk(source: SourceId, id: string, title: string, extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, id), source, songid: id, title, artist: '陳百強', album: '', cover: null,
		audioUrl: null, lrc: null, lrcUrl: null, detailsLoaded: false, quality: null,
		qualityLabel: null, keyword: 'x', displayIndex: 0, ...extra
	};
}

beforeAll(async () => {
	await warmScript('zh-Hans');
});

describe('one pool ranker (quick-261102-t7i)', () => {
	const clean = () => mk('qq', 'c', '偏偏喜歡你', { duration: 236 });
	const ring = () => mk('suyin', 'r', '偏偏喜歡你（鈴聲）', { duration: 48, qualityLabel: '320K' });
	const live = () => mk('joox', 'l', '偏偏喜歡你 (Live)', { duration: 250, qualityLabel: 'LOSSLESS' });

	it('dedupe never lets a variant represent the song over its clean cut (偏偏喜歡你)', () => {
		expect(dedupeBest([ring(), live(), clean()])[0].uid).toBe('qq:c');
	});

	it('same pool ⇒ same top pick: search ranker, auto-pick ranker and VersionPicker order agree', () => {
		const pool = [ring(), live(), clean()];
		const q = { artist: '陳百強', title: '偏偏喜歡你' };
		const search = rankPool(pool, q.title, { score: (c) => scoreMatch(q, c) });
		const auto = rankAutoCandidates(pool, q);
		expect(search[0].uid).toBe('qq:c');
		expect(auto[0].uid).toBe('qq:c');
		// full order: clean → full-length variant → short clip
		expect(search.map((t) => t.uid)).toEqual(['qq:c', 'joox:l', 'suyin:r']);
		expect(auto.map((t) => t.uid)).toEqual(search.map((t) => t.uid));
	});

	it('one variant list: scoreMatch now penalizes markers only the partition knew (消音/KTV/remaster)', () => {
		const q = { artist: 'A', title: 'Song' };
		const base = { ...mk('qq', 'x', 'Song'), artist: 'A' };
		for (const t of ['Song (消音)', 'Song KTV', 'Song (Remaster)']) {
			expect(scoreMatch(q, { ...base, title: t })).toBeLessThan(scoreMatch(q, base));
		}
	});
});

// quick-261116-srchrank (Hector 2026-11-16, live screenshot): query "blue bigbang" ranked the
// exact song BLUE/BIGBANG at ~#16 — the search page scores the whole query in BOTH slots, and
// matchKey glues it to one token "bluebigbang", so the split candidate (artist BIGBANG +
// title BLUE) matched on NO path and similarity was 0; title-length proximity to the query
// then floated every longer same-artist title above it. The combined-token exact term in
// similarity() fixes the whole "title artist" / "artist title" query class.
describe('title+artist query exactness (quick-261116-srchrank)', () => {
	const bb = (source: SourceId, id: string, title: string, artist: string) =>
		mk(source, id, title, { artist, keyword: 'blue bigbang' });
	const pool = () => [
		bb('ytmusic', 'v1', 'Hotspur Stadium, London', 'Dana'),
		bb('qq', 'h1', '하루하루 Haru Haru', 'BIGBANG'),
		bb('qq', 'l1', 'LAST DANCE', 'BIGBANG'),
		bb('qq', 'bb1', 'BANG BANG BANG', 'BIGBANG'),
		bb('qq', 'bd1', 'Bad Boy', 'BIGBANG'),
		bb('qq', 'mv1', 'BIGBANG - BLUE M/V', 'BIGBANG'),
		bb('joox', 'blue1', 'BLUE', 'BIGBANG'),
		bb('ytmusic', 'bg1', 'Blue Groove', 'Bangbang123')
	];
	// The search page's exact call shape: whole query in both slots + set context.
	const rankSearch = (rows: Track[], query: string) => {
		const ctx = computeSetContext(rows, query);
		return rankPool(rows, query, { score: (c) => scoreMatch({ artist: query, title: query }, c, ctx) });
	};

	it('"blue bigbang": the exact BLUE / BIGBANG ranks #1 (was #11 of 14 pre-fix)', () => {
		const ranked = rankSearch(pool(), 'blue bigbang');
		expect(ranked[0].uid).toBe('joox:blue1');
		// The fan/uploader rows sink below every authentic BIGBANG row.
		expect(ranked.findIndex((t) => t.uid === 'ytmusic:v1')).toBeGreaterThan(
			ranked.findIndex((t) => t.uid === 'qq:bd1')
		);
		expect(ranked.findIndex((t) => t.uid === 'ytmusic:bg1')).toBeGreaterThan(
			ranked.findIndex((t) => t.uid === 'joox:blue1')
		);
	});

	it('"bigbang blue" (artist-first order) also puts BLUE #1 — token coverage is order-free', () => {
		expect(rankSearch(pool(), 'bigbang blue')[0].uid).toBe('joox:blue1');
	});

	it('a title-carried credit ("BIGBANG Blue", blank artist) earns exact too', () => {
		const q = { artist: 'blue bigbang', title: 'blue bigbang' };
		const carried = bb('qq', 'tc', 'BIGBANG Blue', '');
		expect(scoreMatch(q, carried)).toBeGreaterThan(scoreMatch(q, bb('qq', 'x', 'Bad Boy', 'BIGBANG')));
	});

	it('partial coverage does NOT promote: an unrelated same-token row stays low', () => {
		const q = { artist: 'blue bigbang', title: 'blue bigbang' };
		// "Blue" alone (no bigbang anywhere) must not reach exact-level scores.
		expect(scoreMatch(q, bb('qq', 'p', 'Blue', 'Some Indie'))).toBeLessThan(6);
	});
});
