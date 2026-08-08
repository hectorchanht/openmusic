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
// TIERS: Deezer → iTunes → kuwo. The CN tier is kuwo ONLY — never the catalog's multi-source
// search fan-out (`spike-findings-openmusic`, kuwo-first resolution): a fan-out at the edge would
// risk the exact crawl timeout this endpoint exists to avoid. A Deezer hit therefore costs exactly
// ONE subrequest.
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
const TIER_MS = { deezer: 1200, itunes: 900, kuwo: 1200 } as const;

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

/** The keyword all three upstreams take: `artist title`, or just the artist for an artist card. */
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
 * Tiers run SEQUENTIALLY, not in parallel: the preference order Deezer → iTunes → kuwo is the
 * point, and a Deezer hit must cost exactly ONE subrequest. `deadline.aborted` is re-checked
 * before every tier so an expired budget stops the chain instead of piling on subrequests.
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
	deadline: AbortSignal
): Promise<string | null | 'ERROR'> {
	// T-og-01: nothing to search for → zero subrequests (the route also short-circuits earlier).
	// FIRST, before any dictionary work — an empty card must still cost nothing.
	if (!`${artist}${title}`.trim()) return null;

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

	let sawError = false;
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

/** Content type of OG_FALLBACK_SVG. */
export const OG_FALLBACK_TYPE = 'image/svg+xml';

/**
 * The branded share card, INLINED from `static/og.svg` (1200×630, ~1.9 KB) — RESEARCH §C.11.
 * Inlining beats every alternative on the worst-case path: zero network, zero subrequest, zero
 * loop risk, zero binding/typing question. A 302 to /og.svg was rejected outright (CONTEXT +
 * §D.15: WhatsApp's crawler does not reliably follow redirects on an image URL).
 *
 * An SVG card is the PRE-EXISTING status quo, not a regression this endpoint introduces — every
 * cover-less share already emits `og:image = ${SITE}/og.svg` (PageOg.svelte). Several crawlers
 * (Slack, iMessage, some Twitter paths) do not render SVG og:image, so a 1200×630 PNG raster is
 * the production-correct follow-up; it is a logged todo, deliberately out of this pass's scope.
 * Keep this in sync with static/og.svg if that file is re-themed.
 */
export const OG_FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#160f29"/>
      <stop offset="1" stop-color="#0b0b0f"/>
    </linearGradient>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c5cff"/>
      <stop offset="1" stop-color="#a585ff"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#7c5cff" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#7c5cff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="290" cy="315" r="340" fill="url(#glow)"/>

  <!-- logo mark -->
  <g transform="translate(150 207)">
    <rect width="216" height="216" rx="54" fill="url(#tile)"/>
    <g transform="translate(108 108)">
      <circle r="58" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round"
              stroke-dasharray="277 87" transform="rotate(-52)"/>
      <path d="M-31 -34 L52 0 L-31 34 Z" fill="#fff"/>
    </g>
  </g>

  <!-- wordmark + tagline -->
  <text x="430" y="300" font-family="Inter, system-ui, sans-serif" font-size="104" font-weight="800" fill="#f4f4f6">openmusic</text>
  <text x="434" y="380" font-family="Inter, system-ui, sans-serif" font-size="34" font-weight="600" fill="#7c5cff" letter-spacing="2">music streaming for earth</text>
</svg>
`;
