import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// quick-261101-ring1 — REGRESSION for the 2026-11-01 live incident (Hector): playing
// 陳百強's 偏偏喜歡你 auto-adopted suyin's 偏偏喜歡你（48秒鈴聲版） — a 48-second RINGTONE —
// over clean studio cuts on qq/joox/kuwo/kugou/migu. Three defects compounded:
//   (1) 鈴聲/環繞/片段 were in NO variant-marker list → the ringtone classified OFFICIAL;
//   (2) dedupeBest collapsed each source's same-key variants to one quality/first-order
//       winner BEFORE findOfficial's partition ran (the partition arbitrated a pool of one);
//   (3) the playback race's 300ms priority window only arbitrated SOURCE order — suyin
//       answers in one direct fetch with the URL attached, tier-1 sources need search +
//       resolve via the edge proxies, so a fast degraded suyin hit won on speed alone.
// This file has its OWN registry mock (fallback.test.ts's smaller mock stays untouched):
// the full floor incl. suyin (PASS_RATE_RANK 0 — last by Hector's 2026-10-21 call).

const FLOOR: SourceId[] = [
	'qq', 'joox', 'netease', 'gdnetease', 'kuwo', 'suyin', 'kugou', 'migu', 'ytmusic'
];

vi.mock('$lib/sources/registry', () => {
	const SOURCES: Record<string, { id: string; autoResolveEligible?: boolean }> = {
		qq: { id: 'qq' },
		joox: { id: 'joox' },
		netease: { id: 'netease' },
		gdnetease: { id: 'gdnetease' },
		kuwo: { id: 'kuwo' },
		suyin: { id: 'suyin' },
		kugou: { id: 'kugou' },
		migu: { id: 'migu' },
		ytmusic: { id: 'ytmusic', autoResolveEligible: false }
	};
	return {
		SOURCES,
		isAutoResolveEligible: (id: string) => SOURCES[id].autoResolveEligible !== false,
		getEnabledAdapters: vi.fn(() =>
			['qq', 'joox', 'netease', 'gdnetease', 'kuwo', 'suyin', 'kugou', 'migu', 'ytmusic'].map(
				(id) => ({ id })
			)
		),
		onlySource: (id: string) => {
			const prefs: Record<string, boolean> = {};
			for (const s of FLOOR) prefs[s] = false;
			prefs[id] = true;
			return prefs;
		}
	};
});
vi.mock('$lib/services/catalog', () => ({ searchAll: vi.fn(), ensureTrackDetails: vi.fn() }));

import { tryFallback } from './fallback';
import { searchAll, ensureTrackDetails } from '$lib/services/catalog';

const mockSearch = vi.mocked(searchAll);
const mockEnsure = vi.mocked(ensureTrackDetails);

function mk(
	source: SourceId,
	songid: string,
	title: string,
	extra: Partial<Track> = {}
): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title,
		artist: '陳百強',
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

const FAILED = () => mk('joox', 'orig', '偏偏喜歡你', { duration: 212 });

/** Per-source search pools + optional artificial latency (ms), keyed by source id. */
function stubSources(pools: Partial<Record<SourceId, Track[]>>, delays: Partial<Record<SourceId, number>> = {}) {
	mockSearch.mockImplementation(async (_q, _page, prefs) => {
		const p = prefs as Record<string, boolean>;
		const src = (Object.keys(p).find((k) => p[k]) ?? '') as SourceId;
		const wait = delays[src] ?? 0;
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		return { interleaved: pools[src] ?? [], perSource: [] } as never;
	});
	mockEnsure.mockImplementation(async (t: Track) =>
		t.audioUrl ? t : { ...t, audioUrl: 'https://cdn/resolved.mp3', detailsLoaded: true }
	);
}

describe('quick-261101-ring1 — the ringtone incident, end to end through tryFallback', () => {
	beforeEach(() => {
		mockSearch.mockReset();
		mockEnsure.mockReset();
	});

	it('within suyin: the clean full cut beats the ringtone listed FIRST', async () => {
		// Live suyin pool shape (oiapi, 2026-11-01): variants first, quality all "320K" —
		// the old dedupe-collapse + official partition adopted whichever came first.
		stubSources({
			suyin: [
				mk('suyin', 'ring', '偏偏喜歡你（48秒鈴聲版）', { duration: 48, audioUrl: 'https://cdn/ring.mp3', detailsLoaded: true }),
				mk('suyin', 's3d', '偏偏喜歡你 (3D環繞版)', { duration: 208, audioUrl: 'https://cdn/3d.mp3', detailsLoaded: true }),
				mk('suyin', 'clean', '偏偏喜歡你', { duration: 212, audioUrl: 'https://cdn/clean.mp3', detailsLoaded: true })
			]
		});

		const out = await tryFallback(FAILED(), undefined);

		expect(out?.uid).toBe('suyin:clean');
		expect(out?.audioUrl).toBe('https://cdn/clean.mp3');
	});

	it('across sources: a SLOW clean qq cut beats a FAST degraded suyin hit (tier beats speed)', async () => {
		// suyin answers instantly with only variants (the live pool has no clean row);
		// qq needs search + resolve through the proxy — modelled as 500ms slower, well
		// past the old 300ms window that let the ringtone win on arrival order alone.
		stubSources(
			{
				suyin: [
					mk('suyin', 'ring', '偏偏喜歡你（48秒鈴聲版）', { duration: 48, audioUrl: 'https://cdn/ring.mp3', detailsLoaded: true }),
					mk('suyin', 's3d', '偏偏喜歡你 (3D環繞版)', { duration: 208, audioUrl: 'https://cdn/3d.mp3', detailsLoaded: true })
				],
				qq: [mk('qq', 'clean', '偏偏喜歡你', { duration: 212 })]
			},
			{ qq: 500 }
		);

		const out = await tryFallback(FAILED(), undefined);

		expect(out?.uid).toBe('qq:clean');
	});

	it('the ringtone is still adopted when it is literally the ONLY playable candidate', async () => {
		stubSources({
			suyin: [
				mk('suyin', 'ring', '偏偏喜歡你（48秒鈴聲版）', { duration: 48, audioUrl: 'https://cdn/ring.mp3', detailsLoaded: true })
			]
		});

		const out = await tryFallback(FAILED(), undefined);

		expect(out?.uid).toBe('suyin:ring');
	});

	it('a deliberately-chosen Live target still fails over to the Live candidate, not the studio cut', async () => {
		stubSources({
			qq: [
				mk('qq', 'clean', '偏偏喜歡你', { duration: 212 }),
				mk('qq', 'live', '偏偏喜歡你 (Live)', { duration: 300 })
			]
		});
		const failedLive = mk('joox', 'origlive', '偏偏喜歡你 (Live)', { duration: 300 });

		const out = await tryFallback(failedLive, undefined);

		expect(out?.uid).toBe('qq:live');
	});
});
