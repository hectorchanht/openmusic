// QQ Music client adapter — real port (plan 01-02) of searchQQ (legacy:2041-2120) +
// fetchQQDetails incl. pickBestPlayUrl (legacy:2311-2396). The registry already
// enumerates this entry, so 01-02 touches NO shared code (DATA-04).
//
// Differences from the monolith (intentional, mirroring netease.ts):
//   - SEARCH calls the SAME-ORIGIN proxy /api/qq/search instead of tang.api.s01s.cn directly.
//     32-D-12 SUPERSEDES this for DETAIL only: the hot audio-URL call now goes direct to tang
//     (saving the measured ~1s proxy hop on the click-to-play path), with /api/qq/detail retained
//     as a one-shot fallback — see fetchQqDetail below.
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
import { qqProxy } from '$lib/proxy/qq';
import { effectiveQuality } from './quality';
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

/** 32-D-05: tang returns `http://isure6.stream.qqmusic.qq.com/...`, which is mixed-content-BLOCKED
 *  on our https origin. The SAME host serves https correctly (verified live: 200 + 206,
 *  accept-ranges: bytes, first bytes in 0.31s). The upgrade lives here in the client adapter and
 *  NOT in proxy/qq.ts, because 32-D-12 sends the hot detail call DIRECT to tang — a proxy-side
 *  upgrade would never fire on the path that actually matters. Idempotent: an already-https url
 *  passes through byte-identical. */
function https(url: string | null): string | null {
	return url ? url.replace(/^http:\/\//i, 'https://') : url;
}

/**
 * Choose the best-quality play URL.
 *
 * Order: sq > pq > hq > standard > fq > accom > bare fallback. 32-D-18 moved `accom` from its
 * inherited position ABOVE `hq` (legacy:2330-2345 / upstream index.html:2373 — a copy-forward,
 * never a considered choice) down to last among the named tiers. `accom` is 伴奏 — the
 * accompaniment/instrumental mix — so a lossless-first fallthrough could hand the user a karaoke
 * version of the song; and it serves `.ogg`, which iOS Safari's `<audio>` does not decode, which
 * is a guaranteed load failure on the platform CLAUDE.md names first. The `.ogg` half is confirmed
 * and sufficient on its own; the 伴奏 reading is a strong inference, flagged for a listening check
 * in plan 32-08. It keeps an honest `ACCOM` text rather than being presented as an `HQ` tier.
 *
 * Pref promotions (QQ has no request-side bitrate param — the tang endpoint returns every tier in
 * one detail body, so the ladder ORDER is the only lever):
 *   - `'128'` promotes `song_play_url_standard`. 32-D-04: that tier is MEASURED at 97-98 kbps m4a,
 *     not the "~128kbps / 128–160k band" the superseded D-03 comment claimed.
 *   - `'320'` promotes `song_play_url_hq`. 32-D-04: MEASURED at 193 kbps m4a (AAC) on 3/3 probed
 *     tracks, not "~320k". The rung name is upstream's, the bitrate claim was ours and was wrong.
 *   - `'auto'` never reaches this function: 32-D-02 resolves it to a concrete tier first (below).
 */
function pickBestPlayUrl(d: QQDetailItem, quality?: DefaultQuality): BestPlayUrl {
	// 32-D-05: ONE return boundary, so every rung is https-upgraded and no future rung can be
	// added past the guard (same "one guard where every branch routes through" placement as
	// blob-store's MIN_BLOB_BYTES floor).
	const best = pickTier(d, quality);
	return { ...best, url: https(best.url) };
}

/** The tier ladder itself — returns the RAW upstream url; `pickBestPlayUrl` https-upgrades it. */
function pickTier(d: QQDetailItem, quality?: DefaultQuality): BestPlayUrl {
	// D-03: absent an explicit per-call tier, read the user's streaming pref. WR-07: the
	// download path now passes settings.downloadQuality explicitly instead of temporarily
	// mutating settings.defaultQuality (which raced concurrent playback resolves).
	// 32-D-02: resolve `'auto'` to a concrete tier BEFORE any branch runs — the shipped default is
	// now `'auto'`, and without this qq would fall straight through to the lossless-first ladder on
	// a metered connection. `effectiveQuality` returns `Exclude<DefaultQuality,'auto'>`, so the
	// compiler proves the branches below never see `'auto'`. The cellular case then reuses the
	// EXISTING WR-03 `'320'`→hq promotion verbatim — zero new branches in this function.
	const pref = effectiveQuality(quality ?? settings.defaultQuality);
	if (pref === '128' && d.song_play_url_standard) {
		return {
			url: d.song_play_url_standard,
			tag: 'standard',
			label: 'STD',
			text: `STD ${d.kbps_standard || ''}`.trim()
		};
	}
	// WR-03: '320' pref → promote HQ ahead of the lossless-first ladder, mirroring the '128'→STD
	// promotion above and JOOX's pickByQualityPref 320 handling. 32-D-04: the tier is measured at
	// 193 kbps m4a (AAC), NOT the "~320k" this comment used to claim.
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
	if (d.song_play_url_hq)
		return { url: d.song_play_url_hq, tag: 'hq', label: 'HQ', text: `HQ ${d.kbps_hq || ''}`.trim() };

	if (d.song_play_url_standard)
		return { url: d.song_play_url_standard, tag: 'standard', label: 'STD', text: `STD ${d.kbps_standard || ''}`.trim() };
	if (d.song_play_url_fq)
		return { url: d.song_play_url_fq, tag: 'low', label: 'LOW', text: `FQ ${d.kbps_fq || ''}`.trim() };

	// 32-D-18: accom LAST among the named tiers (was above hq, legacy:2330-2345 verbatim). It is a
	// different MIX (伴奏) in a container iOS Safari cannot decode — a last resort ahead of the bare
	// url, never a quality tier. Label reads LOW/ACCOM so the pill never claims HQ for an instrumental.
	if (d.song_play_url_accom)
		return { url: d.song_play_url_accom, tag: 'low', label: 'ACCOM', text: `ACCOM ${d.kbps_accom || ''}`.trim() };

	// fallback
	if (d.song_play_url) return { url: d.song_play_url, tag: null, label: null, text: null };

	return { url: null, tag: null, label: null, text: null };
}

/**
 * One detail attempt against `url`. NEVER throws — a rejection, a non-JSON body, or an upstream
 * "unknown mid" body (200 + every field null) all map to `null` so the caller can decide whether to
 * fall through. The PUBLIC `resolve` keeps its throw contract; this is the internal sentinel layer.
 */
async function tryQqDetail(url: string, signal: AbortSignal): Promise<QQDetailItem | null> {
	try {
		// 32-D-12 / research Q4 — this init must stay `{ signal }` and nothing else. Adding a header
		// turns the direct GET into a preflighted request (measured 1.016s, which would hand back
		// most of what going direct saves) AND tang's Access-Control-Allow-Headers is `Content-Type`
		// only, so the preflight would fail outright. Never set `credentials: 'include'` either:
		// tang sends `access-control-allow-origin: *` with NO Allow-Credentials, so a credentialed
		// request hard-fails CORS — and it does send Set-Cookie, which is exactly the thing that
		// invites someone to "fix" it that way.
		const res = await apiFetch(url, { signal });
		const d = (await res.json()) as QQDetailItem | null;
		return d && typeof d === 'object' && d.song_mid ? d : null;
	} catch {
		// Network error, timeout, open circuit, caller-abort, or a non-JSON 200 (`mid=` empty
		// returns the plain text 参数错误) — all "no usable body from this hop".
		return null;
	}
}

/**
 * Fetch the QQ detail body for `mid`: DIRECT to tang first, the same-origin proxy once as fallback.
 *
 * 32-D-12: the hot audio-URL call goes straight to the upstream, saving the measured ~1s our proxy
 * hop costs — this is the click-to-play path for most plays now that qq wins the dedupe tie
 * (32-D-08). The `/api/qq/detail` route is RETAINED, not deleted, as a one-shot fallback for the
 * day tang drops its `access-control-allow-origin: *`.
 *
 * 32-D-13: both hops go through `apiFetch`, never raw `fetch`, so the outbound governor's GET
 * dedupe, MAX_CONCURRENT_REQUESTS cap, 25s timeout and circuit breaker cover the new host exactly
 * as they cover /api/* (`apiUrl` returns an absolute url untouched). CONSEQUENCE, accepted on
 * purpose: tang failures now count toward the ONE SHARED breaker, so a tang outage can open it for
 * covers/lyrics/translate too. That is correct stop-hammering behaviour and every one of those
 * callers degrades to its own sentinel. Do NOT "fix" it with a second per-host breaker — composing
 * locally-bounded mechanisms is the documented root cause of the api-fetch-flood-freeze class. If
 * you are debugging "covers stopped loading during a tang outage", this comment is your answer.
 *
 * 32-D-14: the direct call exposes the listener's IP to Tencent on a metadata request. Weighed and
 * accepted — `<audio src>` already points straight at isure6.stream.qqmusic.qq.com on every play,
 * so this adds a hostname, not a new category of exposure.
 */
async function fetchQqDetail(mid: string, signal: AbortSignal): Promise<QQDetailItem | null> {
	// The upstream URL is built by the PROXY adapter so the tang host lives in exactly one place
	// (proxy/qq.ts) — a pure buildUrl call, the same client→proxy direction resolve-edge.ts uses.
	// `mid` is encoded by URLSearchParams/URL here (T-32-15) rather than by hand, which is the
	// same guarantee without the double-encoding risk of doing both.
	const direct = qqProxy.buildUrl('detail', new URLSearchParams({ mid }), undefined);
	const fromDirect = await tryQqDetail(direct, signal);
	if (fromDirect) return fromDirect;

	// Superseded mid-flight → do not spend a second hop on a result nobody wants.
	if (signal.aborted) return null;

	// ONE fallback hop, same params through our own proxy (encodeURIComponent — V5 ingress).
	return tryQqDetail(`/api/qq/detail?type=json&mid=${encodeURIComponent(mid)}`, signal);
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
		// 32-D-09: the `msg` keyword is NO LONGER computed or sent on the detail call. It reverses
		// the legacy:2312-2315 port ("优先用搜索时用过的关键词，保证和原始排序一致"), which is
		// recorded here rather than silently dropped. VERIFIED live: `mid` alone returns the full
		// ladder plus every metadata field, and a deliberately WRONG `msg` with the right `mid`
		// still returns the correct song — the endpoint ignores it. The SEARCH path above still
		// sends `msg` (there it IS the query), and `track.qqSearchKey` is still written at search
		// time; only this usage is gone.

		// 新接口用 mid：优先 qqId/songMid/songid (legacy:2317-2319).
		const mid = (track.qqId || track.songMid || track.songid || '').toString().trim();

		try {
			if (!mid) {
				throw new Error('qq detail error (missing mid)');
			}

			const d = await fetchQqDetail(mid, signal);

			// A superseded resolve must keep rejecting as an ABORT, not as a dead source — otherwise
			// the never-stop ladder would burn a cross-source fallback cycle on a healthy cancel.
			if (!d && signal.aborted) throw new DOMException('Aborted', 'AbortError');

			// 基本校验：必须是对象且有 song_mid (legacy:2352-2355). On a poisoned/empty body we
			// throw — and crucially we do NOT reach the detailsLoaded=true line below. The upstream
			// answers 200 with an ALL-NULL body for an unknown mid (and `vip` is populated even
			// then), so `song_mid` is the only reliable liveness discriminator — never res.ok.
			if (!d || typeof d !== 'object' || !d.song_mid) {
				throw new Error('qq detail error (invalid response)');
			}

			// 更新基础信息 (legacy:2357-2362).
			// quick-260712-4xg: prefer the existing (picked/search) title so a VersionPicker
			// selection keeps the version's name in now-playing; fall back to detail names only for
			// a title-less stub. Matches netease.resolve (no title overwrite).
			track.title = track.title || d.song_title || d.song_name || '';
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
			// 32-D-19: the url sniff is now a FALLBACK ONLY (`else`), no longer an overwrite. It
			// classifies purely on file extension and labels every non-FLAC url `320K`, so it was
			// relabelling the measured 97 kbps standard tier and the 48 kbps fq tier as 320K — the
			// quality pill reported a tier the user was not receiving. The ladder knows the TRUE tier
			// from which rung it picked, so that value wins. The shared helper itself is deliberately
			// untouched (other sources depend on its guess) — only the CALL is gated.
			if (best.tag && best.label) {
				track.quality = best.tag;
				track.qualityLabel = best.label;
			} else if (track.audioUrl) {
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
