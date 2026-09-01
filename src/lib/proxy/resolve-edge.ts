// Server-side qq resolve for the /api/resolve edge cache (phase 31 31-D-06 / 31-D-10, retargeted
// kuwo → qq by 32-D-01 / 32-D-10).
//
// WHY THIS FILE EXISTS — the anti-poisoning property of the whole feature. The cached entry is
// keyed on normalized TEXT and is SHARED by every requester in the PoP (31-D-10), so the payload
// inside it MUST be derived server-side from the upstream source. If a client could POST a mid,
// one crafted request would change what everyone else in that data center plays — the same
// reasoning `/api/og` already records for its shared, text-keyed resolve entry (T-3uo-03).
// The cost of that guarantee is this small server-side mirror of the qq search contract.
// There is deliberately NO client write path anywhere in the route (T-31-03-03).
//
// WHY KUWO ONLY (Phase 31, superseded — kept because it records what changed and why): kuwo is
// auth-free (no `env`, so no secret is in scope on this route), it is the kuwo-first head of the
// resolve order the app already uses, and it is reachable from the edge.
//
// WHY QQ NOW (32-D-01) — a DELIBERATE supersession of `Skill("spike-findings-openmusic")`'s
// kuwo-first resolution rule, not an oversight:
//  - kuwo tops out at 320k mp3, so "kuwo-first" and "lossless-first" are mutually exclusive. This
//    phase exists to serve lossless, so the head of the resolve order has to be qq (tang).
//  - qq is likewise auth-free (`qqProxy.buildUrl` takes no `env`), so the no-secret-in-scope
//    property of this route is unchanged.
//  - the recorded qq flakiness is in SEARCH, not DETAIL: it intermittently returns 0 rows under
//    load with no throw. That is exactly the input this file turns into a NEGATIVE entry, and
//    32-D-10a caps a negative at RESOLVE_TTL_S (900s) with the POST bust retained — so the worst
//    case of the known flakiness is 15 minutes of lossy playback for one song in one PoP, never
//    permanent damage.
//  - the kuwo/netease/joox ladder survives untouched as the FAILURE path (32-D-01, second
//    sentence): a tang outage must degrade quality, never break playback.
//
// BOUNDS (T-31-03-06) — this is a background fill, not the user's hot path: `retries=1`, and under
// 32-D-10 exactly ONE subrequest (the search), because `song_mid` is on every qq search row and
// the kuwo detail call it replaced is gone. No second source is walked. The tang endpoint takes no
// row-limit param, so the Phase-31 `limit=10` bound has no qq equivalent and was dropped rather
// than faked; the body is a short list and the scan below is O(rows) over it.
//
// Same `+server.ts`-may-only-export-verbs reason as resolve-cache.ts for living in $lib.
import { qqProxy } from './qq';
import { fetchWithRetry } from './http';
import { matchKey } from '$lib/services/match-key';
import { RESOLVE_URL_TTL_S, type ResolveEntry } from './resolve-cache';

/** Extra attempts after the first. A background fill does not deserve a long backoff. */
const RETRIES = 1;

/**
 * The clean "qq searched and this song is not there" negative — D-06(c). The caller CACHES this,
 * at the SHORT TTL (32-D-10a): a flaky 0-row qq search is byte-indistinguishable from a genuine
 * miss here, so the protection lives in the write's max-age, never in a reclassification.
 */
const DRY: ResolveEntry = {
	source: null,
	songid: null,
	avail: { qq: 'dry' },
	// 32-D-20: the SEARCH fill never produces a url — resolveUrlOnEdge does, on the route's
	// refresh-on-read. That is what keeps this fill at exactly ONE subrequest.
	url: null,
	urlExp: null,
	urlQuality: null
};

/** The three qq search-row fields this file reads (mirrors src/lib/sources/qq.ts's QQSearchItem). */
interface QQSearchRow {
	song_mid?: string;
	song_title?: string;
	singer_name?: string;
}

/**
 * Resolve `artist`/`title` into a cacheable entry using qq alone.
 *
 * Returns an `ok` entry carrying the PERMANENT `song_mid` on a hit, the `dry` entry on a CLEAN
 * no-match (the caller caches it), and `null` on any FAULT — network error, non-ok response,
 * contract drift, malformed JSON, or an abort. A fault must be retried on the next request, NOT
 * pinned (T-31-03-08), so the caller writes nothing when this returns null.
 *
 * NEVER-THROWS at the exported boundary (the house never-throw-service posture).
 */
export async function resolveOnEdge(
	artist: string,
	title: string,
	signal: AbortSignal
): Promise<ResolveEntry | null> {
	try {
		const query = `${artist} ${title}`.trim();
		if (!query || signal.aborted) return null;

		// qqProxy.buildUrl keeps the upstream host and param shape defined in exactly ONE place.
		// The fetch itself goes through fetchWithRetry (http.ts), which already carries the raw-fetch
		// audit comment. This file deliberately contains ZERO references to the CLIENT fetch seam in
		// $lib/services/api-base — that governor is browser-side and must not run edge-side.
		const searchUrl = qqProxy.buildUrl('search', new URLSearchParams({ msg: query }), undefined);
		const searchRes = await fetchWithRetry(searchUrl, { signal }, RETRIES);
		if (signal.aborted) return null; // supersedence re-check after every await
		if (!searchRes.ok) return null;

		const searchBody = (await searchRes.json()) as unknown;
		if (signal.aborted) return null;
		// 兼容: bare array OR { data: [...] } — the SAME tolerance as sources/qq.ts:158-169, whose
		// contract-drift THROW is converted to a null sentinel here.
		const rows = Array.isArray(searchBody)
			? searchBody
			: Array.isArray((searchBody as { data?: unknown })?.data)
				? (searchBody as { data: unknown[] }).data
				: null;
		if (rows === null) return null;

		// matchKey — never a local lowercase/strip — so the edge normalizes IDENTICALLY to the
		// client's dedupe, cover cache and lyric fallback, and to resolveCacheKey's key folding.
		const want = matchKey(artist, title);
		const row = (rows as QQSearchRow[]).find(
			(r) => matchKey(String(r?.singer_name ?? ''), String(r?.song_title ?? '')) === want
		);
		const mid = row?.song_mid;
		// A clean "not here" — genuinely negative, so the caller caches it and the repeat costs zero.
		// A matching row WITHOUT a song_mid lands here too: there is no identifier to cache, and qq
		// itself cannot play such a row (sources/qq.ts skips mid-less rows outright).
		if (!mid) return DRY;

		// 32-D-10: the mid IS the payload of THIS call. No detail call here — that is what keeps the
		// fill at one subrequest, and the mid is what lets the entry be written permanent.
		// 32-D-20: the url fields are filled LATER and SEPARATELY by resolveUrlOnEdge, scheduled by
		// the route when it serves a hit whose url is absent or stale. Adding a detail call here
		// instead would double the cost of every miss to warm a url nobody has asked for yet.
		return {
			source: 'qq',
			songid: String(mid),
			avail: { qq: 'ok' },
			url: null,
			urlExp: null,
			urlQuality: null
		};
	} catch {
		// Any throw (network, abort, malformed JSON, an unsupported buildUrl path) is a FAULT.
		return null;
	}
}


/**
 * The tang detail fields this file reads. A SUBSET of sources/qq.ts's QQDetailItem — deliberately
 * only the rungs the lossless walk below may pick, so an added upstream field cannot silently
 * become a served url.
 */
interface QQDetailRungs {
	song_mid?: string | null;
	song_play_url_sq?: string | null;
	song_play_url_pq?: string | null;
	song_play_url_hq?: string | null;
	song_play_url_standard?: string | null;
	song_play_url_fq?: string | null;
}

/**
 * The LOSSLESS ladder, edge-side. A DELIBERATE SMALL MIRROR of `sources/qq.ts` `pickBestPlayUrl`'s
 * lossless slice, which stays the CLIENT authority — if that ladder changes, change this too.
 *
 * Why mirror instead of import (design decision 6, and the same accepted cost this file's header
 * already records for the qq SEARCH contract): `sources/qq.ts` imports the settings runes store and
 * the client `apiFetch` governor, both browser-side. This file's standing rule is that it contains
 * ZERO references to the client fetch seam, because that governor must never run edge-side.
 *
 * TWO DELIBERATE EXCLUSIONS vs the client ladder:
 *  - `song_play_url_accom` (32-D-18) — 伴奏, the accompaniment/instrumental MIX, served as `.ogg`
 *    which iOS Safari's `<audio>` cannot decode. A shared cached url must never be a karaoke take.
 *  - the bare `song_play_url` fallback — its tier is UNKNOWN, and this url is tier-TAGGED
 *    (`urlQuality`), so it cannot honestly be published as the lossless tier.
 * Both exclusions only cost a cache MISS on that song: the client's own ladder still reaches them
 * through the ordinary mid path.
 */
const LOSSLESS_RUNGS: (keyof QQDetailRungs)[] = [
	'song_play_url_sq',
	'song_play_url_pq',
	'song_play_url_hq',
	'song_play_url_standard',
	'song_play_url_fq'
];

/**
 * 32-D-20 — the ONE server-side producer of the entry's `url`. Given a mid already in hand, ONE
 * tang detail subrequest (32-D-09: `mid` alone, no `msg`) becomes a playable, https-only url plus
 * the epoch it stops being trusted.
 *
 * This lives edge-side for the same anti-poisoning reason as `resolveOnEdge` (T-31-03-03): the
 * entry is shared, text-keyed PoP data, so a client-supplied url would change what everyone else
 * plays. There is still deliberately NO client write path anywhere in the route.
 *
 * NEVER-THROWS: a network error, a non-ok response, malformed JSON, an abort, the all-null-200
 * "bad mid" body, or a body with no populated rung all return null, and the caller then writes
 * NOTHING — a fault is retried on the next read rather than pinned (the fill's FAULT rule).
 */
export async function resolveUrlOnEdge(
	mid: string,
	signal: AbortSignal
): Promise<Pick<ResolveEntry, 'url' | 'urlExp' | 'urlQuality'> | null> {
	try {
		const id = (mid ?? '').trim();
		if (!id || signal.aborted) return null;

		// buildUrl already pins `type=json` and the tang host; `mid` is what switches the upstream
		// from a search list to a single-song detail object. No `msg` — 32-D-09 verified the
		// endpoint ignores it.
		const url = qqProxy.buildUrl('detail', new URLSearchParams({ mid: id }), undefined);
		const res = await fetchWithRetry(url, { signal }, RETRIES);
		if (signal.aborted) return null; // supersedence re-check after every await
		if (!res.ok) return null;

		const d = (await res.json()) as QQDetailRungs | null;
		if (signal.aborted) return null;
		// LIVENESS GUARD, never `res.ok`: tang answers an unknown mid with a 200 whose every field
		// is null. `song_mid` is the field that proves the body describes a real song.
		if (!d?.song_mid) return null;

		const raw = LOSSLESS_RUNGS.map((k) => d[k]).find((v) => typeof v === 'string' && v);
		if (!raw) return null;

		return {
			// 32-D-05: tang returns `http://isure6.stream.qqmusic.qq.com/...`, mixed-content-BLOCKED
			// on our https origin; the same host serves https correctly.
			url: raw.replace(/^http:\/\//i, 'https://'),
			urlExp: Date.now() + RESOLVE_URL_TTL_S * 1000,
			// Tier-TAGGED so the client can refuse a url its caller did not ask for. 'lossless' is
			// what this ladder resolves the lossless preference to, exactly as the client's does.
			urlQuality: 'lossless'
		};
	} catch {
		return null;
	}
}
