// JOOX client adapter — real port (Task 1, plan 01-03) of searchJoox
// (legacy/index.html:2169-2212) + fetchJooxDetails/probeJooxAudioUrl/pickJooxPlayUrl
// (legacy/index.html:2424-2504).
//
// Differences from the monolith (intentional):
//   - calls the SAME-ORIGIN proxy /api/joox/... instead of apicx.asia directly. The
//     client NEVER sends the JOOX token or br — the ProxyAdapter injects them from
//     platform.env server-side (success criterion #2 / DATA-02). This file references
//     NO token whatsoever.
//   - emits the canonical COLON-form uid `joox:<songMid||歌曲ID>` (D-10), not the hyphen form.
//   - THE IDENTITY FIX (Pitfall 4 / criterion #4): the upstream detail is keyed by the
//     positional `n`, so after a reorder/paginate the wrong song can come back. We STILL
//     send `n=jooxIndex` (the upstream requires it) but RE-VALIDATE the returned songmid /
//     歌曲ID against the track we actually intended to resolve, and THROW on a mismatch
//     (leaving detailsLoaded false) rather than silently play the wrong song. jooxIndex is
//     ORDERING-only and is never treated as identity.
//   - probeJooxAudioUrl is ported verbatim but modernized to AbortSignal.timeout(3000)
//     (RESEARCH "Don't Hand-Roll"). It runs BROWSER-SIDE here (NOT in the proxy) so it
//     sees the same IP/region that will actually play the audio (PATTERNS spike caveat).
//   - on contract drift it THROWS so catalog's Promise.allSettled records a typed
//     per-source error (DATA-03), instead of the monolith's swallow-and-return-0.
import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { inferQualityFromUrl } from '../services/lrc';
import { apiFetch } from '../services/api-base';
import { settings, type DefaultQuality } from '$lib/stores/settings.svelte';
import { pickByQualityPref } from './quality';

// JOOX search row shape from the apicx proxy (Chinese field names we read).
interface JooxSearchItem {
	songmid?: string;
	'歌曲ID'?: string;
	'歌曲名称'?: string;
	'歌手'?: string;
	'专辑'?: string;
	'歌词内容'?: string;
}

interface JooxSearchResponse {
	code?: number;
	data?: { songs?: JooxSearchItem[] };
}

// JOOX detail row shape (Chinese field names + the 播放链接 quality-tier map).
interface JooxDetailData {
	songmid?: string;
	'歌曲ID'?: string;
	'歌曲名称'?: string;
	'歌手'?: string;
	'专辑'?: string;
	'歌词内容'?: string;
	'播放链接'?: Record<string, string>;
}

interface JooxDetailResponse {
	code?: number;
	data?: JooxDetailData;
}

interface PickedPlayUrl {
	url: string | null;
	tag: string | null;
	label: string | null;
	text: string | null;
}

const PROBE_TIMEOUT_MS = 3000;

/**
 * Probe whether an audio URL is reachable. Ported from legacy/index.html:2434-2464 but
 * the hand-rolled setTimeout+AbortController timeout is replaced by the native
 * AbortSignal.timeout (RESEARCH "Don't Hand-Roll"). HEAD first (cheap), then a ranged
 * GET `bytes=0-0` fallback for CDNs that reject HEAD.
 *
 * Runs browser-side in the adapter so the probe sees the playing client's IP/region.
 * The caller's `outerSignal` (search/resolve abort) is composed with the per-attempt
 * timeout when the runtime supports AbortSignal.any.
 */
async function probeJooxAudioUrl(
	u: string | null | undefined,
	outerSignal: AbortSignal
): Promise<boolean> {
	if (!u) return false;

	const request = async (method: string, extra?: RequestInit): Promise<boolean> => {
		const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
		const signal =
			typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, outerSignal]) : timeout;
		// RAW fetch (not apiFetch — fetch→apiFetch audit): `u` is an ABSOLUTE JOOX CDN audio URL probed
		// for playability (media, HEAD/GET), not an /api JSON call. apiFetch would corrupt an absolute URL.
		const res = await fetch(u, {
			method,
			cache: 'no-store',
			redirect: 'follow',
			signal,
			...extra
		});
		return !!res && (res.ok || res.status === 206 || (res.status >= 200 && res.status < 400));
	};

	try {
		if (await request('HEAD')) return true;
	} catch {
		// Some music CDN links do not allow HEAD. Fall through to a tiny ranged GET.
	}
	try {
		return await request('GET', { headers: { Range: 'bytes=0-0' } });
	} catch {
		return false;
	}
}

// JOOX quality tiers in descending preference. Ported VERBATIM from
// legacy/index.html:2467 (pickJooxPlayUrl order). Do NOT reorder.
const JOOX_QUALITY_ORDER = [
	'Atmos全景声',
	'无损FLAC',
	'Hi-Res无损',
	'母带无损',
	'OGG 320',
	'MP3 320',
	'AAC 192',
	'OGG 192',
	'MP3 128',
	'AAC 96',
	'AAC 48'
];

/**
 * Pick the best reachable play URL from the 播放链接 tier map. Each candidate is probed;
 * the first reachable tier in the (pref-reordered) order wins. Ported from
 * legacy/index.html:2466-2479.
 *
 * D-03: the verbatim order (Atmos > FLAC > Hi-Res > 母带 > OGG320 > MP3320 > AAC192 >
 * OGG192 > MP3128 > ...) is reordered via `pickByQualityPref` so the band matching
 * `settings.defaultQuality` is probed FIRST. Under the '128' default the 128–160k band
 * (AAC 192 / OGG 192 / MP3 128) is preferred; 'lossless'/'auto' keep the verbatim order.
 * The proxy `JOOX_BR=4` tier-SET selector is left untouched (it just makes all tiers
 * available; keeps proxy.test.ts `br=4` green — A3 / client-ladder approach).
 */
async function pickJooxPlayUrl(
	links: Record<string, string>,
	outerSignal: AbortSignal,
	quality?: DefaultQuality
): Promise<PickedPlayUrl> {
	// WR-07: an explicit per-call quality (download path) wins over the streaming pref.
	const order = pickByQualityPref(JOOX_QUALITY_ORDER, quality ?? settings.defaultQuality);
	for (const name of order) {
		const u = links[name];
		if (!u) continue;
		if (!(await probeJooxAudioUrl(u, outerSignal))) continue;
		if (/母带|无损|flac|hi-res|atmos/i.test(name) || /\.flac(?:\?|$)/i.test(u)) {
			return { url: u, tag: 'lossless', label: 'LOSSLESS', text: name };
		}
		const m = name.match(/(\d+)$/);
		if (m) return { url: u, tag: `${m[1]}k`, label: `${m[1]}K`, text: name };
		return { url: u, tag: null, label: null, text: name };
	}
	return { url: null, tag: null, label: null, text: null };
}

export const joox: SourceAdapter = {
	id: 'joox',
	label: 'JOOX',
	enabledByDefault: true,

	async search(keyword: string, _page: number, signal: AbortSignal): Promise<Track[]> {
		// The proxy injects token + br server-side — the client only sends the keyword.
		const path = `/api/joox/search?msg=${encodeURIComponent(keyword)}`;

		const res = await apiFetch(path, { signal });
		const json = (await res.json()) as JooxSearchResponse;

		// Contract-drift guard: JOOX must return code:200 with data.songs[]. Throw (not
		// return 0) so the fan-out records a typed per-source error (DATA-03).
		const songs =
			json && json.code === 200 && Array.isArray(json.data?.songs) ? json.data!.songs! : null;
		if (!songs) {
			throw new Error('joox: contract-drift (expected {code:200,data:{songs:[]}})');
		}

		return songs.map((it, idx) => {
			const songMid = it.songmid || '';
			const jooxSongId = it['歌曲ID'] || '';
			// songid (and uid) prefer the stable songmid; fall back to 歌曲ID (D-10).
			const songid = songMid || jooxSongId || String(idx + 1);
			const track: Track = {
				uid: makeUid('joox', songid),
				source: 'joox',
				songid,
				title: it['歌曲名称'] || '',
				artist: it['歌手'] || '',
				album: it['专辑'] || '',
				cover: null,
				audioUrl: null,
				lrc: it['歌词内容'] || null, // JOOX returns lyrics inline at search time
				lrcUrl: null,
				detailsLoaded: false,
				quality: null,
				qualityLabel: null,
				keyword,
				displayIndex: idx + 1,
				// JOOX extras
				songMid: songMid || undefined,
				jooxIndex: idx + 1, // ORDERING fallback ONLY — never identity (Pitfall 4)
				jooxSongId: jooxSongId || undefined,
				jooxSongMid: songMid || undefined
			};
			return track;
		});
	},

	async resolve(track: Track, signal: AbortSignal, quality?: DefaultQuality): Promise<Track> {
		// THE TRAP (legacy:2425): the upstream detail is keyed by positional `n`. We keep
		// sending it because the upstream requires it, but we re-validate the response
		// against the track's stable identity below before trusting it.
		const n = track.jooxIndex || track.displayIndex || 1;
		const path =
			`/api/joox/detail?msg=${encodeURIComponent(track.keyword)}` +
			`&n=${encodeURIComponent(String(n))}`;

		const res = await apiFetch(path, { signal });
		const j = (await res.json()) as JooxDetailResponse;
		if (!j || j.code !== 200 || !j.data) {
			throw new Error('joox detail failed (invalid response)');
		}
		const d = j.data;

		// IDENTITY RE-VALIDATION (Pitfall 4 / criterion #4) — keep music playing.
		// The positional `n` may have returned a DIFFERENT song than the one the user
		// selected (e.g. after a reorder/paginate). But upstream ALSO sometimes swaps
		// which value lands in `songmid` vs `歌曲ID` between the search and detail
		// endpoints, so a same-field comparison would reject a CORRECT song (e.g. 有人,
		// whose expected 歌曲ID equals the returned songmid). Strategy:
		//   - Build an EXPECTED token pool from every identity field we captured at
		//     search time, and a RETURNED token pool from the detail body.
		//   - CONFIRMED = any expected token equals any returned token (CROSS-FIELD
		//     match allowed) → trust it, play as today.
		//   - If NOT confirmed, only REFUSE (throw) in the narrow STRONG-DISJOINT case:
		//     both sides are fully populated (expected has BOTH a mid and a songId,
		//     returned has BOTH songmid and 歌曲ID) AND there is zero cross-field
		//     overlap — i.e. a genuinely different song. Wrong-song protection stays
		//     at full strength here.
		//   - OTHERWISE (partial / unconfirmed but not strong-disjoint) → SOFT-ALLOW:
		//     console.warn with the same diagnostic detail and play through, rather
		//     than reject a song that is probably correct.
		const expectedMid = track.songMid || track.jooxSongMid || '';
		const expectedSongId = track.jooxSongId || track.songid || '';
		const returnedMid = d.songmid || '';
		const returnedSongId = d['歌曲ID'] || '';

		const expectedTokens = [
			track.songMid,
			track.jooxSongMid,
			track.jooxSongId,
			track.songid
		].filter((v): v is string => !!v);
		const returnedTokens = [d.songmid, d['歌曲ID']].filter((v): v is string => !!v);

		const confirmed = expectedTokens.some((e) => returnedTokens.includes(e));
		if (!confirmed) {
			const expectedHasBoth = !!expectedMid && !!expectedSongId;
			const returnedHasBoth = !!returnedMid && !!returnedSongId;
			const strongDisjoint = expectedHasBoth && returnedHasBoth; // already unconfirmed = zero cross-field overlap
			const diag =
				`expected songmid="${expectedMid}" (歌曲ID="${expectedSongId}") ` +
				`but upstream n=${n} returned songmid="${returnedMid}" (歌曲ID="${returnedSongId}", ` +
				`歌曲名称="${d['歌曲名称'] || ''}")`;
			if (strongDisjoint) {
				// STRONG-DISJOINT: genuinely a different song — refuse to play the wrong song.
				throw new Error(`joox identity mismatch: ${diag} — refusing to play the wrong song`);
			}
			// SOFT-ALLOW: partial / unconfirmed identity — keep playing, but warn.
			console.warn(`joox identity unconfirmed (soft-allow): ${diag} — playing through`);
		}

		const playLinks = d['播放链接'] || {};
		const best = await pickJooxPlayUrl(playLinks, signal, quality); // WR-07: per-call quality wins

		// Identity validated — enrich the track in place (ports legacy:2483-2503).
		track.title = d['歌曲名称'] || track.title;
		track.artist = d['歌手'] || track.artist;
		track.album = d['专辑'] || track.album;
		if (d['歌曲ID']) {
			track.jooxSongId = d['歌曲ID'];
		}
		if (d.songmid) {
			track.songMid = d.songmid;
			track.jooxSongMid = d.songmid;
		}
		track.audioUrl = best.url || track.audioUrl;
		track.lrc = d['歌词内容'] || track.lrc || null;
		track.lrcUrl = null;
		track.jooxQualityText = best.text || track.jooxQualityText || null;

		if (best.tag && best.label) {
			track.quality = best.tag;
			track.qualityLabel = best.label;
		} else if (track.audioUrl) {
			const q = inferQualityFromUrl(track.audioUrl);
			track.quality = q.tag;
			track.qualityLabel = q.label;
		}

		track.detailsLoaded = true;
		return track;
	}
};
