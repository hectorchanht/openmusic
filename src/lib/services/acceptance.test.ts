// quick-261102-sy0 (DECISIONS.md §3) — characterization + invariants for THE auto-play acceptance.
// Golden fixtures: 說了再見/周杰倫 (cover substitution), 偏偏喜歡你/陳百強 (ringtone variant),
// a duet credit, 別問很可怕/J.Sheon (false unplayable — health-gated source).
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { warmScript } from '$lib/services/zh-convert';
import * as catalog from '$lib/services/catalog';
import { resolveStub } from '$lib/services/discovery';
import { pickJbsouRow } from '$lib/proxy/jbsou';
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

describe('acceptance divergences (characterization: current behaviour)', () => {
	it('discovery collapses the clean cut into its 320K ringtone before ranking (偏偏喜歡你)', async () => {
		const clean = mk('qq', 'clean', '陳百強', '偏偏喜歡你', { duration: 236 });
		const ring = mk('suyin', 'ring', '陳百強', '偏偏喜歡你（鈴聲）', { duration: 48, qualityLabel: '320K' });
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(pool([clean, ring]));
		expect((await resolveStub('陳百強', '偏偏喜歡你'))?.uid).toBe(ring.uid);
	});

	it('JBSou refuses a duet credit that contains the target artist', () => {
		const rows = [{ songid: '1', name: '不能說的秘密', artist: '周杰倫/蔡依林', urlPath: 'x' }];
		expect(pickJbsouRow(rows, { title: '不能說的秘密', artist: '周杰倫' }, 'netease')).toBeNull();
	});
});
