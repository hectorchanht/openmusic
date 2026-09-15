// YouTube Music client adapter (Plan 27, YT-SRC-01 / YT-SEARCH-01) — a FULLY ANONYMOUS source.
//
// ZERO auth: no account, OAuth, device flow, cookie, or user token is created or referenced here or
// anywhere in Plan 27. Account/library sync is a separate, later, legal-gated milestone (spike 008);
// if a change here ever tempts adding auth "while we're here", STOP — it is explicitly out of scope.
//
// On WEB the closest analog is audius.ts: the playable stream URL is DETERMINISTIC from the videoId,
// so resolve() has NO client-side JSON hop — it just stamps the own-origin /api/ytmusic/stream/{videoId}
// path and the bytes are edge-proxied (Capacitor/CORS-safe, exactly like the audius <audio>.src note).
//
// On NATIVE (quick-260915-3ng) the DEVICE resolves the real googlevideo URL itself, via the two
// InnerTube hops in ../services/ytmusic-native.ts. googlevideo FULL-IP-locks that URL to whoever
// called `player`, so the edge proxy — which calls player and then fetches the bytes from the same
// datacenter IP — is refused with 403 in production, while the identical chain from a residential IP
// serves 206. A browser cannot make the player call at all (InnerTube sends no CORS headers), so this
// stays native-only; CapacitorHttp bypasses the WebView's CORS and lets us set origin/user-agent, and
// <audio src> plays the returned URL directly because media elements perform no CORS check.
// A null from the native resolver falls back to the proxy path — behaviour degrades to today's, never
// worse. ZERO auth on both paths (anonymous visitorData only).
//
// search() parses the proxied InnerTube WEB_REMIX envelope CLIENT-side (testable per conventions —
// see ytmusic.test.ts + the captured __fixtures__/ytmusic-search.json). The parse is a direct port of
// spike 005's harness.mjs (extractRows / rowToStub / firstRun / allRuns / bestThumb), re-typed over
// optional-chained interfaces (untrusted JSON, NO `as any`). The thin edge proxy that performs the
// InnerTube POST lands in Plan 27-02; the stream byte-proxy in Plan 27-03; resolve()'s best-effort
// plain-lyrics fetch + the registry-flag failover exclusion in Plan 27-04.

import type { SourceAdapter, Track } from './types';
import { makeUid } from './types';
import { apiFetch, apiUrl } from '../services/api-base';
import { Capacitor } from '@capacitor/core';
import { nativeResolveStreamUrl } from '../services/ytmusic-native';

// --- InnerTube search-envelope shapes (untrusted, deeply/inconsistently nested; every field
// optional and accessed via optional chaining — the drift guard in search() throws when the
// expected shelf is absent so the fan-out's allSettled records a typed per-source error). ---
interface YtRun {
	text?: string;
	navigationEndpoint?: {
		watchEndpoint?: { videoId?: string };
		browseEndpoint?: {
			browseEndpointContextSupportedConfigs?: {
				browseEndpointContextMusicConfig?: { pageType?: string };
			};
		};
	};
}
interface YtFlexColumn {
	musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: YtRun[] } };
}
interface YtThumbnail {
	url?: string;
	width?: number;
	height?: number;
}
interface YtThumbnailWrap {
	musicThumbnailRenderer?: { thumbnail?: { thumbnails?: YtThumbnail[] } };
}
interface YtRow {
	overlay?: {
		musicItemThumbnailOverlayRenderer?: {
			content?: {
				musicPlayButtonRenderer?: {
					playNavigationEndpoint?: { watchEndpoint?: { videoId?: string } };
				};
			};
		};
	};
	playlistItemData?: { videoId?: string };
	thumbnail?: YtThumbnailWrap;
	thumbnailRenderer?: YtThumbnailWrap;
	flexColumns?: YtFlexColumn[];
}
interface YtShelf {
	contents?: Array<{ musicResponsiveListItemRenderer?: YtRow }>;
}

// --- InnerTube lyrics-route payload (Plan 27-02 `/api/ytmusic/lyrics` → `{ text, attribution }`).
// Both optional: a lyric miss / no-lyrics track returns `{}` and resolve() leaves track.lrc null
// (best-effort — see the two-tier lyric note in resolve()). Untrusted, so every field is optional. ---
interface YtLyricsResponse {
	text?: string;
	attribution?: string;
}

// --- tiny deep-walk helpers (ported from spike 005 harness.mjs) ---
function firstRun(col: YtFlexColumn | undefined): string {
	return col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ?? '';
}
function allRuns(col: YtFlexColumn | undefined): YtRun[] {
	return col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
}
function bestThumb(row: YtRow): string | null {
	// YTM cover URLs are resizable via =w{n}-h{n}; take the largest listed (we can upscale later).
	const thumbs =
		row.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
		row.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ??
		[];
	if (!thumbs.length) return null;
	return thumbs[thumbs.length - 1]?.url ?? null;
}

/** videoId lives in the play-button overlay (songs); fall back to the row's playlistItemData, then
 *  the title column's watch navigationEndpoint. Null when no id is resolvable → the row is skipped. */
function extractVideoId(row: YtRow): string | null {
	return (
		row.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
			?.playNavigationEndpoint?.watchEndpoint?.videoId ??
		row.playlistItemData?.videoId ??
		row.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]
			?.navigationEndpoint?.watchEndpoint?.videoId ??
		null
	);
}

/** One row → a Track stub, or null when it carries no resolvable videoId (never emit a null-uid
 *  Track). `emitIndex` is the position among EMITTED tracks so displayIndex stays gap-free even when
 *  earlier rows were skipped. */
function rowToTrack(row: YtRow, keyword: string, emitIndex: number): Track | null {
	const videoId = extractVideoId(row);
	if (!videoId) return null;

	const cols = row.flexColumns ?? [];
	const title = firstRun(cols[0]);
	// Second column is a mixed run list: "Artist • Album • 3:45". Disambiguate each run by its
	// browseEndpoint pageType (ARTIST vs ALBUM); an m:ss run is the duration; the first plain text
	// run is the artist fallback (spike 005 heuristic).
	let artist = '';
	let album = '';
	let durationText = '';
	for (const r of allRuns(cols[1])) {
		const t = (r?.text ?? '').trim();
		if (!t || t === '•') continue;
		const pageType =
			r?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
				?.browseEndpointContextMusicConfig?.pageType ?? '';
		if (/^\d+:\d{2}$/.test(t)) durationText = t;
		else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM') album = t;
		else if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' && !artist) artist = t;
		else if (!artist && !/^\d/.test(t)) artist = t; // fallback: first non-numeric text run
	}

	const track: Track = {
		uid: makeUid('ytmusic', videoId),
		source: 'ytmusic',
		songid: videoId, // songid = videoId (27-CONTEXT, D-10)
		title,
		artist,
		album,
		cover: bestThumb(row),
		audioUrl: null, // stamped deterministically in resolve()
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword,
		displayIndex: emitIndex + 1
	};
	if (durationText) {
		const [m, s] = durationText.split(':');
		const secs = Number(m) * 60 + Number(s);
		if (Number.isFinite(secs)) track.duration = secs;
	}
	return track;
}

/** Walk the (deeply/inconsistently nested) InnerTube envelope, collect every musicShelfRenderer's
 *  rows, and map them to Track stubs. Throws a typed contract-drift error when the body is not an
 *  object or contains NO search shelf (YTM fuzzy-matches, so a live search never returns an
 *  empty/shelf-less body — a missing shelf is genuine drift, not "no results"). */
function parseSearchEnvelope(json: unknown, keyword: string): Track[] {
	if (!json || typeof json !== 'object') {
		throw new Error('ytmusic: contract-drift (expected search shelf)');
	}
	const rows: YtRow[] = [];
	let sawShelf = false;
	const walk = (node: unknown): void => {
		if (!node || typeof node !== 'object') return;
		const obj = node as Record<string, unknown>;
		if (obj.musicShelfRenderer && typeof obj.musicShelfRenderer === 'object') {
			sawShelf = true;
			const shelf = obj.musicShelfRenderer as YtShelf;
			for (const c of shelf.contents ?? []) {
				const row = c?.musicResponsiveListItemRenderer;
				if (row) rows.push(row);
			}
		}
		for (const k of Object.keys(obj)) walk(obj[k]);
	};
	walk(json);
	if (!sawShelf) {
		throw new Error('ytmusic: contract-drift (expected search shelf)');
	}

	const tracks: Track[] = [];
	// quick-260715-jdj: the search route now merges the Songs + Videos shelves
	// (`{ ytmusicMerged: [songsJson, videosJson] }`) so video-only uploads surface too. A track can
	// appear in BOTH shelves; dedupe by videoId (== songid) so it emits once. The songs shelf is
	// walked FIRST (route puts songsJson before videosJson), so its catalog variant wins the slot.
	const emitted = new Set<string>();
	for (const row of rows) {
		const track = rowToTrack(row, keyword, tracks.length);
		if (!track) continue;
		if (emitted.has(track.songid)) continue;
		emitted.add(track.songid);
		tracks.push(track);
	}
	return tracks;
}

export const ytmusic: SourceAdapter = {
	id: 'ytmusic',
	label: 'YouTube Music',
	// Discoverable in the normal search fan-out (an extra Promise.allSettled source can never break
	// the existing ones — a ytmusic failure is isolated to its own settled slot).
	enabledByDefault: true,
	// OFF the kuwo-first auto-resolve floor (27-CONTEXT): searchable + explicit-pick only, NEVER a
	// cross-source-failover target for a non-ytmusic track. See the SourceAdapter.autoResolveEligible
	// doc; the failover / name-stub code that honors this flag lands in Plan 27-04.
	autoResolveEligible: false,

	async search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]> {
		// Single song shelf, no reliable pagination (the audius rule) — page>1 is a no-op with no
		// upstream call.
		if ((page || 1) > 1) return [];
		// JSON hop through the governor (apiFetch): the own-origin proxy does the InnerTube POSTs
		// (WEB_REMIX ctx + Songs & Videos params + public key, all edge-side — Plan 27-02) and returns
		// a merged `{ ytmusicMerged: [...] }` envelope (quick-260715-jdj); the recursive parse +
		// cross-shelf dedupe stays client-side + unit-tested.
		const path = '/api/ytmusic/search?q=' + encodeURIComponent(keyword);
		const res = await apiFetch(path, { signal });
		const json: unknown = await res.json();
		// quick-260715-l9p (revert): ranking is owned by scoreMatch at the SEARCH PAGE (rankList in
		// search/+page.svelte), NOT the adapter. The l9p adapter-level scoreMatch re-rank was DEAD
		// CODE — the search page re-sorts EVERY source's results by scoreMatch, discarding each
		// adapter's returned array order — so an adapter-level sort here changed nothing on screen.
		// The real CJK-substring ranking fix lives in score-match.ts similarity() (the shared, load-
		// bearing authority every source's search list flows through). The adapter returns the parsed
		// + videoId-deduped rows in shelf order (songs before videos); displayIndex stays the emit
		// order — Pitfall 4: displayIndex is ORDERING only, the search page re-ranks for display.
		return parseSearchEnvelope(json, keyword);
	},

	async resolve(track: Track, signal: AbortSignal): Promise<Track> {
		if (!track.songid) throw new Error('ytmusic: missing videoId on resolve');
		// STREAM URL. WEB: deterministic from the videoId (the audius pattern) — no JSON hop, no await
		// before the stamp, just the own-origin /api/ytmusic/stream/{videoId} byte-proxy (Plan 27-03).
		// NATIVE: the device resolves the real googlevideo URL first (quick-260915-3ng — the edge cannot,
		// see the header note); a null result falls straight through to the same proxy stamp, and a throw
		// is caught for the same reason (the resolver is never-throw by contract, this is belt+braces).
		// apiUrl returns an ABSOLUTE url unchanged (32-D-13), so the fallback line is correct on both
		// builds and api-base needs no change.
		// No new TTL is needed: hasFreshAudioUrl re-trusts a url for RESOLVE_URL_TTL_S (15 min) and a
		// googlevideo url lives ~6h, so the existing guard always re-resolves well inside the window.
		let direct: string | null = null;
		if (Capacitor.isNativePlatform()) {
			direct = await nativeResolveStreamUrl(track.songid, signal).catch(() => null);
		}
		track.audioUrl = direct ?? apiUrl('/api/ytmusic/stream/' + encodeURIComponent(track.songid));
		// itag 140 = 128 kbps AAC/mp4 (spike 006 — the iOS-Safari-safe format, NOT Opus/webm itag 251).
		// Neither the proxy path nor the googlevideo url carries a file extension, so
		// inferQualityFromUrl would MISLABEL both 320K — stamp the true AAC-128 tier directly instead.
		track.quality = '128k';
		track.qualityLabel = '128k AAC';
		track.detailsLoaded = true;

		// TWO-TIER LYRICS (spike 007). Tier 1 = PLAIN lyrics from InnerTube next→browse, fetched here
		// best-effort via the own-origin /api/ytmusic/lyrics route (Plan 27-02). Tier 2 = TIMED LRC via
		// the app's EXISTING crossSourceLyric(name,artist) fallback, which ensureTrackDetails fires
		// automatically for any playable track that still has no lrc (ytmusic is deliberately NOT in
		// catalog's LYRICLESS_SOURCES — it HAS plain lyrics). This fetch is a NEVER-THROW boundary: any
		// failure (network, abort, contract drift, empty text) is swallowed so track.lrc stays null and
		// the timed fallback takes over — a lyrics miss must never fail or delay playback (the stream
		// audioUrl is already stamped above). We do NOT fetch the stream here (no bytes in resolve), and
		// never set lrcUrl (YTM exposes no separate timed-lyric URL — the netease lrcUrl re-resolve path
		// must not arm). The AbortSignal is threaded so a superseded resolve bails without throwing.
		try {
			const res = await apiFetch(
				'/api/ytmusic/lyrics?videoId=' + encodeURIComponent(track.songid),
				{ signal }
			);
			// { text, attribution }. attribution (Musixmatch/LyricFind) is display-only; Track carries no
			// attribution field yet, so we surface the plain text only — parseLRC degrades gracefully on
			// timestamp-less lines (spike 007). Store only a non-empty text; empty/whitespace → tier 2.
			const data = (await res.json()) as YtLyricsResponse | null;
			const text = data?.text;
			if (typeof text === 'string' && text.trim()) track.lrc = text;
		} catch {
			/* best-effort: leave track.lrc null → the existing crossSourceLyric timed fallback fills it */
		}
		return track;
	}
};
