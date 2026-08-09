// og-cover — the bounded, tiered cover resolve chain behind /api/og (OG-EP-01).
//
// WHY THIS MODULE EXISTS (same reason as deezer-cover.ts): a SvelteKit `+server.ts` may export
// ONLY HTTP verbs. A top-level non-verb export 500s at REQUEST time ("Invalid export") and unit
// tests miss it because they import the module directly (project finding
// `svelte-server-endpoint-only-verb-exports`). Keeping the chain here is what makes OG-EP-01
// unit-testable at all, and it keeps src/routes/api/og/+server.ts verb-only.
//
// WHAT IT IS FOR: a share link now carries NO cover (`?c=` is gone — the whole point of phase 30),
// so `og:image` points at our own `/api/og?type=&artist=&title=` and the cover is re-resolved
// server-side from TEXT. A crawler is waiting on that request, so the chain is bounded hard:
// tiers run SEQUENTIALLY under ONE overall deadline, every tier is never-throw, and the worst
// case is 5 resolve subrequests + 1 image fetch = 6 (3 tiers + Fallback A original-terms +
// Fallback B title-only, quick-260807-vl1) — comfortably inside the 50-subrequest limit.
//
// TIERS: Last.fm (song only, key-gated) → Deezer → iTunes → kuwo. The CN tier is kuwo ONLY — never
// the catalog's multi-source search fan-out (`spike-findings-openmusic`, kuwo-first resolution): a
// fan-out at the edge would risk the exact crawl timeout this endpoint exists to avoid. A Deezer hit
// therefore costs exactly ONE subrequest, and so does a Last.fm hit.
//
// quick-260809-38i — WHY LAST.FM, AND WHY FIRST: the in-app hero adopts Last.fm album art (the
// client's album.getInfo candidate, promoted through player.adoptCover), but this chain had no
// Last.fm tier, so the messenger card resolved a DIFFERENT album than the app was showing — one
// song, two covers. This tier exists purely for PARITY with what the user sees, which is also why it
// runs ahead of Deezer: whichever tier the client ends up displaying must be the tier the card asks
// first. A share URL carries only artist+title (no album), so the reachable equivalent of the
// client's album.getInfo is track.getInfo, whose art preference is `track.image[]` then
// `track.album.image[]` — the same preference api/lastfm/info/+server.ts:249 uses.
// PROBED 2026-08-09 in production: track.getinfo for 方大同/紅豆 returned image hash
// 95f31bcdc1e942d3c24daa08dbf0e654, the SAME asset the client's album.getInfo returns, in ONE
// subrequest. Without that parity the tier would be pure subrequest cost.
//
// AN ABSENT KEY IS A SUPPORTED STATE (T-08-02 parity, and the only state local dev has): with no
// LASTFM_KEY the tier is not constructed at all and the chain is byte-identical to before this
// change — never an `api_key=undefined` upstream call.
//
// WORST CASE with the key present: 6 resolve subrequests + 1 image = 7 (4 tiers + Fallback A
// original-terms + Fallback B title-only), still far inside the 50-subrequest limit.
//
// MISS vs ERROR is distinguished even though both fall through, because only a MISS is cacheable
// (the same discipline deezer/search/+server.ts documents: never cache a fault, or one transient
// failure pins the miss for the whole 24 h TTL).
//
// LIVE PROBE (research 2026-08-07 — the facts this module is built on; all three keyless):
//  - Deezer   1 subrequest: api.deezer.com/search?q=<artist title>&limit=1 →
//             data[0].album.cover_big|cover_xl|cover_medium, data[0].artist.picture_*.
//             No-match is a CLEAN 200 { data: [], total: 0 }. Host cdn-images.dzcdn.net.
//             Bytes for one cover: cover_xl 208,487 · cover_big 72,650 → we ask for 'big'.
//  - iTunes   1 subrequest: itunes.apple.com/search?term=&entity=&limit=1 →
//             results[0].artworkUrl100 = https://is1-ssl.mzstatic.com/…/100x100bb.jpg.
//             Bytes by token: 100x100bb 4,667 · 600x600bb 101,186 · 1200x1200bb 332,091 →
//             /api/og asks for 600x600bb (Pitfall 6: 1200 is 332 KB, at the edge of WhatsApp's
//             budget). entity=musicArtist carries NO artwork, so type=artist uses the artist's
//             top ALBUM cover (entity=album&attribute=artistTerm) — itunes-cover.ts:28-31.
//  - kuwo     1 subrequest, NOT 2: the SEARCH body already carries the cover in data[n].pic
//             (exactly the field sources/kuwo.ts:82 reads), so no /detail call is needed.
//             { code: 200, data: [{ rid, pic: 'https://img4.kuwo.cn/…/600/….jpg' }] } —
//             103,674 bytes measured, already the right size class. Hosts img1/img4.kuwo.cn.
//
// SECURITY: the input is TEXT, never a URL (T-24-08 — /api/og accepts no URL parameter at all,
// a strictly TIGHTER posture than the old `?c=` carrier), encodeURIComponent'd into fixed
// upstream templates by the existing builders (T-wv8-01). Each tier validates its own result
// against its OWN host allow-list, so one upstream's JSON can never smuggle another's host
// (T-wv8-05). retries=0 + per-tier timeouts under one OG_RESOLVE_MS deadline bound the
// self/upstream DoS surface (T-wv8-04).
import { fetchDeezerCover, safeDeezerImageUrl } from '$lib/proxy/deezer-cover';
import { fetchWithRetry } from '$lib/proxy/http';
import { kuwoProxy } from '$lib/proxy/kuwo';
import { buildItunesSearchUrl, upgradeArtwork } from '$lib/services/itunes-cover';
import { isChineseLine, t2sConvertLines } from '$lib/services/zh-convert';

/** The closed set of card kinds /api/og understands. */
export const OG_TYPES = ['song', 'album', 'artist'] as const;
export type OgType = (typeof OG_TYPES)[number];

/**
 * Closed-set predicate for the `type` query param (the `isKnownSource` style at
 * api/[source]/[...path]/+server.ts:28-30, which narrows for free). `/api/og` COERCES an unknown
 * value to 'song' rather than 404ing — the route never fails.
 */
export function isOgType(value: string): value is OgType {
	return (OG_TYPES as readonly string[]).includes(value);
}

/**
 * ONE deadline for the whole resolve. A crawler is waiting, so this is a hard ceiling.
 *
 * quick-260807-vl1: raised 2500 → 5000. The value is DERIVED, not arbitrary — measured cold
 * resolves are 0.66 s (Aimer/Kataomoi) and 0.84 s (Vaundy/Odoriko) for Latin queries but 4.12 s
 * for CJK (蔡妮/小幸運), so the old 2.5 s ceiling cut off the exact query class this pass fixes.
 * 5000 covers that measured worst case with headroom and stays inside the 3–10 s crawler fetch
 * budget recorded in 30-RESEARCH.md §D. (The route's separate IMAGE_MS image-fetch budget, which
 * coincidentally also reads 2500, is deliberately UNCHANGED — the measurement justifies only the
 * overall resolve ceiling.)
 */
export const OG_RESOLVE_MS = 5000;

/**
 * Per-tier budgets. These deliberately SUM TO MORE than OG_RESOLVE_MS: the overall deadline is
 * the ceiling and each tier only ever gets whatever is left of it (AbortSignal.any below).
 */
const TIER_MS = { lastfm: 900, deezer: 1200, itunes: 900, kuwo: 1200 } as const;

/** The iTunes artwork token /api/og asks for — 101 KB, vs 332 KB for the client's 1200 (Pitfall 6). */
const OG_ARTWORK_SIZE = '600x600bb';

/**
 * A tier's verdict. `miss` and `error` both fall through, but only a `miss` may be negative-cached
 * — an `error` must be retried on the next request instead of pinning a fault for the TTL.
 */
type TierOutcome = { kind: 'hit'; url: string } | { kind: 'miss' } | { kind: 'error' };

type Tier = (type: OgType, artist: string, title: string, deadline: AbortSignal) => Promise<TierOutcome>;

/**
 * Per-tier budget UNDER the overall deadline — the AbortSignal.any feature-detect from
 * itunes-cover.ts:76-81, verbatim in shape (inline structural type on the global, never `as any`).
 * Whichever fires first wins, so a tier can never outlive the deadline.
 */
function tierSignal(ms: number, deadline: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(ms);
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([deadline, timeout]) : timeout;
}

/**
 * Validate an iTunes artwork URL before it leaves the edge (T-wv8-05). Same two guards as
 * safeDeezerImageUrl — https-only + no CSS/attribute-breaking characters — with the iTunes host
 * ONLY. Deliberately a SEPARATE function from the Deezer and kuwo siblings rather than one
 * widened allow-list: a Deezer body must never be able to smuggle an mzstatic URL past its own
 * check, and vice versa. Never throws; null/''/unparseable → null.
 */
export function safeItunesImageUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null; // CSS url() + attribute breakers
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		return host.endsWith('.mzstatic.com') ? u.href : null;
	} catch {
		return null;
	}
}

/**
 * Validate a kuwo cover URL — the kuwo-ONLY half of the per-tier allow-list (T-wv8-05). Same
 * guard shape as safeDeezerImageUrl / safeItunesImageUrl; hosts observed live are img1.kuwo.cn
 * and img4.kuwo.cn, so the suffix check is `.kuwo.cn`. Never throws.
 */
export function safeKuwoImageUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		return host.endsWith('.kuwo.cn') ? u.href : null;
	} catch {
		return null;
	}
}

/**
 * quick-260809-38i: the Last.fm grey-star placeholder hash. Last.fm serves this for "no art", and it
 * is a REAL 200 image — so without this reject a genuine cover would regress to a grey star
 * (ENRICH-02 / D-04 guardrail 2, the same constant api/lastfm/info/+server.ts filters on).
 */
const LASTFM_GREY_STAR = '2a96cbd8b46e442fc41c2b86b821562f';

/**
 * Validate a Last.fm image URL — the FOURTH per-tier allow-list (T-wv8-05 / T-38i-02). Deliberately
 * a SEPARATE function from the Deezer/iTunes/kuwo siblings rather than one widened list: a Last.fm
 * body must never be able to smuggle an mzstatic or kuwo host past its own check. Same guard shape
 * as safeKuwoImageUrl (https only + no CSS/attribute breakers), hosts `last.fm` / `*.last.fm` /
 * `*.fastly.net` — art is served from lastfm-img.freetls.fastly.net (probed 2026-08-09), the
 * `last.fm` forms are Last.fm's own CDN aliases. The grey star is rejected HERE, not only at the
 * picker, so no future caller can route around the placeholder guard. Never throws.
 */
export function safeLastfmImageUrl(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null; // CSS url() + attribute breakers
	if (raw.includes(LASTFM_GREY_STAR)) return null; // ENRICH-02: never the placeholder
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		const ok = host === 'last.fm' || host.endsWith('.last.fm') || host.endsWith('.fastly.net');
		return ok ? u.href : null;
	} catch {
		return null;
	}
}

/** Last.fm's image-size vocabulary, smallest → largest. An unknown size sorts lowest. */
const LASTFM_SIZE_RANK: Record<string, number> = {
	small: 1,
	medium: 2,
	large: 3,
	extralarge: 4,
	mega: 5
};

/** Largest valid image in a Last.fm `image[]` block, by size rank (never array order). */
function pickLastfmImage(images: unknown): string | null {
	if (!Array.isArray(images)) return null;
	let best: { url: string; rank: number } | null = null;
	for (const img of images as { '#text'?: string; size?: string }[]) {
		const url = safeLastfmImageUrl(img?.['#text']?.trim());
		if (!url) continue;
		const rank = LASTFM_SIZE_RANK[(img?.size ?? '').toLowerCase()] ?? 0;
		if (!best || rank >= best.rank) best = { url, rank };
	}
	return best ? best.url : null;
}

/**
 * Tier 0 — Last.fm track.getInfo, built ONLY when a key is present (see the module header). ONE
 * subrequest, retries=0 like every other tier. The key is interpolated into the fixed upstream
 * template and NEVER logged, never echoed into the response — only the validated image URL leaves
 * this function (T-38i-01).
 */
function lastfmTier(key: string): Tier {
	return async (type, artist, title, deadline) => {
		// track.getInfo needs both halves and has no album/artist analogue worth a subrequest here.
		if (type !== 'song' || !artist.trim() || !title.trim()) return { kind: 'miss' };
		try {
			const upstream =
				'https://ws.audioscrobbler.com/2.0/?method=track.getinfo' +
				`&api_key=${encodeURIComponent(key)}` +
				`&artist=${encodeURIComponent(artist)}` +
				`&track=${encodeURIComponent(title)}` +
				'&autocorrect=1&format=json';
			// RAW fetch (not apiFetch — fetch→apiFetch audit): edge-side fetch of an absolute upstream.
			const res = await fetchWithRetry(
				upstream,
				{ signal: tierSignal(TIER_MS.lastfm, deadline) },
				0
			);
			if (!res.ok) return { kind: 'error' };
			const body = (await res.json()) as {
				track?: { image?: unknown; album?: { image?: unknown } };
				error?: number;
			} | null;
			// Last.fm answers its own faults with a 200 + { error, message } — drift, never a clean miss.
			if (!body || body.error != null) return { kind: 'error' };
			if (!body.track) return { kind: 'error' }; // contract drift (kuwoTier's posture)
			// The SAME preference api/lastfm/info/+server.ts:249 uses, so the card matches the client.
			const url = pickLastfmImage(body.track.image) ?? pickLastfmImage(body.track.album?.image);
			return url ? { kind: 'hit', url } : { kind: 'miss' }; // no art / placeholder-only → cacheable
		} catch {
			// Non-ok / abort / timeout / malformed JSON / network failure → fault, not a miss.
			return { kind: 'error' };
		}
	};
}

/** The keyword all three keyless upstreams take: `artist title`, or just the artist for an artist card. */
function tierTerm(type: OgType, artist: string, title: string): string {
	return type === 'artist' ? artist.trim() : `${artist} ${title}`.trim();
}

/** Tier 1 — Deezer. `prefer: 'big'` = the 500 px cover (72 KB, not 208 KB). retries=0: the
 *  OG_RESOLVE_MS deadline cannot afford fetchWithRetry's 150–300 ms backoff. */
const deezerTier: Tier = async (type, artist, title, deadline) => {
	const term = tierTerm(type, artist, title);
	if (!term) return { kind: 'miss' };
	const dz = await fetchDeezerCover(term, tierSignal(TIER_MS.deezer, deadline), 0, 'big');
	// null = fault (non-ok / malformed / abort / network) — never negative-cacheable.
	if (!dz) return { kind: 'error' };
	// Re-apply the Deezer allow-list at the tier boundary: reshapeDeezerSearch already filtered,
	// and this keeps the "every tier gates its own host" invariant true by construction.
	const url = safeDeezerImageUrl(type === 'artist' ? dz.artistPicture : dz.cover);
	return url ? { kind: 'hit', url } : { kind: 'miss' };
};

/** Tier 2 — iTunes. Reuses buildItunesSearchUrl as-is; the artist card uses the top-album proxy. */
const itunesTier: Tier = async (type, artist, title, deadline) => {
	const term = tierTerm(type, artist, title);
	if (!term) return { kind: 'miss' };
	const upstream =
		type === 'artist'
			? buildItunesSearchUrl(term, 'album', 'artistTerm')
			: buildItunesSearchUrl(term, type);
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): this is the SERVER-SIDE (Cloudflare edge)
		// fetch of an ABSOLUTE itunes.apple.com URL. apiFetch is the CLIENT seam — it prepends the
		// /api base and must never run edge-side.
		const res = await fetchWithRetry(upstream, { signal: tierSignal(TIER_MS.itunes, deadline) }, 0);
		if (!res.ok) return { kind: 'error' };
		const body = (await res.json()) as { results?: { artworkUrl100?: string }[] } | null;
		const results = Array.isArray(body?.results) ? body.results : [];
		const art = results[0]?.artworkUrl100;
		if (!art) return { kind: 'miss' };
		const url = safeItunesImageUrl(upgradeArtwork(art, OG_ARTWORK_SIZE));
		return url ? { kind: 'hit', url } : { kind: 'miss' };
	} catch {
		// Non-ok / abort / timeout / malformed JSON / network failure → fault, not a miss.
		return { kind: 'error' };
	}
};

/** Tier 3 — kuwo, the CN tier, ONE subrequest (the search body already carries `pic`). */
const kuwoTier: Tier = async (type, artist, title, deadline) => {
	const term = tierTerm(type, artist, title);
	if (!term) return { kind: 'miss' };
	try {
		// buildUrl THROWS on an unsupported path, so it lives inside the never-throw try. Calling it
		// directly (rather than fetching our own /api/kuwo/search) avoids a self-origin hop that
		// would double the subrequest count and re-enter the Worker.
		const upstream = kuwoProxy.buildUrl(
			'search',
			new URLSearchParams({ name: term, limit: '1' }),
			undefined
		);
		// RAW fetch (not apiFetch — fetch→apiFetch audit): edge-side fetch of the upstream kuwo API.
		const res = await fetchWithRetry(upstream, { signal: tierSignal(TIER_MS.kuwo, deadline) }, 0);
		if (!res.ok) return { kind: 'error' };
		const body = (await res.json()) as { code?: number; data?: { pic?: string }[] } | null;
		// Contract-drift guard, inheriting sources/kuwo.ts:62-68's posture — but as an ERROR rather
		// than a throw, so drift is never negative-cached.
		if (!body || body.code !== 200 || !Array.isArray(body.data)) return { kind: 'error' };
		if (body.data.length === 0) return { kind: 'miss' }; // clean "no such song" → cacheable
		const url = safeKuwoImageUrl(body.data[0]?.pic);
		return url ? { kind: 'hit', url } : { kind: 'miss' };
	} catch {
		return { kind: 'error' };
	}
};

/**
 * Resolve a cover URL for a share card from TEXT (OG-EP-01).
 *
 * Tiers run SEQUENTIALLY, not in parallel: the preference order Last.fm → Deezer → iTunes → kuwo is
 * the point, and a hit must cost exactly ONE subrequest. `deadline.aborted` is re-checked before
 * every tier so an expired budget stops the chain instead of piling on subrequests.
 *
 * quick-260809-38i — `lastfmKey` is OPTIONAL and only prepends a tier for `type === 'song'`, on the
 * ORIGINAL (unconverted) terms — see the body for the probe that forced that placement. Absent (or
 * empty) key → not one extra subrequest and the chain is byte-identical to before. Fallbacks A and B
 * stay Deezer-only and unchanged.
 *
 * quick-260807-vl1 — the search TERMS are chosen before the chain runs (CONVERT-FIRST: a Chinese
 * query is t2s-normalized to Simplified, which is what the catalogs index), and two Deezer-only
 * fallbacks sit after it — A: the original unconverted terms (only if a substitution happened),
 * B: the original title alone. Worst case 5 resolve subrequests. See the body for the full
 * justification of the ordering and the zero-cost guarantees.
 *
 * THREE-VALUED RETURN — the contract /api/og's negative caching depends on:
 *  - a URL string → a hit, already through that tier's own host allow-list (safe to fetch).
 *  - `null`       → every tier cleanly missed (or there was nothing to search for). A genuine
 *                   "no cover exists" → CACHEABLE, so repeat crawls cost 0 subrequests.
 *  - `'ERROR'`    → at least one tier faulted and none hit. NEVER cache this; the next request
 *                   must retry rather than pin the fault for the whole TTL.
 *
 * Never throws: every tier is internally never-throw.
 */
export async function resolveCoverTiered(
	type: OgType,
	artist: string,
	title: string,
	deadline: AbortSignal,
	lastfmKey?: string
): Promise<string | null | 'ERROR'> {
	// T-og-01: nothing to search for → zero subrequests (the route also short-circuits earlier).
	// FIRST, before any dictionary work — an empty card must still cost nothing.
	if (!`${artist}${title}`.trim()) return null;

	let sawError = false;

	// quick-260809-38i — the key-gated PARITY tier, ahead of everything else and on the ORIGINAL,
	// UNCONVERTED terms.
	//
	// WHY IT SITS ABOVE THE CONVERT-FIRST BLOCK (probed, not assumed): the t2s pass below exists
	// because the CN catalogs index the SIMPLIFIED name — but Last.fm indexes what its scrobbles say,
	// which for this catalog is usually the TRADITIONAL name. Probed 2026-08-09 against production:
	// artist=方大同 with track=紅豆 returns the album art, while the t2s output 红豆 returns NOTHING.
	// Running this tier on the converted terms would therefore have broken it on the exact song the
	// mismatch was reported for. The client hero queries Last.fm with the raw track fields too, so the
	// unconverted form is also what parity requires. A hit additionally skips the dict load entirely.
	if (type === 'song' && lastfmKey && !deadline.aborted) {
		const lf = await lastfmTier(lastfmKey)(type, artist, title, deadline);
		if (lf.kind === 'hit') return lf.url;
		if (lf.kind === 'error') sawError = true;
	}

	// quick-260807-vl1 — CONVERT-FIRST. A Traditional-script query poisons every upstream keyword
	// search because the catalogs index the SIMPLIFIED name: production-probed,
	// `artist=周傑倫&title=止戰之殤` missed every tier on 3/3 attempts, while the t2s output
	// `周杰伦 / 止战之殇` hit on 4/4. So the Simplified form is the PRIMARY query, not a retry.
	//
	// WHY THE ORDERING MATTERS (this is the whole design, do not flip it back to retry-after):
	// measured cold resolves run 0.66 s (Aimer/Kataomoi) and 0.84 s (Vaundy/Odoriko) for Latin but
	// 4.12 s for CJK (蔡妮/小幸運) — CJK is ~5× slower. A retry-after design would stack a SECOND
	// round trip onto the slowest query class and, under the old 2.5 s budget, would usually have
	// been skipped for lack of remaining time — i.e. it would never have fired on the exact case it
	// exists for. Converting first costs ZERO added latency: for the Traditional input this fix
	// targets, the corrected query is simply the first thing tried.
	//
	// ZERO-COST for everything else: `isChineseLine` gates the call, so a non-Chinese query never
	// loads the dict at all, and an already-Simplified query converts to itself → `substituted`
	// stays false → not one extra subrequest (behaviour byte-identical to before this change).
	// The dict load is a one-time memoized dynamic import (~22 KB gzip, ms-scale build) and is NOT
	// signal-abortable — accepted, it happens once per isolate.
	//
	// This is NOT a reversal of OG-ZH-01: that removed Simplified→Traditional at SHARE time because
	// it corrupted the shared link's own resolution key. This is the OPPOSITE direction (t2s),
	// server-side only, confined to the cover search — the URL and the resolve-cache key still
	// carry the INPUT script.
	let qArtist = artist;
	let qTitle = title;
	let substituted = false;
	if (isChineseLine(artist) || isChineseLine(title)) {
		const [nArtist, nTitle] = await t2sConvertLines([artist, title]);
		if (nArtist !== artist || nTitle !== title) {
			qArtist = nArtist;
			qTitle = nTitle;
			substituted = true;
		}
	}

	for (const tier of [deezerTier, itunesTier, kuwoTier]) {
		if (deadline.aborted) break;
		const out = await tier(type, qArtist, qTitle, deadline);
		if (out.kind === 'hit') return out.url;
		if (out.kind === 'error') sawError = true;
	}

	// quick-260807-vl1 — FALLBACK A: the ORIGINAL (unconverted) terms, Deezer ONLY, one subrequest.
	// Runs ONLY when a substitution actually happened — otherwise it would re-issue a byte-identical
	// copy of the primary query above. Covers the case where the catalog indexes the Traditional
	// name after all (or the t2s output over-converts a proper noun).
	if (substituted && !deadline.aborted) {
		const orig = await deezerTier(type, artist, title, deadline);
		if (orig.kind === 'hit') return orig.url;
		if (orig.kind === 'error') sawError = true;
	}

	// quick-260807-vl1 — FALLBACK B: TITLE-ONLY, Deezer ONLY, one subrequest, on the ORIGINAL title
	// (the probe-verified form — `title=止戰之殤` alone hit Deezer). Kept even with convert-first,
	// because conversion cannot rescue a NON-Chinese miss: a typo, an obscure release or a romanized
	// title still poisons the `artist title` term while the bare title resolves. This is the general
	// net, not the CJK fix. Skipped when it would repeat a query already run: type=artist has no
	// title, and an empty artist means the chain above already searched the bare title.
	if (!deadline.aborted && type !== 'artist' && artist.trim() && title.trim()) {
		const titleOnly = await deezerTier(type, '', title, deadline);
		if (titleOnly.kind === 'hit') return titleOnly.url;
		if (titleOnly.kind === 'error') sawError = true;
	}

	return sawError ? 'ERROR' : null;
}
