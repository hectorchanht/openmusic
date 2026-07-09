// Netease client adapter — real port (Task 3) of searchNetease (legacy:1986-2038) +
// fetchNeteaseDetails (legacy:2268-2308).
//
// Differences from the monolith (intentional):
//   - calls the SAME-ORIGIN proxy /api/netease/... instead of api.qijieya.cn directly
//     (token-free for Netease, but uniform with the proxy boundary for all sources)
//   - emits the canonical COLON-form uid `netease:<songid>` (D-10), not the hyphen form
//   - pickQueryParam drops `new URL(rawUrl, window.location.href)` — no `window`
//     server-side; uses an absolute-or-regex parse instead
//   - on contract drift (non-array body) it THROWS so catalog's Promise.allSettled
//     records a typed per-source error, instead of the monolith's swallow-and-return-0
import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiUrl, apiFetch } from '../services/api-base';

// Netease search row shape from the Meting proxy (fields we read).
interface NeteaseSearchItem {
	name?: string;
	artist?: string;
	url?: string; // audio URL — carries the songid as ?id=
	pic?: string; // cover
	lrc?: string; // lyric URL
}

/** Extract a query param from a (possibly relative) URL string without `window`. */
function pickQueryParam(rawUrl: string | undefined | null, key: string): string {
	if (!rawUrl) return '';
	try {
		// Absolute URLs parse directly; relative ones get a dummy base so URL() works
		// server-side (the monolith used window.location.href here — unavailable in SSR).
		return new URL(rawUrl, 'https://x.invalid/').searchParams.get(key) || '';
	} catch {
		const m = String(rawUrl).match(new RegExp('[?&]' + key + '=([^&]+)'));
		return m ? decodeURIComponent(m[1]) : '';
	}
}

export const netease: SourceAdapter = {
	id: 'netease',
	label: '网易云音乐',
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// Pagination by limit-multiplication, not a real page param (preserve legacy:1987).
		const requestLimit = Math.max(1, page || 1) * Math.max(1, 10);
		const path = `/api/netease/search?id=${encodeURIComponent(keyword)}&limit=${encodeURIComponent(
			requestLimit
		)}`;

		const res = await apiFetch(path, { signal });
		const json: unknown = await res.json();
		// Contract-drift guard: Netease must return an array. Throw (not return 0) so the
		// fan-out records a typed per-source error.
		if (!Array.isArray(json)) {
			throw new Error('netease: contract-drift (expected array search body)');
		}

		const tracks: Track[] = [];
		(json as NeteaseSearchItem[]).forEach((it, idx) => {
			const songId = pickQueryParam(it.url, 'id') || `${keyword}-${idx + 1}`;
			tracks.push({
				uid: makeUid('netease', songId),
				source: 'netease',
				songid: songId,
				title: it.name || '',
				artist: it.artist || '',
				album: '',
				cover: it.pic || null,
				audioUrl: it.url || null, // Netease returns the audio URL at search time
				lrc: null,
				lrcUrl: it.lrc || null, // and the lyric URL
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal): Promise<Track> {
		// Build type=url / type=lrc proxy URLs only when the cached track lacks them
		// (ports legacy:2269-2276).
		if (track.songid) {
			if (!track.audioUrl) {
				// Pitfall 3: this URL is consumed directly by <audio>.src, so it MUST be
				// absolute in the native APK (apiUrl() prepends the base; no-op on web).
				track.audioUrl = apiUrl(`/api/netease/url?id=${encodeURIComponent(track.songid)}`);
			}
			if (!track.lrcUrl) {
				// Pitfall 3: lrcUrl is fetched as-is below — must be absolute on native too.
				track.lrcUrl = apiUrl(`/api/netease/lrc?id=${encodeURIComponent(track.songid)}`);
			}
		}

		if (track.audioUrl) {
			const q = inferQualityFromUrl(track.audioUrl);
			track.quality = q.tag;
			track.qualityLabel = q.label;
		}

		// Fetch the LRC. quick-260629-nyl Task 3 — the "No lyrics" regression fix.
		//
		// DIAGNOSIS (live qijieya Meting proxy, 2026-06-29): the upstream lyric body is now PLAIN LRC
		// text, but its Content-Type is intermittent — sometimes `text/plain; charset=utf-8;` (note the
		// trailing semicolon / lowercase) and sometimes ABSENT. Our /api proxy route defaults an absent
		// upstream content-type to `application/json`, so the old header-sniff (`contentType.includes
		// ('json')`) then tried `lr.json()` on plain LRC text → threw → the catch swallowed it → a true
		// lyric HIT surfaced as "No lyrics for this track". The header is therefore unreliable.
		//
		// FIX: be CONTENT-TYPE-INDEPENDENT. Read the body as TEXT once, then opportunistically try to
		// JSON-parse it: a JSON wrapper is funnelled through the (now widened, never-throw)
		// extractLrcFromJson; anything that is not JSON is treated as the LRC text directly. Tolerant of
		// BOTH the json-wrapped shape (old) and the plain-text shape (current), null only on a real miss.
		if (!track.lrc && track.lrcUrl) {
			try {
				// GOVERNED (fetch→apiFetch audit): route OUR own-origin proxy lyric path through apiFetch
				// (dedup + concurrency cap + circuit breaker) so a resolve loop can never flood
				// /api/netease/lrc (debug-song-click-lrc-flood-noplay). A pre-existing UPSTREAM lrcUrl from
				// search (it.lrc — an absolute URL) stays RAW: apiFetch would prepend the API base + corrupt it.
				const lr = track.lrcUrl.includes('/api/netease/lrc')
					? await apiFetch(`/api/netease/lrc?id=${encodeURIComponent(track.songid)}`, { signal })
					: await fetch(track.lrcUrl, { signal });
				const body = await lr.text();
				track.lrc = extractLrcFromBody(body) ?? track.lrc ?? null;
			} catch {
				// Lyric fetch is best-effort; audio still plays without it (legacy logs + continues).
			}
		}

		track.detailsLoaded = true;
		return track;
	}
};

/**
 * quick-260629-nyl Task 3: content-type-independent LRC extraction from a raw response body. Try a
 * JSON parse first — a JSON-wrapped lyric (old shape, or whenever the proxy still returns json) is
 * routed through extractLrcFromJson; a body that is NOT JSON (the current plain-LRC-text shape) is
 * returned as-is when it carries lyric content. Never throws; returns null only on a true empty miss.
 *
 * Exported alongside extractLrcFromJson so unit tests can drive BOTH the old json shape and the new
 * plain-text shape through the exact extraction path resolve() uses.
 */
export function extractLrcFromBody(body: string): string | null {
	if (typeof body !== 'string') return null;
	const trimmed = body.trim();
	if (!trimmed) return null;
	// A JSON wrapper starts with `{`, `[`, or a quoted string — try to parse and extract.
	const first = trimmed[0];
	if (first === '{' || first === '[' || first === '"') {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			const fromJson = extractLrcFromJson(parsed);
			if (fromJson && fromJson.trim()) return fromJson;
			// Parsed as JSON but no lyric inside (e.g. {} or {error:...}) → a true miss, not the text.
			return null;
		} catch {
			// Not actually JSON (e.g. an LRC line that happens to begin oddly) — fall through to text.
		}
	}
	// Plain-text LRC body (the current upstream shape) — it IS the lyric.
	return trimmed;
}

/**
 * Lenient LRC extraction from a JSON-wrapped lyric response. quick-260629-nyl Task 3 EXPORTS this
 * (was private) for unit testing and WIDENS it — without dropping any existing key — to also cover
 * the nested `data.lyric.lyric` / `lyric.lrc` shapes and a `lines[]`/`lrclist[]` array of timestamped
 * objects joined back into LRC text. Never throws; returns null only on a true miss.
 */
export function extractLrcFromJson(lj: unknown): string | null {
	if (typeof lj === 'string') return lj || null;
	if (lj && typeof lj === 'object') {
		const o = lj as Record<string, unknown>;
		const data = o.data as Record<string, unknown> | string | undefined;
		// `lyric`/`lrc` may itself be an object wrapping the text (e.g. {lyric:{lyric:"..."}}).
		const lyricField = o.lyric;
		const lrcField = o.lrc;
		const nestedLyric =
			lyricField && typeof lyricField === 'object'
				? (lyricField as Record<string, unknown>)
				: null;
		const nestedLrc =
			lrcField && typeof lrcField === 'object' ? (lrcField as Record<string, unknown>) : null;
		const direct =
			(typeof lrcField === 'string' ? lrcField : null) ||
			(typeof lyricField === 'string' ? lyricField : null) ||
			(nestedLyric && typeof nestedLyric.lyric === 'string' ? nestedLyric.lyric : null) ||
			(nestedLyric && typeof nestedLyric.lrc === 'string' ? nestedLyric.lrc : null) ||
			(nestedLrc && typeof nestedLrc.lyric === 'string' ? nestedLrc.lyric : null) ||
			(nestedLrc && typeof nestedLrc.lrc === 'string' ? nestedLrc.lrc : null) ||
			(data && typeof data === 'object' && typeof data.lrc === 'string' ? data.lrc : null) ||
			(data && typeof data === 'object' && typeof data.lyric === 'string' ? data.lyric : null) ||
			(typeof data === 'string' ? data : null);
		if (direct && direct.trim()) return direct;
		// A `lines`/`lrclist` array of {time,text}|{timestamp,lyric} objects → join back into LRC text.
		const arr =
			(Array.isArray(o.lines) ? o.lines : null) ||
			(Array.isArray(o.lrclist) ? o.lrclist : null) ||
			(data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).lines)
				? ((data as Record<string, unknown>).lines as unknown[])
				: null);
		if (arr) {
			const joined = joinLrcLines(arr);
			if (joined && joined.trim()) return joined;
		}
	}
	return null;
}

/** Join an array of {time,text} | {timestamp,lyric} | {t,c} lyric-line objects back into LRC text. */
function joinLrcLines(arr: unknown[]): string | null {
	const out: string[] = [];
	for (const item of arr) {
		if (!item || typeof item !== 'object') continue;
		const o = item as Record<string, unknown>;
		const text =
			(typeof o.text === 'string' ? o.text : null) ??
			(typeof o.lyric === 'string' ? o.lyric : null) ??
			(typeof o.c === 'string' ? o.c : null);
		if (text == null) continue;
		const rawTime =
			(typeof o.time === 'number' ? o.time : null) ??
			(typeof o.timestamp === 'number' ? o.timestamp : null) ??
			(typeof o.t === 'number' ? o.t : null);
		if (typeof rawTime === 'number' && isFinite(rawTime) && rawTime >= 0) {
			// time may be ms or seconds — values over 10000 are almost certainly ms (parseLRC reads MM:SS).
			const secs = rawTime > 10000 ? rawTime / 1000 : rawTime;
			const mm = Math.floor(secs / 60);
			const ss = (secs % 60).toFixed(2).padStart(5, '0');
			out.push(`[${String(mm).padStart(2, '0')}:${ss}]${text}`);
		} else {
			out.push(text);
		}
	}
	return out.length ? out.join('\n') : null;
}
