// Kuwo client adapter — real port (plan 01-02) of searchKuwo (legacy:2123-2163) +
// fetchKuwoDetails (legacy:2398-2422). The registry already enumerates this entry, so
// 01-02 touches NO shared code (DATA-04).
//
// Differences from the monolith (intentional, mirroring netease.ts):
//   - calls the SAME-ORIGIN proxy /api/kuwo/... — since quick-261004-n1i a dedicated edge route pair
//     over the official search.kuwo.cn search + the musicdl resolver chain for audio (it replaced
//     the dead kw-api.cenguigui.cn), answering the same legacy shapes this adapter reads
//   - emits the canonical COLON-form uid `kuwo:<rid>` (D-10), not the hyphen form
//   - on contract drift (code!==200 or missing data) search THROWS so catalog's
//     Promise.allSettled records a typed per-source error, instead of the monolith's
//     swallow-and-return-0 (legacy:2129). resolve already threw on code!==200
//     (legacy:2402) — that good model is preserved verbatim.
import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch } from '../services/api-base';
import { kuwoHealth } from '../services/kuwo-health';
import { settings, type DefaultQuality } from '$lib/stores/settings.svelte';
import { effectiveQuality } from './quality';

// Kuwo search row shape from /api/kuwo/search (fields we read).
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

/**
 * debug kuwo-upstream-dead-gate-never-trips: the ONE seam both kuwo calls go through. The fetch,
 * the HTTP-status check and the JSON parse all sit inside ONE try, so EVERY failure shape the proxy
 * can hand back counts against the gate:
 *   - a network reject / timeout / open circuit breaker (apiFetch throws);
 *   - a non-ok status — Cloudflare RESOLVES a 526 with a text/plain body, it does not throw, so
 *     `res.ok` is the only place a dead-cert upstream is visible;
 *   - a non-JSON body (the upstream itself now serves 200 / text/html / 0 bytes even with the cert
 *     ignored).
 * The gate shipped in cda5220f wrapped only the first of those and parsed the body OUTSIDE its try,
 * so `recordFail()` was unreachable for the real prod failure and the gate never tripped in three
 * weeks of a dead upstream (dev hid it: node rejects the cert, so the local proxy returns a JSON 500
 * that DID reach the drift branch). A caller abort is a supersede, not an outage — rethrown
 * uncounted. The contract checks + `recordOk()` stay at the call sites: only a WELL-FORMED body
 * proves the upstream is alive.
 */
async function kuwoJson<T>(path: string, signal: AbortSignal): Promise<T> {
	try {
		const res = await apiFetch(path, { signal });
		if (!res.ok) throw new Error(`kuwo: HTTP ${res.status}`);
		return (await res.json()) as T;
	} catch (err) {
		if (!signal.aborted) kuwoHealth.recordFail();
		throw err;
	}
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

		// Health gate (kuwo-health): while the upstream is down — it currently serves a broken TLS
		// cert, so Cloudflare 526s every call at ~1s — short-circuit instead of paying that second on
		// every search. The gate re-probes itself once per window, so recovery is automatic.
		if (kuwoHealth.isGated()) return [];

		// A 526/5xx/non-JSON/network failure is a real outage signal — kuwoJson counts it, then
		// rethrows so the fan-out records a typed per-source error exactly as before (DATA-03).
		const json = await kuwoJson<KuwoSearchResponse | null>(path, signal);

		// Contract-drift guard (legacy:2129 returned 0; we THROW so the fan-out records a
		// typed per-source error rather than silently dropping the source).
		if (!json || json.code !== 200 || !Array.isArray(json.data)) {
			kuwoHealth.recordFail();
			throw new Error('kuwo: contract-drift (expected {code:200,data:[]} search body)');
		}
		kuwoHealth.recordOk(); // a well-formed body is a live upstream — instant recovery

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
		// D-03, revised by quick-261004-n1i: the edge maps 128k→standard (128k mp3), 320k→exhigh (320k mp3) and
		// zp/anything else→lossless (flac). Before this a '320' pref — including cellular 'auto' —
		// got lossless FLAC, because the old upstream had no 320 token.
		// WR-07: an explicit per-call quality (download path) wins over the streaming pref.
		// 32-D-02: resolve the pref through the ONE 'auto' seam FIRST — the literal 'auto'
		// must never reach a tier pick, or a metered connection silently gets the top rung.
		const eq = effectiveQuality(quality ?? settings.defaultQuality);
		const level = eq === '128' ? '128k' : eq === '320' ? '320k' : 'zp';
		const path = `/api/kuwo/detail?id=${encodeURIComponent(track.songid)}&type=song&level=${encodeURIComponent(level)}&format=json`;

		// Deliberately NOT gated: `resolve` is only reached for a track the user (or the queue) has
		// already chosen, so short-circuiting it would turn a gated window into an unplayable track.
		// The gate exists to stop SPECULATIVE calls (search / the fallback walk), not to refuse a
		// direct request. Failures are still recorded (kuwoJson) so the search gate learns from them.
		const j = await kuwoJson<KuwoDetailResponse | null>(path, signal);
		// Preserve the legacy throw on code!==200 / missing data (legacy:2402) — the one
		// detail fetcher that already threw, kept verbatim.
		if (!j || j.code !== 200 || !j.data) {
			kuwoHealth.recordFail();
			throw new Error('kuwo detail failed');
		}
		kuwoHealth.recordOk();

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
