// quick-261102-t7i (DECISIONS.md §4) — characterization + invariants for THE pool ranker.
import { describe, it, expect, beforeAll } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import { dedupeBest } from '$lib/services/dedupe';
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

describe('ranking divergences (characterization: current behaviour)', () => {
	it('dedupeBest collapses a clean cut into its higher-quality ringtone (偏偏喜歡你)', () => {
		const clean = mk('qq', 'c', '偏偏喜歡你', { duration: 236 });
		const ring = mk('suyin', 'r', '偏偏喜歡你（鈴聲）', { duration: 48, qualityLabel: '320K' });
		expect(dedupeBest([clean, ring])[0].uid).toBe(ring.uid);
	});
});
