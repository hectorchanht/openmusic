// 5sing client adapter (quick-260607-hvu — Kugou UGC sub-platform).
//
// 5sing fills a catalog gap NONE of netease/qq/kuwo/joox cover well: amateur covers (翻唱),
// instrumental backing tracks (伴奏/karaoke), and original UGC songs. Audio is a direct
// progressive mp3 from *.kugou.com — plays in HTML <audio> with no MSE. Reachable from a
// non-CN edge (verified 2026-06-07 by the source researcher).
//
// Ships `enabledByDefault: true` — searched by default alongside the 4 mainstream CN sources
// (flipped from the original opt-in default in 1bf113c). Users can still toggle it off via the
// source-prefs plumbing in `getEnabledAdapters` (Settings → Playback → Advanced → Sources).
//
// Two identity-critical quirks (from RESEARCH.md):
//  1. `songid` is NOT unique across songtypes (fc/bz/yc) — the SAME numeric id maps to
//     DIFFERENT tracks per type. So uid folds songtype into songid: `fivesing:<type>-<id>`.
//  2. Audio URLs carry a short-lived timestamp segment (~1-2h). resolve() is already called
//     lazily before each play; the cross-source fallback (gte / SRC-FB-01) handles expired
//     URLs the same way it handles region-blocks.
//
// Search responses wrap the matched substring in <em class="keyword">…</em> HTML — stripped
// in the adapter, NOT the proxy (proxy stays a clean passthrough).

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch } from '../services/api-base';
import { fivesingHealth } from '../services/fivesing-health';

// ---- Upstream JSON shapes (only fields we read; all optional — untrusted) ----------------

interface FsSearchItem {
	songId?: number | string;
	songName?: string;
	singer?: string;
	originSinger?: string;
	type?: number;          // numeric song-type id (unused — we use typeEname)
	typeEname?: string;     // 'fc' | 'bz' | 'yc' — the identity-critical token
	typeName?: string;      // 翻唱 / 伴奏 / 原创 — shown as the album label
	ext?: string;
}
interface FsSearchResponse {
	list?: FsSearchItem[];
}

interface FsUrlData {
	squrl?: string;
	hqurl?: string;
	lqurl?: string;
	squrl_backup?: string;
	hqurl_backup?: string;
	lqurl_backup?: string;
}
interface FsUrlResponse {
	code?: number;
	data?: FsUrlData;
}

/** Strip `<em class="keyword">…</em>` (and any other tags) from a display string. */
function stripEm(s: string | undefined): string {
	if (!s) return '';
	return s.replace(/<[^>]+>/g, '');
}

/** Coerce typeEname to the 3-letter enum we trust; default to 'yc' (original) on drift. */
function toSongType(raw: string | undefined): 'fc' | 'bz' | 'yc' {
	return raw === 'fc' || raw === 'bz' || raw === 'yc' ? raw : 'yc';
}

export const fivesing: SourceAdapter = {
	id: 'fivesing',
	health: fivesingHealth,
	label: '5sing',
	// Ships enabled by default (1bf113c); toggleable off via prefs (Settings → Playback →
	// Advanced → Sources) for users who want a cleaner search, since UGC supply (covers/karaoke)
	// is noisier than the 4 mainstream CN sources.
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// HEALTH-GATE short-circuit (fivesing-health, universal-gate rollout 2026-11-01):
		// after a run of failures/drys, skip the wasted call for a bounded window; the gate
		// then auto-opens for one probe whose outcome re-decides. Never-throw on this path.
		if (fivesingHealth.isGated()) return [];

		const pg = Math.max(1, page || 1);
		const path = `/api/fivesing/search?keyword=${encodeURIComponent(keyword)}&page=${pg}&pagesize=20`;

		// Fetch + parse in ONE try (the kuwoJson lesson) so every failure shape counts; a
		// caller abort is a supersede, not an outage — rethrown uncounted.
		let json: FsSearchResponse | null;
		try {
			const res = await apiFetch(path, { signal });
			json = (await res.json()) as FsSearchResponse | null;
		} catch (err) {
			if (!signal.aborted) fivesingHealth.recordFail();
			throw err;
		}

		// Contract-drift guard: 5sing's `list` is the anchor. Missing → throw so the fan-out
		// records a typed per-source error rather than silently dropping the source (mirrors
		// kuwo.ts).
		if (!json || !Array.isArray(json.list)) {
			fivesingHealth.recordFail();
			throw new Error('fivesing: contract-drift (expected {list:[]} search body)');
		}
		// DRY counting (fivesing-health): the search route converts an upstream outage
		// into this exact well-formed EMPTY body, so an empty list is this source's outage
		// shape — recordDry. Rows prove a live upstream — recordOk, instant recovery.
		if (json.list.length === 0) fivesingHealth.recordDry();
		else fivesingHealth.recordOk();

		const tracks: Track[] = [];
		json.list.forEach((it, idx) => {
			const id = it.songId;
			if (id === undefined || id === null || id === '') return;
			const songtype = toSongType(it.typeEname);
			// Compound songid → uid: `fivesing:<type>-<id>`. Stripping the prefix is never
			// done in app code; resolve() reads `songid` straight off the Track.
			const songid = `${songtype}-${String(id)}`;
			tracks.push({
				uid: makeUid('fivesing', songid),
				source: 'fivesing',
				songid,
				title: stripEm(it.songName),
				artist: stripEm(it.singer || it.originSinger || ''),
				album: it.typeName || '',     // 翻唱/伴奏/原创 doubles as the "album" label
				cover: null,                   // 5sing has no per-track cover; Deezer/Last.fm backfill fills it
				audioUrl: null,
				lrc: null,
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1,
				fivesingSongType: songtype
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal): Promise<Track> {
		// Songtype must round-trip via the Track. If it's missing (e.g. an old saved-library
		// track from before this adapter shipped fivesingSongType in serialize), peel it off
		// the compound songid prefix as a defensive recovery.
		let songtype: 'fc' | 'bz' | 'yc' = track.fivesingSongType ?? 'yc';
		if (!track.fivesingSongType) {
			const m = track.songid.match(/^(fc|bz|yc)-/);
			if (m) songtype = m[1] as 'fc' | 'bz' | 'yc';
		}
		// The numeric songid for the upstream `getSongUrl` — strip the type prefix back off.
		const numericId = track.songid.replace(/^(fc|bz|yc)-/, '');
		const path = `/api/fivesing/url?songid=${encodeURIComponent(numericId)}&songtype=${encodeURIComponent(songtype)}`;

		// Deliberately NOT gated (the kuwo rule): a gated window never refuses a chosen
		// track — but the outcome feeds the gate (fivesing-health). The url route converts
		// an upstream failure into HTTP 200 {code:0, data:{}}, so the failure branch below
		// IS this leg's outage shape; a transport throw counts the same way.
		let j: FsUrlResponse | null;
		try {
			const res = await apiFetch(path, { signal });
			j = (await res.json()) as FsUrlResponse | null;
		} catch (err) {
			if (!signal.aborted) fivesingHealth.recordFail();
			throw err;
		}
		if (!j || j.code !== 1000 || !j.data) {
			fivesingHealth.recordFail();
			throw new Error('fivesing: detail failed');
		}
		const d = j.data;
		// Tier fallback ladder: sq (lossless) → hq (high) → lq (low) → backups. Any one can
		// be the empty string on UGC tracks (sq is often empty); fall through left to right.
		const audioUrl =
			d.squrl || d.hqurl || d.lqurl ||
			d.squrl_backup || d.hqurl_backup || d.lqurl_backup || null;
		if (!audioUrl) {
			// code:1000 + data proves a LIVE upstream — this song simply has no playable
			// tier (a per-song miss): recordOk, then throw as before.
			fivesingHealth.recordOk();
			throw new Error('fivesing: no playable url tier returned');
		}
		fivesingHealth.recordOk();

		track.audioUrl = audioUrl;
		track.detailsLoaded = true;
		const q = inferQualityFromUrl(audioUrl);
		track.quality = q.tag;
		track.qualityLabel = q.label;
		return track;
	}
};
