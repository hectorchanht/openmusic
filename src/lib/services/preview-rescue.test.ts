import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';
import { warmScript } from './zh-convert';

// Hector 2026-11-19 — the preview rescue. The incident: QQ mid 003b8p2c1T2JPF
// （永不失聯的愛 · 周興哲） is a paywall preview — tang reports `song_play_time: 60` and the
// file is exactly 60.0s — while the full 258s studio cut exists on kuwo (rid 37428520) and
// on QQ itself (mid 004c4CEB3jfz7a). A direct play (search tap, queue, share-link pin)
// never ran any duration arbitration, so the preview played as "the song". These tests pin
// findFullVersion's contract: substitute ONLY a confirmed full version of the same song by
// the same artist; genuine short tracks and unconfirmable pools play the chosen track.

vi.mock('$lib/services/catalog', () => ({ searchAll: vi.fn(), ensureTrackDetails: vi.fn() }));
// Every source is on the auto-resolve floor in these tests — the ytmusic exclusion has its
// own pins in fallback.test.ts; here it would only obscure the duration logic.
vi.mock('$lib/sources/registry', () => ({ isAutoResolveEligible: () => true }));

import { findFullVersion } from './preview-rescue';
import { searchAll, ensureTrackDetails } from '$lib/services/catalog';

const mockSearch = vi.mocked(searchAll);
const mockEnsure = vi.mocked(ensureTrackDetails);

function mk(
	source: SourceId,
	songid: string,
	artist: string,
	title: string,
	opts: { duration?: number; audioUrl?: string | null } = {}
): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title,
		artist,
		album: '',
		cover: null,
		audioUrl: opts.audioUrl ?? null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1,
		duration: opts.duration
	};
}

/** The incident's chosen track: the QQ preview, resolved (duration stamped 60 by resolve). */
const chosenPreview = () =>
	mk('qq', '003b8p2c1T2JPF', '周興哲', '永不失聯的愛', {
		duration: 60,
		audioUrl: 'https://isure6.stream.qqmusic.qq.com/C400003b8p2c1T2JPF.m4a'
	});

/** A search pool answer in catalog.searchAll's shape (only `interleaved` is read). */
function pool(rows: Track[]) {
	return { interleaved: rows, perSource: [] } as unknown as Awaited<
		ReturnType<typeof searchAll>
	>;
}

/** ensureTrackDetails stub: resolves each candidate by uid from a table (default: itself). */
function ensureBy(table: Record<string, Track | Error>) {
	mockEnsure.mockImplementation(async (t: Track) => {
		const hit = table[t.uid];
		if (hit instanceof Error) throw hit;
		return hit ?? t;
	});
}

// The identity gates fold Traditional→Simplified (the chosen track arrives with the
// share URL's Traditional 周興哲； the APIs credit Eric周兴哲 in Simplified). In production
// searchAll's foldScriptReady warms the converter before findFullVersion's gates run;
// with catalog mocked here, the test warms it explicitly (song-variant.test.ts's idiom).
beforeAll(async () => {
	await warmScript('zh-Hans');
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('findFullVersion — the incident shape', () => {
	it('substitutes QQ’s own full mid (resolves to 258s) for the exactly-60s preview', async () => {
		// Candidate rows carry the APIs' real shape: Simplified titles, "Eric周兴哲" credit —
		// the chosen (from Hector's share URL) is Traditional. The gates must still match.
		const qqFullRow = mk('qq', '004c4CEB3jfz7a', 'Eric周兴哲', '永不失联的爱');
		const kuwoRow = mk('kuwo', '37428520', 'Eric周兴哲', '永不失联的爱');
		mockSearch.mockResolvedValue(pool([kuwoRow, qqFullRow]));
		ensureBy({
			[qqFullRow.uid]: mk('qq', '004c4CEB3jfz7a', 'Eric周兴哲', '永不失联的爱', {
				duration: 258,
				audioUrl: 'https://isure6.stream.qqmusic.qq.com/C600002mczHt0EWaSk.m4a'
			}),
			[kuwoRow.uid]: mk('kuwo', '37428520', 'Eric周兴哲', '永不失联的爱', {
				audioUrl: 'https://car-er.kuwo.cn/full.mflac'
			})
		});
		const full = await findFullVersion(chosenPreview());
		// The CONFIRMED full version wins over the duration-silent kuwo tentative, even
		// though kuwo's row came first in the pool.
		expect(full?.uid).toBe(qqFullRow.uid);
		expect(full?.duration).toBe(258);
	});

	it('accepts a duration-silent full candidate when a search row proves the song runs 258s', async () => {
		const kugouRow = mk('kugou', 'kg1', '周兴哲', '永不失联的爱', { duration: 258 });
		const kuwoRow = mk('kuwo', '37428520', 'Eric周兴哲', '永不失联的爱');
		mockSearch.mockResolvedValue(pool([kugouRow, kuwoRow]));
		ensureBy({
			// kugou's own resolve fails — its ROW duration still proves the song is long.
			[kugouRow.uid]: new Error('kugou resolve failed'),
			[kuwoRow.uid]: mk('kuwo', '37428520', 'Eric周兴哲', '永不失联的爱', {
				audioUrl: 'https://car-er.kuwo.cn/full.mflac'
			})
		});
		const full = await findFullVersion(chosenPreview());
		expect(full?.uid).toBe(kuwoRow.uid);
	});

	it('never substitutes another preview: a pool of 60s files returns null', async () => {
		const neRow = mk('netease', 'ne1', '周兴哲', '永不失聯的愛');
		mockSearch.mockResolvedValue(pool([neRow]));
		ensureBy({
			[neRow.uid]: mk('netease', 'ne1', '周兴哲', '永不失聯的愛', {
				duration: 60,
				audioUrl: 'https://m801.music.126.net/preview.mp3'
			})
		});
		expect(await findFullVersion(chosenPreview())).toBeNull();
	});

	it('a different artist’s full-length cover is NOT a substitute (artist gate)', async () => {
		const coverRow = mk('kuwo', '999', '單依純', '永不失聯的愛', { duration: 258 });
		mockSearch.mockResolvedValue(pool([coverRow]));
		ensureBy({
			[coverRow.uid]: mk('kuwo', '999', '單依純', '永不失聯的愛', {
				duration: 258,
				audioUrl: 'https://car-er.kuwo.cn/cover.mflac'
			})
		});
		expect(await findFullVersion(chosenPreview())).toBeNull();
		expect(mockEnsure).not.toHaveBeenCalled();
	});
});

describe('findFullVersion — genuine short tracks are untouched', () => {
	it('all sources agree the song is ~1 minute (durations reported) → null, no resolves spent', async () => {
		const chosen = mk('qq', 'short1', '周杰倫', 'Intro', { duration: 60, audioUrl: 'https://x/y.m4a' });
		mockSearch.mockResolvedValue(
			pool([
				mk('kugou', 'k1', '周杰倫', 'Intro', { duration: 62 }),
				mk('migu', 'm1', '周杰倫', 'Intro', { duration: 58 })
			])
		);
		expect(await findFullVersion(chosen)).toBeNull();
		expect(mockEnsure).not.toHaveBeenCalled();
	});

	it('pool rows are duration-silent and resolve to ~60s too → null (no preview-for-preview swap)', async () => {
		const chosen = mk('qq', 'short1', '周杰倫', 'Intro', { duration: 60, audioUrl: 'https://x/y.m4a' });
		const kuwoRow = mk('kuwo', 'k9', '周杰倫', 'Intro');
		mockSearch.mockResolvedValue(pool([kuwoRow]));
		ensureBy({
			[kuwoRow.uid]: mk('kuwo', 'k9', '周杰倫', 'Intro', { duration: 61, audioUrl: 'https://x/z.mp3' })
		});
		expect(await findFullVersion(chosen)).toBeNull();
	});
});

// Hector 2026-11-19 generalisation — the junk class. A junk MARKER in the title is the
// second suspect trigger: the row's duration may be unknown (qq/kuwo rows carry none) or
// even full-looking (a sped edit), but the title itself convicts it. The rescue searches
// by the STRIPPED title, and only an official-titled candidate may substitute.
describe('findFullVersion — junk-title rescue (ringtone / sped / fragment)', () => {
	const chosenRingtone = () =>
		mk('kugou', 'ring1', '周興哲', '永不失聯的愛（48秒鈴聲版）', {
			audioUrl: 'https://car-er.kuwo.cn/ringtone.mp3'
		});

	it('a ringtone row (duration unknown) is rescued to the canonical cut, searched by its stripped title', async () => {
		const qqFullRow = mk('qq', '004c4CEB3jfz7a', 'Eric周兴哲', '永不失联的爱');
		mockSearch.mockResolvedValue(pool([qqFullRow]));
		ensureBy({
			[qqFullRow.uid]: mk('qq', '004c4CEB3jfz7a', 'Eric周兴哲', '永不失联的爱', {
				duration: 258,
				audioUrl: 'https://isure6.stream.qqmusic.qq.com/C600002mczHt0EWaSk.m4a'
			})
		});
		const full = await findFullVersion(chosenRingtone());
		expect(full?.uid).toBe(qqFullRow.uid);
		// The FIRST search is the junkless query — no ringtone dressing on it.
		const firstQuery = String(mockSearch.mock.calls[0][0]);
		expect(firstQuery).toContain('永不失聯的愛');
		expect(firstQuery).not.toContain('鈴聲');
	});

	it('a sped-up edit with a plausible duration (190s) is still rescued — the marker convicts it', async () => {
		const chosen = mk('kuwo', 'sped1', '周興哲', '永不失聯的愛（加速版）', {
			duration: 190,
			audioUrl: 'https://car-er.kuwo.cn/sped.mp3'
		});
		const qqFullRow = mk('qq', '004c4CEB3jfz7a', 'Eric周兴哲', '永不失联的爱');
		mockSearch.mockResolvedValue(pool([qqFullRow]));
		ensureBy({
			[qqFullRow.uid]: mk('qq', '004c4CEB3jfz7a', 'Eric周兴哲', '永不失联的爱', {
				duration: 258,
				audioUrl: 'https://isure6.stream.qqmusic.qq.com/C600002mczHt0EWaSk.m4a'
			})
		});
		expect((await findFullVersion(chosen))?.uid).toBe(qqFullRow.uid);
	});

	it('junk never replaces junk: a pool holding only a full-length 環繞 re-encode returns null', async () => {
		const surroundRow = mk('kuwo', 'sur1', '周興哲', '永不失聯的愛（環繞版）');
		mockSearch.mockResolvedValue(pool([surroundRow]));
		ensureBy({
			[surroundRow.uid]: mk('kuwo', 'sur1', '周興哲', '永不失聯的愛（環繞版）', {
				duration: 258,
				audioUrl: 'https://car-er.kuwo.cn/surround.mp3'
			})
		});
		expect(await findFullVersion(chosenRingtone())).toBeNull();
	});

	it('a junk row with no canonical anywhere plays as-is (empty pool → null)', async () => {
		mockSearch.mockResolvedValue(pool([]));
		expect(await findFullVersion(chosenRingtone())).toBeNull();
	});

	it('a full-length PLAIN-titled track stays outside the gate (no search)', async () => {
		const chosen = mk('kuwo', 'plain1', '周興哲', '永不失聯的愛', {
			duration: 190,
			audioUrl: 'https://car-er.kuwo.cn/plain.mp3'
		});
		expect(await findFullVersion(chosen)).toBeNull();
		expect(mockSearch).not.toHaveBeenCalled();
	});
});

describe('findFullVersion — the suspect gate keeps ordinary plays free', () => {
	it('a full-length chosen track never triggers a search', async () => {
		const chosen = mk('qq', 'full1', '周興哲', '永不失聯的愛', { duration: 258, audioUrl: 'https://x/y.m4a' });
		expect(await findFullVersion(chosen)).toBeNull();
		expect(mockSearch).not.toHaveBeenCalled();
	});

	it('an unknown-duration chosen track never triggers a search (D-03 neutrality)', async () => {
		const chosen = mk('kuwo', '37428520', 'Eric周兴哲', '永不失聯的愛', { audioUrl: 'https://x/y.mflac' });
		expect(await findFullVersion(chosen)).toBeNull();
		expect(mockSearch).not.toHaveBeenCalled();
	});

	it('a search failure degrades to null (the chosen track plays as-is)', async () => {
		mockSearch.mockRejectedValue(new Error('fan-out down'));
		expect(await findFullVersion(chosenPreview())).toBeNull();
	});

	it('an empty pool degrades to null', async () => {
		mockSearch.mockResolvedValue(pool([]));
		expect(await findFullVersion(chosenPreview())).toBeNull();
	});
});
