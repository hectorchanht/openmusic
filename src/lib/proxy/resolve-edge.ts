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
import type { ResolveEntry } from './resolve-cache';

/** Extra attempts after the first. A background fill does not deserve a long backoff. */
const RETRIES = 1;

/**
 * The clean "qq searched and this song is not there" negative — D-06(c). The caller CACHES this,
 * at the SHORT TTL (32-D-10a): a flaky 0-row qq search is byte-indistinguishable from a genuine
 * miss here, so the protection lives in the write's max-age, never in a reclassification.
 */
const DRY: ResolveEntry = { source: null, songid: null, avail: { qq: 'dry' } };

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

		// 32-D-10: the mid IS the payload. No detail call — the entry deliberately stores no url,
		// which is the only reason it can be written permanent.
		return {
			source: 'qq',
			songid: String(mid),
			avail: { qq: 'ok' }
		};
	} catch {
		// Any throw (network, abort, malformed JSON, an unsupported buildUrl path) is a FAULT.
		return null;
	}
}
