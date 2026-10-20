// Kugou client adapter (quick-261020-kugo — 腾讯音乐-adjacent CN catalog giant).
//
// Kugou closes the last big CN-catalog gap: QQ/NetEase/Kuwo/JOOX all miss songs the
// others hold, and Kugou's catalogue (esp. older Cantopop + live recordings) overlaps
// only partially with them. It joins the resolve floor (autoResolveEligible stays
// undefined = eligible) right after joox.
//
// Ported from the open-source references (no runtime deps — hand-written like every
// adapter here):
//   - MakcRe/KuGouMusicApi (MIT) — endpoint inventory + quality vocabulary.
//   - guohuiyuan/music-lib `kugou` (AGPL, read-only reference) — search via
//     song_search_v2, resolve via getSongInfo → tracker fallback, KRC lyrics.
//   - ELDment/Meting-Fixed (MIT) — the get_res_privilege → trackercdn cmd=25 leg.
//   - CharlesPikachu/musicdl `kugou` — search parameter set.
//
// Live-probed from the VM 2026-10-20 before this port was written:
//   - song_search_v2 answers over HTTPS with per-quality hashes on every row.
//   - getSongInfo returns a direct CDN url (206-verified audio/mpeg) for free songs;
//     paid songs return an empty url + pay_type>0 — resolve() throws for those and
//     cross-source fallback (SRC-FB-01) covers the song, like a QQ region-block.
//   - wwwapi getdata is DEAD anonymously (err_code 30020, needs a dfid session) and
//     the v5 gateway needs a user token — neither is used (see the url route header).
//
// Identity: songid = the 128k FileHash (32-hex). The HQ/SQ/Res hashes + album id ride
// along as OPTIONAL extras — serializeTrack drops extras by design, so a restored
// library track keeps only the std hash and resolve() still works (one tier).

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch } from '../services/api-base';
import { pickByQualityPref, effectiveQuality } from './quality';
import { settings, type DefaultQuality } from '$lib/stores/settings.svelte';

// ---- Upstream JSON shapes (only fields we read; all optional — untrusted) ----------------

interface KgSearchItem {
	SongName?: string;
	SingerName?: string;
	FileName?: string; // "<em>Artist</em> - Title" — fallback when SongName drifts
	AlbumName?: string;
	AlbumID?: string | number;
	Duration?: number; // seconds
	FileHash?: string; // 128k mp3
	HQFileHash?: string; // 320k mp3
	SQFileHash?: string; // FLAC
	ResFileHash?: string; // hi-res
}
interface KgSearchResponse {
	status?: number;
	data?: { lists?: KgSearchItem[] };
}

// Normalized /api/kugou/url result (the edge route hides upstream envelope drift).
interface KgUrlResponse {
	url?: string | null;
	backupUrl?: string | null;
	bitRate?: number;
	extName?: string;
	cover?: string | null;
}
interface KgLyricResponse {
	lrc?: string | null;
}

/** Strip `<em class="keyword">…</em>` highlight tags Kugou wraps around matched text. */
function stripEm(s: string | undefined): string {
	if (!s) return '';
	return s.replace(/<[^>]+>/g, '');
}

/** Search title: SongName, else the part after " - " in FileName (music-lib format_kugou). */
function rowTitle(it: KgSearchItem): string {
	const name = stripEm(it.SongName);
	if (name) return name;
	const fn = stripEm(it.FileName);
	const dash = fn.indexOf(' - ');
	return dash >= 0 ? fn.slice(dash + 3).trim() : fn;
}

/** Quality tag/label from the RESOLVED bitrate the url route reports back. */
function qualityFromBitRate(bitRate: number | undefined, url: string): { tag: string; label: string } {
	if (!bitRate || bitRate <= 0) return inferQualityFromUrl(url);
	if (bitRate >= 800) return { tag: 'lossless', label: 'FLAC' };
	if (bitRate >= 256) return { tag: '320k', label: '320K' };
	if (bitRate >= 112) return { tag: '128k', label: '128K' };
	return { tag: `${bitRate}k`, label: `${bitRate}K` };
}

/** One rung of the resolve ladder: a display tier name (quality.ts BAND vocabulary) + hash. */
interface KgTier {
	tier: string;
	hash: string;
}

export const kugou: SourceAdapter = {
	id: 'kugou',
	label: 'Kugou',
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		const pg = Math.max(1, page || 1);
		const path = `/api/kugou/search?keyword=${encodeURIComponent(keyword)}&page=${pg}&pagesize=20`;

		const res = await apiFetch(path, { signal });
		const json = (await res.json()) as KgSearchResponse | null;

		// Contract-drift guard: song_search_v2's anchor is { status: 1, data: { lists: [] } }.
		// Missing → throw so the fan-out records a typed per-source error (mirrors kuwo.ts).
		if (!json || json.status !== 1 || !json.data || !Array.isArray(json.data.lists)) {
			throw new Error('kugou: contract-drift (expected {status:1, data:{lists:[]}} search body)');
		}

		const tracks: Track[] = [];
		json.data.lists.forEach((it, idx) => {
			const hash = (it.FileHash || '').trim();
			if (!hash) return; // no playable identity — skip
			tracks.push({
				uid: makeUid('kugou', hash),
				source: 'kugou',
				songid: hash,
				title: rowTitle(it),
				artist: stripEm(it.SingerName),
				album: it.AlbumName || '',
				cover: null, // search rows carry no album art; resolve() fills it from getSongInfo
				audioUrl: null,
				lrc: null,
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1,
				duration: typeof it.Duration === 'number' && it.Duration > 0 ? it.Duration : undefined,
				kugouAlbumId: it.AlbumID !== undefined && it.AlbumID !== '' ? String(it.AlbumID) : undefined,
				kugouHqHash: it.HQFileHash || undefined,
				kugouSqHash: it.SQFileHash || undefined,
				kugouResHash: it.ResFileHash || undefined
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal, quality?: DefaultQuality): Promise<Track> {
		// Quality ladder, top tier first (the quality.ts convention). Tier names speak the
		// BAND vocabulary ('lossless'/'flac'/'320'/'128') so pickByQualityPref can bias the
		// ladder toward the user's pref; the edge route may still hand back a lower actual
		// bitrate for a tier (Kugou downgrades silently), and the label follows the
		// RETURNED bitRate, never the requested tier — honest labelling (WR-07).
		const ladder: KgTier[] = [];
		if (track.kugouResHash) ladder.push({ tier: 'lossless', hash: track.kugouResHash });
		if (track.kugouSqHash) ladder.push({ tier: 'flac', hash: track.kugouSqHash });
		if (track.kugouHqHash) ladder.push({ tier: '320', hash: track.kugouHqHash });
		ladder.push({ tier: '128', hash: track.songid });

		const pref = effectiveQuality(quality ?? settings.defaultQuality);
		const orderedNames = pickByQualityPref(
			ladder.map((t) => t.tier),
			pref
		);
		const ordered: KgTier[] = [];
		for (const name of orderedNames) {
			const rung = ladder.find((t) => t.tier === name && !ordered.includes(t));
			if (rung) ordered.push(rung);
		}

		const albumParam = track.kugouAlbumId ? `&album_id=${encodeURIComponent(track.kugouAlbumId)}` : '';
		let resolved: KgUrlResponse | null = null;
		for (const rung of ordered) {
			const path = `/api/kugou/url?hash=${encodeURIComponent(rung.hash)}${albumParam}`;
			try {
				const res = await apiFetch(path, { signal });
				const j = (await res.json()) as KgUrlResponse | null;
				if (j && j.url) {
					resolved = j;
					break;
				}
			} catch (e) {
				if (signal.aborted) throw e;
				// one tier failing (transport) → try the next rung before giving up
			}
		}
		if (!resolved || !resolved.url) {
			throw new Error('kugou: no playable url (paid or unavailable anonymously)');
		}

		track.audioUrl = resolved.url;
		if (!track.cover && resolved.cover) track.cover = resolved.cover;
		const q = qualityFromBitRate(resolved.bitRate, resolved.url);
		track.quality = q.tag;
		track.qualityLabel = q.label;
		track.detailsLoaded = true;

		// Lyrics are best-effort (every adapter's posture): the KRC chain needs
		// "Artist - Title" + duration; a miss leaves lrc null and the pane degrades.
		if (!track.lrc) {
			try {
				const kw = `${track.artist} - ${track.title}`;
				const durMs = track.duration ? Math.round(track.duration * 1000) : 0;
				const lp = `/api/kugou/lyric?keyword=${encodeURIComponent(kw)}&duration=${durMs}&hash=${encodeURIComponent(track.songid)}`;
				const lres = await apiFetch(lp, { signal });
				const lj = (await lres.json()) as KgLyricResponse | null;
				if (lj && typeof lj.lrc === 'string' && lj.lrc) track.lrc = lj.lrc;
			} catch {
				// lyric miss is not a resolve failure — the song still plays
			}
		}
		return track;
	}
};
