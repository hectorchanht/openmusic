// Migu client adapter (quick-261020-migu — China Mobile's catalog, esp. deep
// mainland repertoire the Tencent/NetEase catalogs miss).
//
// Ported from the open-source references (hand-written, no runtime deps):
//   - guohuiyuan/music-lib `migu` (AGPL, read-only reference) — search_all.do search,
//     v2.1 listen-url resolve, FORMAT_BITRATE vocabulary.
//   - CharlesPikachu/musicdl `migu` — format table semantics + the PC-listen lyric leg.
//   - Domdkw/miguMusic-api-enhanced (MIT) — PC strategy listen endpoints.
//
// Identity: songid = `contentId|copyrightId|resourceType|formatType` — a composite,
// because Migu has no single song id: the listen endpoints need contentId AND
// copyrightId AND the chosen rate format. copyrightId rides INSIDE the composite
// (not in a Track extra) on purpose: serializeTrack drops extras, so a restored
// library track must still resolve from songid alone.
//
// The format is chosen AT SEARCH TIME by the brief's rule: drop VIP/paid formats
// (showTag contains 'vip', or chargeAuditions == '1' with price >= 200), then pick
// the LARGEST remaining (free) format. Z3D is always dropped — it is an ENCRYPTED
// format no anonymous client can play. If every format is paid, the largest overall
// is kept as the identity (the song still lists + dedupes; resolve will throw and
// cross-source fallback covers playback — the same posture as a paid QQ track).
//
// Resolve reality (probed 2026-10-20): Migu region-gates its listen endpoints by
// egress IP — from non-CN egress the app/PC legs answer a region dialog and the
// legacy leg's gateway route is retired, though the same legacy leg returned
// playable freetyst URLs from another egress earlier the same day. The edge route
// runs all three legs; when all refuse, resolve() throws like any unavailable
// source. Search is fully live everywhere.

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl, type QualityInfo } from '../services/lrc';
import { apiFetch } from '../services/api-base';
import { effectiveQuality } from './quality';
import { settings, type DefaultQuality } from '$lib/stores/settings.svelte';

// ---- Upstream JSON shapes (only fields we read; all optional — untrusted) ----------------

interface MgFormat {
	formatType?: string; // PQ/HQ/SQ/LQ/ZQ24/…
	resourceType?: string; // '2' audio, 'E' lossless package, '3' low
	price?: string | number; // cents as string, e.g. '200'
	size?: string | number;
	androidSize?: string | number;
	showTag?: string | string[] | null;
	showTags?: string | string[] | null;
	fileType?: string;
	androidFileType?: string;
}
interface MgSearchItem {
	name?: string;
	contentId?: string;
	copyrightId?: string;
	chargeAuditions?: string | number; // '1' = paid audition rules apply
	singers?: Array<{ name?: string }>;
	albums?: Array<{ name?: string }>;
	imgItems?: Array<{ img?: string }>;
	duration?: number;
	newRateFormats?: MgFormat[];
	rateFormats?: MgFormat[];
}
interface MgSearchResponse {
	songResultData?: { result?: MgSearchItem[] };
}
interface MgUrlResponse {
	url?: string | null;
	tone?: string;
}
interface MgLyricResponse {
	lrc?: string | null;
}

/** Nominal kbps per tone (music-lib FORMAT_BITRATE); ZQ24 is hi-res FLAC (~1411k+). */
const TONE_BITRATE: Record<string, number> = {
	LQ: 64,
	PQ: 128,
	HQ: 320,
	SQ: 999,
	ZQ: 1411,
	ZQ24: 1536
};

/** Quality tag/label for a delivered tone, falling back to URL-extension inference. */
function qualityForTone(tone: string | undefined, url: string): QualityInfo {
	const br = tone ? TONE_BITRATE[tone] : undefined;
	if (!br) return inferQualityFromUrl(url);
	if (br >= 900) return { tag: 'lossless', label: 'FLAC' };
	if (br >= 256) return { tag: '320k', label: '320K' };
	if (br >= 112) return { tag: '128k', label: '128K' };
	return { tag: `${br}k`, label: `${br}K` };
}

/** showTag arrives as a string OR a string array depending on the format table. */
function tagText(f: MgFormat): string {
	const parts: string[] = [];
	for (const v of [f.showTag, f.showTags]) {
		if (typeof v === 'string') parts.push(v);
		else if (Array.isArray(v)) parts.push(...v.filter((x): x is string => typeof x === 'string'));
	}
	return parts.join(' ').toLowerCase();
}

function formatSize(f: MgFormat): number {
	const n = Number(f.size ?? f.androidSize ?? 0);
	return Number.isFinite(n) ? n : 0;
}

/** The brief's paid-format rule, applied to ONE format of a row. */
function isPaidFormat(f: MgFormat, chargeAuditions: string): boolean {
	if (tagText(f).includes('vip')) return true;
	const price = Number(f.price ?? 0);
	return chargeAuditions === '1' && Number.isFinite(price) && price >= 200;
}

/**
 * Pick the row's identity format: largest FREE format (by byte size), else the
 * largest format overall. Z3D (encrypted) and format-less entries never qualify.
 * Returns null when the row carries no formats at all — then it has no playable
 * identity and search skips it (like a Kugou row without a FileHash).
 */
function pickFormat(it: MgSearchItem): MgFormat | null {
	const all = [...(it.newRateFormats ?? []), ...(it.rateFormats ?? [])].filter(
		(f) => f && typeof f.formatType === 'string' && f.formatType !== 'Z3D' && typeof f.resourceType === 'string'
	);
	if (all.length === 0) return null;
	// De-dupe by (formatType, resourceType) — the two tables overlap heavily.
	const seen = new Set<string>();
	const uniq = all.filter((f) => {
		const k = `${f.formatType}|${f.resourceType}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	const charge = String(it.chargeAuditions ?? '');
	const free = uniq.filter((f) => !isPaidFormat(f, charge));
	const pool = free.length > 0 ? free : uniq;
	return pool.reduce((best, f) => (formatSize(f) > formatSize(best) ? f : best), pool[0]);
}

export const migu: SourceAdapter = {
	id: 'migu',
	label: 'Migu',
	enabledByDefault: true,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		const pg = Math.max(1, page || 1);
		const path = `/api/migu/search?keyword=${encodeURIComponent(keyword)}&page=${pg}&pagesize=20`;

		const res = await apiFetch(path, { signal });
		const json = (await res.json()) as MgSearchResponse | null;

		// Contract-drift guard: the anchor is { songResultData: { result: [...] } }.
		if (!json || !json.songResultData || !Array.isArray(json.songResultData.result)) {
			throw new Error('migu: contract-drift (expected {songResultData:{result:[]}} search body)');
		}

		const tracks: Track[] = [];
		json.songResultData.result.forEach((it, idx) => {
			const fmt = pickFormat(it);
			if (!it.contentId || !it.copyrightId || !fmt) return; // no playable identity — skip
			const songid = `${it.contentId}|${it.copyrightId}|${fmt.resourceType}|${fmt.formatType}`;
			const imgs = it.imgItems ?? [];
			tracks.push({
				uid: makeUid('migu', songid),
				source: 'migu',
				songid,
				title: it.name || '',
				artist: (it.singers ?? []).map((s) => s.name || '').filter(Boolean).join(' / '),
				album: it.albums?.[0]?.name || '',
				cover: imgs.length > 0 ? (imgs[imgs.length - 1].img ?? null) : null,
				audioUrl: null,
				lrc: null,
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1,
				duration: typeof it.duration === 'number' && it.duration > 0 ? it.duration : undefined
			});
		});
		return tracks;
	},

	async resolve(track: Track, signal: AbortSignal, quality?: DefaultQuality): Promise<Track> {
		const parts = track.songid.split('|');
		if (parts.length !== 4) {
			throw new Error('migu: malformed composite songid');
		}
		const [contentId, copyrightId, storedRt, storedTone] = parts;

		// Tone ladder: the user's pref first (when it differs), then the search-time
		// pick, then PQ — the tone anonymous Migu legs most reliably serve. Each tone
		// goes through the edge route's full three-leg chain.
		const pref = effectiveQuality(quality ?? settings.defaultQuality);
		const prefTone = pref === 'lossless' ? storedTone : pref === '320' ? 'HQ' : 'PQ';
		const tones: Array<{ tone: string; rt: string }> = [];
		const pushTone = (tone: string, rt: string) => {
			if (!tones.some((t) => t.tone === tone)) tones.push({ tone, rt });
		};
		pushTone(prefTone, prefTone === storedTone ? storedRt : '2');
		pushTone(storedTone, storedRt);
		pushTone('PQ', '2');

		let resolved: MgUrlResponse | null = null;
		for (const { tone, rt } of tones) {
			const path =
				`/api/migu/url?contentId=${encodeURIComponent(contentId)}` +
				`&copyrightId=${encodeURIComponent(copyrightId)}` +
				`&resourceType=${encodeURIComponent(rt)}&tone=${encodeURIComponent(tone)}`;
			try {
				const res = await apiFetch(path, { signal });
				const j = (await res.json()) as MgUrlResponse | null;
				if (j && j.url) {
					resolved = j;
					break;
				}
			} catch (e) {
				if (signal.aborted) throw e;
				// one tone failing (transport) → try the next before giving up
			}
		}
		if (!resolved || !resolved.url) {
			throw new Error('migu: no playable url (VIP or region-restricted)');
		}

		track.audioUrl = resolved.url;
		const q = qualityForTone(resolved.tone, resolved.url);
		track.quality = q.tag;
		track.qualityLabel = q.label;
		track.detailsLoaded = true;

		// Lyrics best-effort via the PC-listen lrcUrl leg (see the lyric route header).
		if (!track.lrc) {
			try {
				const lp = `/api/migu/lyric?contentId=${encodeURIComponent(contentId)}&copyrightId=${encodeURIComponent(copyrightId)}`;
				const lres = await apiFetch(lp, { signal });
				const lj = (await lres.json()) as MgLyricResponse | null;
				if (lj && typeof lj.lrc === 'string' && lj.lrc) track.lrc = lj.lrc;
			} catch {
				// lyric miss is not a resolve failure — the song still plays
			}
		}
		return track;
	}
};
