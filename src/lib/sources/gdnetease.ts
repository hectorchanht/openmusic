// GD音乐台 Netease client adapter (quick-261020-gdnt — second Netease pipe).
//
// music-api.gdstudio.xyz is a public no-key aggregator (1404 GitHub code refs)
// with a Netease backend. It sends NO `Access-Control-Allow-Origin` (verified
// 2026-10-20), so every call rides /api/gdnetease/* (the catch-all →
// $lib/proxy/gdnetease.ts) — the structural opposite of the CORS-open meting
// pipe, same reason kuwo search is proxied.
//
// Wire shape (all verified end-to-end 2026-10-20 before this port was written):
//   search: /api/gdnetease/search?id={kw}&limit={n}
//     → [{ id, name, artist[], album, pic_id, url_id, lyric_id, source }]
//   resolve: /api/gdnetease/url?id={url_id}&br=320 → { url, br, size }
//     The upstream returns JSON, NOT a 302 — the adapter parses it and sets
//     audioUrl to the DIRECT 126.net CDN url (signed/expiring; `resolvedAt`
//     freshness covers staleness like every CN pipe). br omitted → FLAC
//     (br 1619, 64 MB) — the WR-07 download path uses that for lossless.
//   lyric: /api/gdnetease/lrc?id={lyric_id} → { lyric: "[00:00.00]…" } —
//     extractLrcFromJson handles the `lyric` key (shared with netease.ts).
// Cover: gdstudio hands back only pic_id, and the direct p3.music.126.net URL
// needs a hash prefix we cannot mint — so covers ride qijieya's meting pic
// redirector (`type=pic`), already a hard dependency via the netease source.
// A meting outage degrades to the Deezer/iTunes cover chain (self-healing).

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { apiFetch, apiUrl } from '../services/api-base';
import { extractLrcFromBody } from './netease';
import { settings, type DefaultQuality } from '$lib/stores/settings.svelte';

// ---- Upstream JSON shapes (only fields we read; all optional — untrusted) ----

interface GdSearchItem {
	id?: string;
	name?: string;
	artist?: string[];
	album?: string;
	pic_id?: string;
	url_id?: string;
	lyric_id?: string;
}
interface GdUrlResponse {
	url?: string;
	br?: number;
	size?: number;
}

/** Cover via the meting pic redirector (302 → p3.music.126.net). See header. */
function coverUrl(picId: string | undefined): string | null {
	return picId ? `https://api.qijieya.cn/meting/?server=netease&type=pic&id=${encodeURIComponent(picId)}` : null;
}

function qualityFromBr(br: number | undefined): { quality: string | null; qualityLabel: string | null } {
	if (!br || br <= 0) return { quality: null, qualityLabel: null };
	if (br >= 800) return { quality: 'lossless', qualityLabel: 'FLAC' };
	if (br >= 256) return { quality: '320k', qualityLabel: '320K' };
	if (br >= 112) return { quality: '128k', qualityLabel: '128K' };
	return { quality: `${br}k`, qualityLabel: `${br}K` };
}

export const gdnetease: SourceAdapter = {
	id: 'gdnetease',
	label: 'Netease（GD）',
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		const requestLimit = Math.max(1, page || 1) * Math.max(1, 10);
		const path = `/api/gdnetease/search?id=${encodeURIComponent(keyword)}&limit=${requestLimit}`;
		const res = await apiFetch(path, { signal });
		const json: unknown = await res.json();
		// Contract-drift guard: GD must return an array. Throw (not return []) so the
		// fan-out records a typed per-source error (mirrors netease.ts).
		if (!Array.isArray(json)) {
			throw new Error('gdnetease: contract-drift (expected array search body)');
		}
		const tracks: Track[] = [];
		(json as GdSearchItem[]).forEach((it, idx) => {
			const songId = it.url_id || it.id;
			if (!songId || !it.name) return;
			tracks.push({
				uid: makeUid('gdnetease', songId),
				source: 'gdnetease',
				songid: songId,
				title: it.name,
				artist: (it.artist ?? []).join(' / '),
				album: it.album || '',
				cover: coverUrl(it.pic_id),
				// Resolved lazily — the upstream url leg returns JSON, so audioUrl
				// must be the parsed DIRECT url, never the proxy path (an <audio>
				// tag cannot play a JSON body).
				audioUrl: null,
				lrc: null,
				lrcUrl: it.lyric_id ? apiUrl(`/api/gdnetease/lrc?id=${encodeURIComponent(it.lyric_id)}`) : null,
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
		if (track.songid) {
			// WR-07: the download path passes settings.downloadQuality explicitly.
			// Lossless → omit br so upstream returns FLAC (verified 2026-10-20);
			// anything else → br=320 mp3, the streaming sane default.
			const wantLossless = quality === 'lossless';
			const urlPath =
				`/api/gdnetease/url?id=${encodeURIComponent(track.songid)}` + (wantLossless ? '' : '&br=320');
			try {
				const res = await apiFetch(urlPath, { signal });
				const body = (await res.json()) as GdUrlResponse;
				if (body.url) {
					track.audioUrl = body.url;
					const q = qualityFromBr(body.br);
					track.quality = q.quality;
					track.qualityLabel = q.qualityLabel;
				}
			} catch {
				// Resolve failure → audioUrl stays null and cross-source fallback
				// (SRC-FB-01) covers the song, like a QQ region-block.
			}
			if (!track.lrc && track.lrcUrl) {
				try {
					const lr = await apiFetch(track.lrcUrl, { signal });
					track.lrc = extractLrcFromBody(await lr.text()) ?? null;
				} catch {
					// Lyric fetch is best-effort; audio still plays without it.
				}
			}
		}
		track.detailsLoaded = track.audioUrl !== null;
		return track;
	}
};
