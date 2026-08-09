// Server-side kuwo resolve for the /api/resolve edge cache (phase 31, 31-D-06 / 31-D-10).
//
// WHY THIS FILE EXISTS — the anti-poisoning property of the whole feature. The cached entry is
// keyed on normalized TEXT and is SHARED by every requester in the PoP (31-D-10), so the audio
// URL inside it MUST be derived server-side from the upstream source. If a client could POST a
// URL, one crafted request would change what everyone else in that data center plays — the same
// reasoning `/api/og` already records for its shared, text-keyed resolve entry (T-3uo-03).
// The cost of that guarantee is this small server-side mirror of the kuwo search+detail
// contract. There is deliberately NO client write path anywhere in the route (T-31-03-03).
//
// WHY KUWO ONLY: it is auth-free (no `env`, so no secret is in scope on this route), it is the
// kuwo-first head of the resolve order the app already uses, and it is reachable from the edge.
//
// BOUNDS (T-31-03-06) — this is a background fill, not the user's hot path: `limit=10` on the
// search, `retries=1` on both calls, at most TWO subrequests, and no second source is walked.
//
// Same `+server.ts`-may-only-export-verbs reason as resolve-cache.ts for living in $lib.
import { kuwoProxy } from './kuwo';
import { fetchWithRetry } from './http';
import { matchKey } from '$lib/services/match-key';
import type { ResolveEntry } from './resolve-cache';

/** Rows to ask kuwo for. Enough to survive a couple of near-duplicate hits, small enough to stay cheap. */
const SEARCH_LIMIT = '10';

/** Extra attempts after the first, for BOTH calls. A background fill does not deserve a long backoff. */
const RETRIES = 1;

/** The clean "kuwo searched and this song is not there" negative — D-06(c). The caller CACHES this. */
const DRY: ResolveEntry = { source: null, songid: null, url: null, avail: { kuwo: 'dry' } };

interface KuwoSearchRow {
	rid?: string | number;
	name?: string;
	artist?: string;
}

/**
 * Resolve `artist`/`title` into a cacheable entry using kuwo alone.
 *
 * Returns an `ok` entry on a hit, the `dry` entry on a CLEAN no-match (the caller caches it), and
 * `null` on any FAULT — network error, non-ok response, contract drift, malformed JSON, a falsy
 * detail url, or an abort. A fault must be retried on the next request, NOT pinned for the whole
 * TTL, so the caller writes nothing when this returns null (T-31-03-08).
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

		// kuwoProxy.buildUrl keeps the upstream host and param shape defined in exactly ONE place.
		// The fetch itself goes through fetchWithRetry (http.ts), which already carries the raw-fetch
		// audit comment. This file deliberately contains ZERO references to the CLIENT fetch seam in
		// $lib/services/api-base — that governor is browser-side and must not run edge-side.
		const searchUrl = kuwoProxy.buildUrl(
			'search',
			new URLSearchParams({ name: query, page: '1', limit: SEARCH_LIMIT }),
			undefined
		);
		const searchRes = await fetchWithRetry(searchUrl, { signal }, RETRIES);
		if (signal.aborted) return null; // supersedence re-check after every await
		if (!searchRes.ok) return null;

		const searchBody = (await searchRes.json()) as { code?: number; data?: unknown } | null;
		if (signal.aborted) return null;
		// Contract drift mirrors src/lib/sources/kuwo.ts's THROW, converted to a null sentinel here.
		if (!searchBody || searchBody.code !== 200 || !Array.isArray(searchBody.data)) return null;

		// matchKey — never a local lowercase/strip — so the edge normalizes IDENTICALLY to the
		// client's dedupe, cover cache and lyric fallback, and to resolveCacheKey's key folding.
		const want = matchKey(artist, title);
		const row = (searchBody.data as KuwoSearchRow[]).find(
			(r) => matchKey(String(r?.artist ?? ''), String(r?.name ?? '')) === want
		);
		const rid = row?.rid;
		// A clean "not here" — genuinely negative, so the caller caches it and the repeat costs zero.
		if (rid === undefined || rid === null || rid === '') return DRY;

		const detailUrl = kuwoProxy.buildUrl(
			'detail',
			new URLSearchParams({ id: String(rid), level: 'zp' }),
			undefined
		);
		const detailRes = await fetchWithRetry(detailUrl, { signal }, RETRIES);
		if (signal.aborted) return null;
		if (!detailRes.ok) return null;

		const detailBody = (await detailRes.json()) as
			| { code?: number; data?: { url?: string } }
			| null;
		if (signal.aborted) return null;
		if (!detailBody || detailBody.code !== 200 || !detailBody.data?.url) return null;

		return {
			source: 'kuwo',
			songid: String(rid),
			url: detailBody.data.url,
			avail: { kuwo: 'ok' }
		};
	} catch {
		// Any throw (network, abort, malformed JSON, an unsupported buildUrl path) is a FAULT.
		return null;
	}
}
