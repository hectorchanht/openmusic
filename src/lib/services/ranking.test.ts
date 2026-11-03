// quick-261102-t7i (DECISIONS.md §4) — characterization + invariants for THE pool ranker.
import { describe, it, expect, beforeAll } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import { dedupeBest } from '$lib/services/dedupe';
import { rankPool, rankAutoCandidates } from '$lib/services/song-variant';
import { scoreMatch } from '$lib/services/score-match';
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
