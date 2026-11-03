// quick-261102-sy0 (DECISIONS.md §3) — characterization + invariants for THE auto-play acceptance.
// Golden fixtures: 說了再見/周杰倫 (cover substitution), 偏偏喜歡你/陳百強 (ringtone variant),
// a duet credit, 別問很可怕/J.Sheon (false unplayable — health-gated source).
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import * as catalog from '$lib/services/catalog';
import { resolveStub } from '$lib/services/discovery';
import { pickJbsouRow } from '$lib/proxy/jbsou';
import { isAutoAcceptable } from '$lib/services/song-variant';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

vi.mock('$lib/stores/actionLog.svelte', () => ({ logAction: vi.fn() }));
vi.mock('$lib/services/name-rescue', async (orig) => ({
	...(await orig<typeof import('$lib/services/name-rescue')>()),
	lookupChineseName: vi.fn(async () => null)
}));

function mk(source: SourceId, id: string, artist: string, title: string, extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, id), source, songid: id, title, artist, album: '', cover: null,
		audioUrl: null, lrc: null, lrcUrl: null, detailsLoaded: false, quality: null,
		qualityLabel: null, keyword: 'x', displayIndex: 0, ...extra
	};
}
const pool = (tracks: Track[]): catalog.SearchResult => ({ perSource: [], interleaved: tracks });

beforeAll(async () => {
	await warmScript('zh-Hans');
});
afterEach(() => vi.restoreAllMocks());

describe('acceptance invariants (hold before and after)', () => {
	it('a covers-only pool resolves to nothing — never a different artist (說了再見/周杰倫)', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(pool([mk('netease', 'c1', '阿傑', '說了再見')]));
		expect(await resolveStub('周杰倫', '說了再見')).toBeNull();
	});
});

describe('one acceptance predicate on every automatic path (quick-261102-sy0)', () => {
	it('discovery ranks the clean cut over its 320K ringtone (no collapse before ranking — 偏偏喜歡你)', async () => {
		const clean = mk('qq', 'clean', '陳百強', '偏偏喜歡你', { duration: 236 });
		const ring = mk('suyin', 'ring', '陳百強', '偏偏喜歡你（鈴聲）', { duration: 48, qualityLabel: '320K' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(pool([clean, ring]));
		expect((await resolveStub('陳百強', '偏偏喜歡你'))?.uid).toBe(clean.uid);
	});

	it('a junk-only pool still plays the junk as last resort (product call 2026-11-03)', async () => {
		const ring = mk('suyin', 'ring', '陳百強', '偏偏喜歡你（鈴聲）', { duration: 48 });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(pool([ring]));
		expect((await resolveStub('陳百強', '偏偏喜歡你'))?.uid).toBe(ring.uid);
	});

	it('duet credit containing the target is accepted as the original — discovery and JBSou agree', async () => {
		const duet = mk('qq', 'd', '周杰倫/蔡依林', '不能說的秘密');
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(pool([duet]));
		expect((await resolveStub('周杰倫', '不能說的秘密'))?.uid).toBe(duet.uid);
		const rows = [{ songid: '1', name: '不能說的秘密', artist: '周杰倫/蔡依林', urlPath: 'x' }];
		expect(pickJbsouRow(rows, { title: '不能說的秘密', artist: '周杰倫' })?.songid).toBe('1');
	});

	it('JBSou never takes a different artist with the same title', () => {
		const rows = [{ songid: '9', name: '說了再見', artist: '阿傑', urlPath: 'x' }];
		expect(pickJbsouRow(rows, { title: '說了再見', artist: '周杰倫' })).toBeNull();
	});

	it('isAutoAcceptable: 阿傑 ≠ 阿傑正傳, Jay ≠ Jay Park, an instrumental is not the song', () => {
		expect(isAutoAcceptable({ artist: '阿傑', title: 'X' }, { artist: '阿傑正傳', title: 'X' })).toBe(false);
		expect(isAutoAcceptable({ artist: 'Jay', title: 'X' }, { artist: 'Jay Park', title: 'X' })).toBe(false);
		expect(isAutoAcceptable({ artist: 'A', title: '告白氣球' }, { artist: 'A', title: '告白氣球（純音樂版）' })).toBe(false);
	});
});
