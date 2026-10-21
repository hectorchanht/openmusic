// Suyin （溯音） Kuwo client adapter (quick-261020-suyin — second Kuwo pipe).
//
// oiapi.net is a public no-key aggregator (溯音 API brand, referenced across the
// Molan aggregator mirrors) serving Kuwo search+resolve in one call:
//   GET https://oiapi.net/api/Kuwo?msg={keyword}&n={count}&br={tier}
//     → { code: 1, data: { song, singer, album, picture, rid, url, bitrate, format,
//                          size, time, types: [{level,bitrate,format,size}…] } }
// `data` is an OBJECT for n=1 and an ARRAY for n>1 — both shapes are handled.
//
// Tier vocabulary (live-probed 2026-10-20): br=1 → 2000k flac, br=2 → 192k ogg,
// br=3 → 100k ogg, br=4 → 320k mp3, br=5 → 48k aac, br=6/7 → 128k mp3.
// Only the SELECTED tier's URL comes back in `data.url` — the `types[]` list is
// advisory (no per-tier URL without another call), so v1 streams br=4 (320k mp3,
// the sane mobile default) and resolve() is a pass-through. A FLAC download
// tier would need a by-rid lookup the API does not expose — noted, not built.
//
// CORS: `Access-Control-Allow-Origin: *` (verified) → the search goes DIRECT
// from the browser like 32-D-12, no /api proxy hop. The audio URL itself is a
// signed kuwo CDN URL (kw-er.kuwo.cn), https-upgraded here — the upgrade lives
// in the CLIENT adapter (not a proxy) because there is no proxy on this path,
// same reasoning as qq.ts's local https().
// No lyrics endpoint — lrc stays null and the cross-source lyric fallback
// (catalog.ts crossSourceLyric) covers it, like any lyric-less source.

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { apiFetch } from '../services/api-base';
import type { DefaultQuality } from '$lib/stores/settings.svelte';

const OIAPI_BASE = 'https://oiapi.net/api/Kuwo';
// v1 streaming tier: 320k mp3 (see tier vocabulary above).
const STREAM_BR = 4;

// ---- Upstream JSON shapes (only fields we read; all optional — untrusted) ----

interface SuyinTier {
	level?: string;
	bitrate?: string;
	format?: string;
	size?: string;
}
interface SuyinItem {
	song?: string;
	singer?: string;
	album?: string;
	picture?: string;
	rid?: string;
	url?: string;
	bitrate?: string;
	format?: string;
	size?: string;
	time?: string | number;
	types?: SuyinTier[];
}
interface SuyinResponse {
	code?: number;
	data?: SuyinItem | SuyinItem[];
}

/** http → https, idempotent (mirrors qq.ts's local https — no shared helper exists). */
function https(url: string | null | undefined): string | null {
	return url ? url.replace(/^http:\/\//i, 'https://') : null;
}

/** kuwo convention: rid keeps the bare numeric id (`MUSIC_118980` → `118980`). */
function bareRid(rid: string | undefined): string {
	return (rid ?? '').replace(/^MUSIC_/, '');
}

/** Normalize the n=1 object shape and the n>1 array shape into one list. */
export function normalizeSuyinItems(json: unknown): SuyinItem[] {
	const data = (json as SuyinResponse | null)?.data;
	if (Array.isArray(data)) return data;
	if (data && typeof data === 'object') return [data];
	return [];
}

function toTrack(it: SuyinItem, keyword: string, idx: number): Track | null {
	const songid = bareRid(it.rid);
	if (!songid || !it.song) return null;
	const audioUrl = https(it.url);
	return {
		uid: makeUid('suyin', songid),
		source: 'suyin',
		songid,
		title: it.song,
		artist: it.singer || '',
		album: it.album || '',
		cover: https(it.picture),
		audioUrl,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: audioUrl !== null,
		quality: '320k',
		qualityLabel: '320K',
		keyword,
		displayIndex: idx + 1
	};
}

export const suyin: SourceAdapter = {
	id: 'suyin',
	label: 'Kuwo（溯音）',
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		const requestLimit = Math.max(1, page || 1) * Math.max(1, 10);
		// Direct-to-upstream: oiapi sends `Access-Control-Allow-Origin: *`, so no
		// preflight and no /api hop (same 32-D-12 reasoning as tang).
		const url =
			`${OIAPI_BASE}?msg=${encodeURIComponent(keyword)}` +
			`&n=${requestLimit}&br=${STREAM_BR}`;
		const res = await apiFetch(url, { signal });
		const json: unknown = await res.json();
		// Contract-drift guard: a non-object body is genuine DRIFT, not a dry spell —
		// throw so the fan-out records a typed per-source error (mirrors netease.ts).
		if (!json || typeof json !== 'object') {
			throw new Error('suyin: contract-drift (expected object search body)');
		}
		return normalizeSuyinItems(json)
			.map((it, idx) => toTrack(it, keyword, idx))
			.filter((t): t is Track => t !== null);
	},

	async resolve(track: Track, _signal: AbortSignal, _quality?: DefaultQuality): Promise<Track> {
		// The search already carries the playable URL (br=4 320k mp3) — nothing to
		// resolve. Defensive: if a stale/serialized track lost it, leave it null and
		// let cross-source fallback (SRC-FB-01) cover the song, like a QQ region-block.
		if (!track.audioUrl) {
			track.detailsLoaded = false;
			return track;
		}
		track.detailsLoaded = true;
		return track;
	}
};
