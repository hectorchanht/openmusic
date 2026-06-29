// QQ Music client adapter — real port (plan 01-02) of searchQQ (legacy:2041-2120) +
// fetchQQDetails incl. pickBestPlayUrl (legacy:2311-2396). The registry already
// enumerates this entry, so 01-02 touches NO shared code (DATA-04).
//
// Differences from the monolith (intentional, mirroring netease.ts):
//   - calls the SAME-ORIGIN proxy /api/qq/... instead of tang.api.s01s.cn directly
//   - emits the canonical COLON-form uid `qq:<song_mid>` (D-10), not the hyphen form
//   - on contract drift (body that is neither a bare array nor {data:[]}) it THROWS so
//     catalog's Promise.allSettled records a typed per-source error, instead of the
//     monolith's swallow-and-return-0 (legacy:2056)
//   - on a failed detail resolve it leaves detailsLoaded=false so the next play retries
//     (legacy:2392-2395 — preserved verbatim in intent)
import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch } from '../services/api-base';
import { settings, type DefaultQuality } from '$lib/stores/settings.svelte';

// QQ search row shape from the tang endpoint (fields we read).
interface QQSearchItem {
	song_mid?: string;
	song_title?: string;
	singer_name?: string;
	pay?: string | null;
}

// QQ detail object shape from the tang endpoint (fields we read).
interface QQDetailItem {
	song_mid?: string;
	song_title?: string;
	song_name?: string;
	singer_name?: string;
	album_name?: string;
	album_title?: string;
	album_pic?: string;
	singer_pic?: string;
	song_h5_url?: string;
	/** Track length in SECONDS (tang detail body). The search list carries no length, so
	 *  this is the only QQ surface that reports duration — mapped onto Track.duration. */
	song_play_time?: number;
	song_lyric?: string;
	lyric?: string;
	vip?: string | number;
	song_play_url_sq?: string;
	song_play_url_pq?: string;
	song_play_url_accom?: string;
	song_play_url_hq?: string;
	song_play_url_standard?: string;
	song_play_url_fq?: string;
	song_play_url?: string;
	kbps_sq?: string;
	kbps_pq?: string;
	kbps_accom?: string;
	kbps_hq?: string;
	kbps_standard?: string;
	kbps_fq?: string;
}

interface BestPlayUrl {
	url: string | null;
	tag: string | null;
	label: string | null;
	text: string | null;
}

/**
 * quick-260629-nyl Task 3: tolerant QQ lyric read. Primary path is the verbatim
 * `song_lyric || lyric` string read (legacy:2369 — confirmed live as the timestamped LRC for popular
 * tracks). Widened defensively so a future nesting under those keys (`{lyric}`/`{lrc}` objects) is also
 * picked up WITHOUT dropping the old keys. Never throws; returns null on a true miss.
 */
function pickQqLyric(d: QQDetailItem): string | null {
	const view = d as unknown as Record<string, unknown>;
	const fromKey = (raw: unknown): string | null => {
		if (typeof raw === 'string') return raw.trim() ? raw : null;
		if (raw && typeof raw === 'object') {
			const o = raw as Record<string, unknown>;
			const nested =
				(typeof o.lyric === 'string' ? o.lyric : null) ||
				(typeof o.lrc === 'string' ? o.lrc : null);
			return nested && nested.trim() ? nested : null;
		}
		return null;
	};
	return fromKey(view.song_lyric) || fromKey(view.lyric) || null;
}

/**
 * Choose the best-quality play URL.
 *
 * The default order is the legacy priority ladder sq > pq > accom > hq > standard > fq
 * > fallback (legacy:2330-2345, VERBATIM). D-03: when `settings.defaultQuality === '128'`
 * the STANDARD tier (song_play_url_standard, ~128kbps) is promoted ahead of the
 * sq/pq/accom/hq tiers so the 128–160k band is preferred when present; otherwise the
 * verbatim lossless-first order is kept. QQ has no request-side bitrate param (the tang
 * endpoint returns all tiers in one detail body), so the ladder order IS the lever.
 */
function pickBestPlayUrl(d: QQDetailItem, quality?: DefaultQuality): BestPlayUrl {
	// D-03: absent an explicit per-call tier, read the user's streaming pref. WR-07: the
	// download path now passes settings.downloadQuality explicitly instead of temporarily
	// mutating settings.defaultQuality (which raced concurrent playback resolves).
	const pref = quality ?? settings.defaultQuality;
	if (pref === '128' && d.song_play_url_standard) {
		return {
			url: d.song_play_url_standard,
			tag: 'standard',
			label: 'STD',
			text: `STD ${d.kbps_standard || ''}`.trim()
		};
	}
	// WR-03: '320' pref → promote HQ (~320k) ahead of the lossless-first ladder, mirroring
	// the '128'→STD promotion above and JOOX's pickByQualityPref 320 handling.
	if (pref === '320' && d.song_play_url_hq) {
		return {
			url: d.song_play_url_hq,
			tag: 'hq',
			label: 'HQ',
			text: `HQ ${d.kbps_hq || ''}`.trim()
		};
	}

	// lossless
	if (d.song_play_url_sq)
		return { url: d.song_play_url_sq, tag: 'lossless', label: 'LOSSLESS', text: `SQ ${d.kbps_sq || ''}`.trim() };
	if (d.song_play_url_pq)
		return { url: d.song_play_url_pq, tag: 'lossless', label: 'LOSSLESS', text: `PQ ${d.kbps_pq || ''}`.trim() };

	// other variants
	if (d.song_play_url_accom)
		return { url: d.song_play_url_accom, tag: 'hq', label: 'HQ', text: `ACCOM ${d.kbps_accom || ''}`.trim() };
	if (d.song_play_url_hq)
		return { url: d.song_play_url_hq, tag: 'hq', label: 'HQ', text: `HQ ${d.kbps_hq || ''}`.trim() };

	if (d.song_play_url_standard)
		return { url: d.song_play_url_standard, tag: 'standard', label: 'STD', text: `STD ${d.kbps_standard || ''}`.trim() };
	if (d.song_play_url_fq)
		return { url: d.song_play_url_fq, tag: 'low', label: 'LOW', text: `FQ ${d.kbps_fq || ''}`.trim() };

	// fallback
	if (d.song_play_url) return { url: d.song_play_url, tag: null, label: null, text: null };

	return { url: null, tag: null, label: null, text: null };
}

export const qq: SourceAdapter = {
	id: 'qq',
	label: 'QQ 音乐',
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// Pagination by limit-multiplication, mirroring netease (page→limit cap).
		const requestLimit = Math.max(1, page || 1) * Math.max(1, 10);
		const path = `/api/qq/search?msg=${encodeURIComponent(keyword)}&type=json`;

		const res = await apiFetch(path, { signal });
		const json: unknown = await res.json();

		// 兼容：既支持直接数组，也支持 { data: [...] } 这种包装 — PORTED VERBATIM (legacy:2055).
		const data = Array.isArray(json)
			? json
			: Array.isArray((json as { data?: unknown })?.data)
				? (json as { data: unknown[] }).data
				: null;
		// Contract-drift guard: a body that is neither a bare array nor {data:[]} (e.g. an
		// HTML error page) must THROW so the fan-out records a typed per-source error
		// rather than silently returning 0 (the monolith swallowed; we surface — Pitfall 5).
		if (data === null) {
			throw new Error('qq: contract-drift (expected array or {data:[]} search body)');
		}

		const list = (data as QQSearchItem[]).slice(0, requestLimit);
		const tracks: Track[] = [];
		list.forEach((it, idx) => {
			// 新接口里唯一标识是 song_mid (legacy:2062-2064).
			const mid = it.song_mid;
			if (!mid) return;

			const indexInList = idx + 1; // 1-based: qqIndex / displayIndex (ORDERING ONLY).
			tracks.push({
				uid: makeUid('qq', mid),
				source: 'qq',
				songid: mid,
				title: it.song_title || '',
				artist: it.singer_name || '',
				album: '',
				cover: null, // 新接口没给封面 — search returns no cover.
				audioUrl: null, // 搜索阶段没有 url 和 lrc — no audio/lrc at search time.
				lrc: null,
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: indexInList,
				// source-specific extras (legacy:2080-2088, 2107-2108):
				qqSearchKey: keyword, // detail re-sends the same msg
				qqIndex: indexInList, // ordering fallback only, NEVER identity (Pitfall 4)
				qqId: mid,
				songMid: mid,
				qqQualityText: it.pay || null,
				pay: it.pay || null
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal, quality?: DefaultQuality): Promise<Track> {
		// 优先用搜索时用过的关键词，保证和原始排序一致 (legacy:2312-2315).
		const msg =
			(track.qqSearchKey || track.keyword || '').trim() ||
			((track.title || '') + ' ' + (track.artist || '')).trim();

		// 新接口用 mid：优先 qqId/songMid/songid (legacy:2317-2319).
		const mid = (track.qqId || track.songMid || track.songid || '').toString().trim();

		try {
			if (!mid) {
				throw new Error('qq detail error (missing mid)');
			}

			const path = `/api/qq/detail?msg=${encodeURIComponent(msg)}&type=json&mid=${encodeURIComponent(mid)}`;
			const res = await apiFetch(path, { signal });
			const d = (await res.json()) as QQDetailItem | null;

			// 基本校验：必须是对象且有 song_mid (legacy:2352-2355). On a poisoned/empty body we
			// throw — and crucially we do NOT reach the detailsLoaded=true line below.
			if (!d || typeof d !== 'object' || !d.song_mid) {
				throw new Error('qq detail error (invalid response)');
			}

			// 更新基础信息 (legacy:2357-2362).
			track.title = d.song_title || d.song_name || track.title;
			track.artist = d.singer_name || track.artist;
			track.album = d.album_name || d.album_title || track.album || '';
			track.cover = d.album_pic || d.singer_pic || track.cover;
			track.pageUrl = d.song_h5_url || track.pageUrl;

			// 播放链接（按优先级挑一个）(legacy:2364-2366). WR-07: per-call quality wins.
			const best = pickBestPlayUrl(d, quality);
			track.audioUrl = best.url || track.audioUrl;

			// 歌词 — inline from the detail body (legacy:2369). quick-260629-nyl Task 3: the live tang
			// detail still carries `song_lyric` (timestamped LRC) + `lyric` (plain) for popular tracks,
			// so the existing string reads remain the primary path. Widen DEFENSIVELY (never-throw,
			// optional chaining) so a future nesting (`song_lyric.lyric` / `lyric.lyric` / `lyric.lrc`)
			// is also tolerated WITHOUT dropping the old keys; null only on a true miss.
			track.lrc = pickQqLyric(d) || track.lrc;

			// SRCH-01: track length in seconds from `song_play_time`. T-21-01 tampering guard —
			// coerce to a finite positive number or `undefined`; a non-numeric/negative/zero
			// upstream value never becomes a duration (D-03: 0/unknown is NEVER penalized).
			track.duration =
				typeof d.song_play_time === 'number' && d.song_play_time > 0
					? d.song_play_time
					: undefined;

			// 文本信息 (legacy:2371-2375).
			track.qqQualityText = best.text || (d.vip ? `VIP:${d.vip}` : null) || track.qqQualityText;

			// quality / label：先用我们自己的选择，再用 inferQualityFromUrl 兜底 (legacy:2377-2389).
			if (best.tag && best.label) {
				track.quality = best.tag;
				track.qualityLabel = best.label;
			}
			if (track.audioUrl) {
				const q = inferQualityFromUrl(track.audioUrl);
				if (q && q.label) {
					track.quality = q.tag;
					track.qualityLabel = q.label;
				}
			}

			track.detailsLoaded = true;
			return track;
		} catch (e) {
			// 失败的话不要把 detailsLoaded 置 true，下次还有机会重试 (legacy:2392-2395).
			// Re-throw so the caller (playTrack catch / allSettled) records the error, but
			// detailsLoaded stays false so a later play retries.
			throw e instanceof Error ? e : new Error('qq detail error');
		}
	}
};
