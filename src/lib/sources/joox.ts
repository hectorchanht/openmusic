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
//     歌曲ID against the track we actually intended to resolve. jooxIndex is ORDERING-only
//     and is never treated as identity.
//   - SELF-HEAL + NEVER-THROW (plan 26-11 / Phase-26 UAT Gap 6): when the fragile `n` maps to
//     a DIFFERENT song, we PREFER the STABLE songmid: issue ONE fresh /api/joox/search, find
//     the intended songmid's CURRENT position, re-fetch detail by that corrected `n`, and
//     re-validate. If it now confirms we play the CORRECT song. If the song is gone from the
//     re-search (or the corrected detail is still disjoint), resolve returns the track
//     UNRESOLVED (audioUrl=null, detailsLoaded=false) WITHOUT adopting the wrong song — it
//     NEVER throws. The graceful null routes into player.play's existing
//     `!resolved.audioUrl → runFallback → skip` path instead of stranding the nowbar with a
//     stuck error. Wrong-song protection is preserved (a genuine mismatch just fails soft).
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
import { pickByQualityPref, effectiveQuality } from './quality';

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
 * `settings.defaultQuality` is probed FIRST.
 * 32-D-02 (supersedes this doc-block's old "'lossless'/'auto' keep the verbatim order"
 * claim): the pref now goes through `effectiveQuality` first, so under the shipped 'auto'
 * default the verbatim lossless-first order survives ONLY on a positively-identified
 * unmetered connection; everywhere else 'auto' becomes '320' and the 320 band leads.
 * Only an explicit 'lossless' still keeps the verbatim order unconditionally.
 * The proxy `JOOX_BR=4` tier-SET selector is left untouched (it just makes all tiers
 * available; keeps proxy.test.ts `br=4` green — A3 / client-ladder approach).
 */
async function pickJooxPlayUrl(
	links: Record<string, string>,
	outerSignal: AbortSignal,
	quality?: DefaultQuality
): Promise<PickedPlayUrl> {
	// WR-07: an explicit per-call quality (download path) wins over the streaming pref.
	// 32-D-02: `effectiveQuality` resolves 'auto' to a CONCRETE tier before the ladder is
	// reordered. Without it a metered connection under the 'auto' default probes Atmos/FLAC
	// first (the pickByQualityPref 'auto' branch is a no-op) — the exact cellular regression.
	const order = pickByQualityPref(JOOX_QUALITY_ORDER, effectiveQuality(quality ?? settings.defaultQuality));
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

// ── JOOX identity self-heal helpers (plan 26-11 / Gap 6) ─────────────────────────────
// The upstream detail endpoint is keyed by a FRAGILE positional `n`; a picked variant's
// stale n can map to a DIFFERENT song after a reorder/paginate. The STABLE identity is the
// songmid (falling back to 歌曲ID). These helpers let resolve() re-locate the intended song
// by its stable identity in ONE fresh search (deriving the correct n) and re-validate the
// cross-field identity — the same joox-swaps-songmid/歌曲ID quirk the initial check handles.

/** Expected identity tokens captured at search time (stable) — songmid preferred, cross-field allowed. */
function jooxExpectedTokens(track: Track): string[] {
	return [track.songMid, track.jooxSongMid, track.jooxSongId, track.songid].filter(
		(v): v is string => !!v
	);
}

/** Identity tokens the DETAIL body carries (songmid + 歌曲ID). */
function jooxReturnedTokens(d: JooxDetailData): string[] {
	return [d.songmid, d['歌曲ID']].filter((v): v is string => !!v);
}

/** Identity tokens a SEARCH row carries — used to locate the corrected n by stable songmid. */
function jooxSearchItemTokens(it: JooxSearchItem): string[] {
	return [it.songmid, it['歌曲ID']].filter((v): v is string => !!v);
}

/** CROSS-FIELD confirm: any expected token equals any returned token (joox-swaps-songmid/歌曲ID quirk). */
function jooxIdentityConfirmed(expectedTokens: string[], returnedTokens: string[]): boolean {
	return expectedTokens.some((e) => returnedTokens.includes(e));
}

/**
 * Fetch + parse ONE /api/joox/search for the keyword, returning songs[] in their CURRENT order
 * (the self-heal reads the current position of the stable songmid to derive the corrected n).
 * NEVER-THROW (unlike the public search(), which throws on drift for the fan-out's typed error):
 * a contract-drift / network / abort failure yields [] so the self-heal degrades to a graceful
 * failed-resolve rather than a throw (return-a-sentinel convention, CLAUDE.md).
 */
async function fetchJooxSearchSongs(
	keyword: string,
	signal: AbortSignal
): Promise<JooxSearchItem[]> {
	try {
		const path = `/api/joox/search?msg=${encodeURIComponent(keyword)}`;
		const res = await apiFetch(path, { signal });
		const json = (await res.json()) as JooxSearchResponse;
		const songs =
			json && json.code === 200 && Array.isArray(json.data?.songs) ? json.data!.songs! : null;
		return songs ?? [];
	} catch {
		return [];
	}
}

/**
 * Fetch + parse /api/joox/detail?msg&n. Returns the detail data, or null on an invalid body
 * (code!=200 / no data). Does NOT swallow apiFetch rejections — an abort/network error still
 * propagates so AbortSignal supersedence is preserved. The initial call re-throws null as the
 * legacy 'joox detail failed' error; the self-heal corrected call treats null as a graceful miss.
 */
async function fetchJooxDetailData(
	keyword: string,
	n: number,
	signal: AbortSignal
): Promise<JooxDetailData | null> {
	const path =
		`/api/joox/detail?msg=${encodeURIComponent(keyword)}` + `&n=${encodeURIComponent(String(n))}`;
	const res = await apiFetch(path, { signal });
	const j = (await res.json()) as JooxDetailResponse;
	if (!j || j.code !== 200 || !j.data) return null;
	return j.data;
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

		const initial = await fetchJooxDetailData(track.keyword, n, signal);
		if (!initial) {
			throw new Error('joox detail failed (invalid response)');
		}

		// IDENTITY RE-VALIDATION (Pitfall 4 / criterion #4) — keep music playing.
		// The positional `n` may have returned a DIFFERENT song than the one the user
		// selected (e.g. after a reorder/paginate). But upstream ALSO sometimes swaps
		// which value lands in `songmid` vs `歌曲ID` between the search and detail
		// endpoints, so a same-field comparison would reject a CORRECT song (e.g. 有人,
		// whose expected 歌曲ID equals the returned songmid). Strategy:
		//   - Build an EXPECTED token pool from every identity field we captured at
		//     search time, and a RETURNED token pool from the detail body.
		//   - CONFIRMED = any expected token equals any returned token (CROSS-FIELD
		//     match allowed) → trust it, play as today (fast path, NO re-search).
		//   - If NOT confirmed and NOT strong-disjoint (partial identity) → SOFT-ALLOW:
		//     console.warn and play through, rather than reject a probably-correct song.
		//   - If NOT confirmed and STRONG-DISJOINT (both sides fully populated, zero
		//     cross-field overlap = genuinely a different song) → SELF-HEAL by the
		//     stable songmid (plan 26-11), then GRACEFUL never-throw fail on an
		//     unrecoverable mismatch. Wrong-song protection stays at full strength.
		const expectedTokens = jooxExpectedTokens(track);

		// The detail body we ultimately trust + enrich from (initial / soft-allowed / self-healed).
		let finalDetail: JooxDetailData | null = null;

		if (jooxIdentityConfirmed(expectedTokens, jooxReturnedTokens(initial))) {
			// CONFIRMED fast path — the n mapped correctly (cross-field allowed). No re-search.
			finalDetail = initial;
		} else {
			const expectedMid = track.songMid || track.jooxSongMid || '';
			const expectedSongId = track.jooxSongId || track.songid || '';
			const returnedMid = initial.songmid || '';
			const returnedSongId = initial['歌曲ID'] || '';
			const expectedHasBoth = !!expectedMid && !!expectedSongId;
			const returnedHasBoth = !!returnedMid && !!returnedSongId;
			const strongDisjoint = expectedHasBoth && returnedHasBoth; // unconfirmed + both populated = different song
			const diag =
				`expected songmid="${expectedMid}" (歌曲ID="${expectedSongId}") ` +
				`but upstream n=${n} returned songmid="${returnedMid}" (歌曲ID="${returnedSongId}", ` +
				`歌曲名称="${initial['歌曲名称'] || ''}")`;

			if (!strongDisjoint) {
				// SOFT-ALLOW: partial / unconfirmed identity — keep playing, but warn (unchanged).
				console.warn(`joox identity unconfirmed (soft-allow): ${diag} — playing through`);
				finalDetail = initial;
			} else {
				// SELF-HEAL (plan 26-11 / Gap 6): the fragile n mapped to a genuinely DIFFERENT song.
				// PREFER the stable songmid: re-locate the intended song in ONE fresh search, derive
				// the corrected n, re-fetch detail, and re-validate. BOUNDED — at most one extra search
				// + one extra detail, runs only on this disjoint branch, no recursion (T-26-11-03).
				const songs = await fetchJooxSearchSongs(track.keyword, signal);
				const idx = songs.findIndex((it) =>
					jooxSearchItemTokens(it).some((tok) => expectedTokens.includes(tok))
				);
				const correctedN = idx >= 0 ? idx + 1 : null;

				// Only re-fetch when we located the song at a DIFFERENT position (a same n carries no
				// new information — it would return the same wrong song).
				if (correctedN !== null && correctedN !== n) {
					const corrected = await fetchJooxDetailData(track.keyword, correctedN, signal);
					if (corrected && jooxIdentityConfirmed(expectedTokens, jooxReturnedTokens(corrected))) {
						// Self-healed: the corrected n now maps to the intended song — play the CORRECT song.
						finalDetail = corrected;
					}
				}

				if (!finalDetail) {
					// UNRECOVERABLE (song gone from the re-search, corrected detail still disjoint, or
					// correctedN == n / no new info): return the track UNRESOLVED (audioUrl=null,
					// detailsLoaded=false) WITHOUT adopting any wrong-song field — NEVER throw. This is
					// the failed-resolve sentinel player.play's `!resolved.audioUrl → runFallback → skip`
					// path consumes (T-26-11-02). Wrong-song protection preserved (never enriched).
					console.warn(
						`joox identity mismatch (self-heal failed): ${diag}; ` +
							`re-search correctedN=${correctedN ?? 'not found'} — leaving track unresolved (fail soft)`
					);
					track.audioUrl = null;
					track.detailsLoaded = false;
					return track;
				}
			}
		}

		const d = finalDetail;
		const playLinks = d['播放链接'] || {};
		const best = await pickJooxPlayUrl(playLinks, signal, quality); // WR-07: per-call quality wins

		// Identity validated / self-healed — enrich the track in place (ports legacy:2483-2503).
		// quick-260712-4xg: prefer the existing (picked/search) title so a VersionPicker selection
		// keeps the version's name in now-playing; fall back to the detail name only for a
		// title-less stub. Matches netease.resolve (no title overwrite).
		track.title = track.title || d['歌曲名称'] || '';
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
