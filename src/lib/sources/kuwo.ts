// Kuwo client adapter — real port (plan 01-02) of searchKuwo (legacy:2123-2163) +
// fetchKuwoDetails (legacy:2398-2422). The registry already enumerates this entry, so
// 01-02 touches NO shared code (DATA-04).
//
// Differences from the monolith (intentional, mirroring netease.ts):
//   - calls the SAME-ORIGIN proxy /api/kuwo/... instead of kw-api.cenguigui.cn directly
//   - emits the canonical COLON-form uid `kuwo:<rid>` (D-10), not the hyphen form
//   - on contract drift (code!==200 or missing data) search THROWS so catalog's
//     Promise.allSettled records a typed per-source error, instead of the monolith's
//     swallow-and-return-0 (legacy:2129). resolve already threw on code!==200
//     (legacy:2402) — that good model is preserved verbatim.
import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch } from '../services/api-base';
import { settings, type DefaultQuality } from '$lib/stores/settings.svelte';
import { effectiveQuality } from './quality';

// Kuwo search row shape from the kw-api endpoint (fields we read).
interface KuwoSearchItem {
	rid?: string | number;
	name?: string;
	artist?: string;
	album?: string;
	pic?: string;
}

// Kuwo search response envelope.
interface KuwoSearchResponse {
	code?: number;
	data?: KuwoSearchItem[];
}

// Kuwo detail object shape (fields we read).
interface KuwoDetailItem {
	name?: string;
	artist?: string;
	album?: string;
	pic?: string;
	url?: string;
	lyric?: string;
}

// Kuwo detail response envelope.
interface KuwoDetailResponse {
	code?: number;
	data?: KuwoDetailItem;
}

export const kuwo: SourceAdapter = {
	id: 'kuwo',
	label: '酷我音乐',
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// Pagination by limit-multiplication, mirroring netease (page→limit cap).
		const requestLimit = Math.max(1, page || 1) * Math.max(1, 10);
		const path = `/api/kuwo/search?name=${encodeURIComponent(keyword)}&page=1&limit=${encodeURIComponent(
			requestLimit
		)}`;

		const res = await apiFetch(path, { signal });
		const json = (await res.json()) as KuwoSearchResponse | null;

		// Contract-drift guard (legacy:2129 returned 0; we THROW so the fan-out records a
		// typed per-source error rather than silently dropping the source).
		if (!json || json.code !== 200 || !Array.isArray(json.data)) {
			throw new Error('kuwo: contract-drift (expected {code:200,data:[]} search body)');
		}

		const tracks: Track[] = [];
		json.data.forEach((it, idx) => {
			const rid = it.rid;
			if (rid === undefined || rid === null || rid === '') return;
			const songid = String(rid);
			tracks.push({
				uid: makeUid('kuwo', songid), // colon-form kuwo:<rid> (D-10)
				source: 'kuwo',
				songid,
				title: it.name || '',
				artist: it.artist || '',
				album: it.album || '',
				cover: it.pic || null,
				audioUrl: null,
				lrc: null,
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal, quality?: DefaultQuality): Promise<Track> {
		// D-03: `zp` = 臻品/lossless (legacy:2399). When the user pref is the 128–160k
		// band, request a lower level token (`128k`) instead. The proxy forwards any
		// `level` (`searchParams.get('level') || 'zp'`), so NO proxy edit is needed.
		// BEST-EFFORT (A1): the cenguigui kw-api's non-`zp` token is undocumented in-repo;
		// if the upstream ignores/rejects `128k`, Kuwo stays at whatever tier it returns
		// (acceptable per the honest defaultQualityNote).
		// WR-07: an explicit per-call quality (download path) wins over the streaming pref.
		// 32-D-02: resolve the pref through the ONE 'auto' seam FIRST — the literal 'auto'
		// must never reach a tier pick, or a metered connection silently gets the top rung.
		const level = effectiveQuality(quality ?? settings.defaultQuality) === '128' ? '128k' : 'zp';
		const path = `/api/kuwo/detail?id=${encodeURIComponent(track.songid)}&type=song&level=${encodeURIComponent(level)}&format=json`;

		const res = await apiFetch(path, { signal });
		const j = (await res.json()) as KuwoDetailResponse | null;
		// Preserve the legacy throw on code!==200 / missing data (legacy:2402) — the one
		// detail fetcher that already threw, kept verbatim.
		if (!j || j.code !== 200 || !j.data) {
			throw new Error('kuwo kw-api detail failed');
		}

		const d = j.data;
		Object.assign(track, {
			// quick-260712-4xg: prefer the title the track already carries (the VersionPicker plays
			// an EXACT chosen variant; overwriting with d.name showed the source's canonical name
			// instead of the picked version). Fall back to d.name only for a title-less stub.
			// Matches netease.resolve (no title overwrite).
			title: track.title || d.name,
			artist: d.artist || track.artist,
			album: d.album || track.album,
			cover: d.pic || track.cover,
			audioUrl: d.url || track.audioUrl,
			lrc: d.lyric || track.lrc || null,
			lrcUrl: null,
			detailsLoaded: true
		});

		// 酷我：根据最终 url 后缀判断音质 (.flac → LOSSLESS else 320K) (legacy:2416-2421).
		if (track.audioUrl) {
			const q = inferQualityFromUrl(track.audioUrl);
			track.quality = q.tag;
			track.qualityLabel = q.label;
		}

		return track;
	}
};
