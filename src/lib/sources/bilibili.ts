// Bilibili client adapter (quick-261020-bili) — SEARCH-ONLY source.
//
// Why Bilibili earns a seat despite being a video site: an enormous share of
// Mandopop/Cantopop listening on the open web is bilibili uploads (
// rips, live recordings, MV audio) that the licensed catalogs often lack or
// region-lock. Like ytmusic it is enabledByDefault for SEARCH fan-out but
// autoResolveEligible: FALSE — a video upload must never silently satisfy a
// cross-source resolve for a studio track.
//
// Ported from guohuiyuan/music-lib `bilibili` (AGPL, read-only reference) + the
// DJChanahCJD/otter-music learnings. Mechanics (all live-probed 2026-10-20, see
// src/lib/proxy/bilibili.ts for the full evidence trail):
// - Search: WBI-signed search/type=video at the edge. NO typename filter —
// real song uploads routinely sit in non-music partitions (the actual 晴天
// upload was typed 日常）; ranking does the relevance work.
// - Identity: songid = bvid. serializeTrack drops extras, and the cid is
// re-derived at resolve time (pagelist), so nothing else needs storing.
// - Playback: bilivideo CDN urls 403 without a bilibili Referer and <audio>
// cannot set one — so audioUrl points at our own /api/bilibili/stream
// route, which injects the Referer at the edge (the route's header has the
// 403/403/206 probe table). /api/bilibili/resolve exists to prove
// playability + supply the honest bitrate label before we commit.
// - Lyrics: none — Bilibili has no lyric API; lrc stays null, cleanly.
// - Multi-part videos resolve to their FIRST part (music uploads are
// single-part; documented limitation, same as music-lib).

import type { SourceAdapter, Track} from './types';
import { makeUid} from './types';
import { apiFetch, apiUrl} from '../services/api-base';

// ---- Upstream JSON shapes (only fields we read; all optional — untrusted) ----------------

interface BiSearchItem {
bvid?: string;
title?: string; // carries <em class="keyword"> highlights
author?: string;
pic?: string; // often protocol-relative //i0.hdslb.com/…
duration?: string; // "4:30" (or "1:02:03")
typename?: string;
}
interface BiSearchResponse {
code?: number;
data?: { result?: BiSearchItem[]};
}
interface BiResolveResponse {
url?: string | null;
bandwidth?: number;
cid?: number;
}

/** Strip the <em> keyword-highlight tags bilibili wraps around matched text. */
function stripEm(s: string | undefined): string {
if (!s) return '';
return s.replace(/<[^>]+>/g, '');
}

/** "4:30" / "1:02:03" → seconds; anything unparseable → undefined. */
function parseDuration(s: string | undefined): number | undefined {
if (!s) return undefined;
const parts = s.split(':').map((p) => Number(p));
if (parts.some((n) =>!Number.isFinite(n) || n < 0)) return undefined;
if (parts.length === 2) return parts[0] * 60 + parts[1];
if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
return undefined;
}

/** Honest quality label from the DASH audio bandwidth the resolve route reports. */
function qualityFromBandwidth(bw: number | undefined): { tag: string; label: string} {
if (!bw || bw <= 0) return { tag: '128k', label: '128K'};
if (bw >= 160000) return { tag: '192k', label: '192K'};
if (bw >= 90000) return { tag: '128k', label: '128K'};
return { tag: '64k', label: '64K'};
}

export const bilibili: SourceAdapter = {
id: 'bilibili',
label: 'Bilibili',
enabledByDefault: true,
// Search-only: never let a video upload satisfy another source's resolve.
autoResolveEligible: false,

async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
const pg = Math.max(1, page || 1);
const path = `/api/bilibili/search?keyword=${encodeURIComponent(keyword)}&page=${pg}&pagesize=20`;

const res = await apiFetch(path, { signal});
const json = (await res.json()) as BiSearchResponse | null;

// Contract-drift guard: the anchor is { code: 0, data: { result: [...]}}.
if (!json || json.code!== 0 ||!json.data ||!Array.isArray(json.data.result)) {
throw new Error('bilibili: contract-drift (expected {code:0, data:{result:[]}} search body)');
}

const tracks: Track[] = [];
json.data.result.forEach((it, idx) => {
const bvid = (it.bvid || '').trim();
if (!bvid) return; // no playable identity — skip
tracks.push({
uid: makeUid('bilibili', bvid),
source: 'bilibili',
songid: bvid,
title: stripEm(it.title),
artist: it.author || '',
album: '',
cover: it.pic? (it.pic.startsWith('//')? `https:${it.pic}`: it.pic): null,
audioUrl: null,
lrc: null,
lrcUrl: null,
detailsLoaded: false,
quality: null,
qualityLabel: null,
keyword,
displayIndex: idx + 1,
duration: parseDuration(it.duration)
});
});
return tracks;
},

async resolve(track: Track, signal: AbortSignal): Promise<Track> {
const bvid = track.songid;
const path = `/api/bilibili/resolve?bvid=${encodeURIComponent(bvid)}`;
const res = await apiFetch(path, { signal});
const json = (await res.json()) as BiResolveResponse | null;
if (!json ||!json.url) {
throw new Error('bilibili: no playable audio stream (gone or region-locked)');
}
// NOT json.url: the raw bilivideo CDN url 403s in <audio> (Referer gate).
// The stream route re-resolves server-side and injects the Referer.
// Pitfall 3: this URL is consumed directly by <audio>.src, so it MUST be
// absolute in the native APK (apiUrl() prepends the base; no-op on web) —
// the same pattern netease/audius use for their own-origin stream urls.
track.audioUrl = apiUrl(`/api/bilibili/stream?bvid=${encodeURIComponent(bvid)}`);
const q = qualityFromBandwidth(json.bandwidth);
track.quality = q.tag;
track.qualityLabel = q.label;
track.detailsLoaded = true;
return track;
}
};
