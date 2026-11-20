// og-cover — the bounded, tiered cover resolve chain behind /api/og (OG-EP-01).
//
// WHY THIS MODULE EXISTS (same reason as deezer-cover.ts): a SvelteKit `+server.ts` may export
// ONLY HTTP verbs. A top-level non-verb export 500s at REQUEST time ("Invalid export") and unit
// tests miss it because they import the module directly (project finding
// `svelte-server-endpoint-only-verb-exports`). Keeping the chain here is what makes OG-EP-01
// unit-testable at all, and it keeps src/routes/api/og/+server.ts verb-only.
//
// WHAT IT IS FOR: a share link now carries NO cover (`?c=` is gone — the whole point of phase 30),
// so `og:image` points at our own /api/og card (path form `/api/og/song/{artist}/{title}` since
// quick-261120-mediacard; the query spelling survives as legacy compat) and the cover is
// re-resolved server-side from the KEYWORDS — SONG cards through the seam stage first
// (resolveCoverViaSeam below), this tier chain as the fallback. A crawler is waiting on that
// request, so every stage is bounded hard:
//
// quick-260809-3uo — AMENDMENT to the paragraph above (it is no longer the whole story; the OG-EP-01
// decision ref stays, it records why the URL carrier left). A share link MAY now carry ONE optional
// `ci` param, and `ci` is NOT a cover URL: it is a short COVER ID from a CLOSED tag set, rebuilt into
// an image URL by coverUrlFromToken below, from a template whose scheme, host and every path
// character outside the variable part are LITERALS in this file. It came back because re-resolving
// from TEXT is structurally blind to the cover the CLIENT already resolved: 你瞞我瞞 / 陳柏宇 showed
// Quinquennium art on the hero and an empty card in WhatsApp. Adding more tiers is whack-a-mole; the
// client already knows the answer at share time. See coverUrlFromToken for the full posture — it is
// TIGHTER than both the retired `?c=` and a validated-URL carrier, not looser.
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
//  - kuwo     1 subrequest, NOT 2: the SEARCH body already carries the cover, so no /detail call
//             is needed. quick-261004-n1i: the search is now the official search.kuwo.cn/r.s, and
//             the cover comes from each row's web_albumpic_short → img2.kuwo.cn/star/albumcover/500/…
//             via the shared mapSearch ($lib/proxy/kuwo.ts). Still *.kuwo.cn.
//
// SECURITY: the input is TEXT, never a URL (T-24-08 — /api/og accepts no URL parameter at all,
// a strictly TIGHTER posture than the old `?c=` carrier), encodeURIComponent'd into fixed
// upstream templates by the existing builders (T-wv8-01). Each tier validates its own result
// against its OWN host allow-list, so one upstream's JSON can never smuggle another's host
// (T-wv8-05). retries=0 + per-tier timeouts under one OG_RESOLVE_MS deadline bound the
// self/upstream DoS surface (T-wv8-04).
import { fetchDeezerCover, safeDeezerImageUrl } from '$lib/proxy/deezer-cover';
import { fetchWithRetry } from '$lib/proxy/http';
import {
	safeImageUrl,
	APPLE_IMAGE_HOSTS,
	COVER_PICK_IMAGE_HOSTS,
	KUWO_IMAGE_HOSTS,
	LASTFM_IMAGE_HOSTS,
	NETEASE_IMAGE_HOSTS,
	QQ_IMAGE_HOSTS
} from '$lib/proxy/safe-image-url';
import { buildKuwoSearchUrl, mapSearch } from '$lib/proxy/kuwo';
import { qqProxy } from '$lib/proxy/qq';
import { buildItunesSearchUrl, upgradeArtwork } from '$lib/services/itunes-cover';
import { ensureFoldReady, isChineseLine, foldScriptReady } from '$lib/services/zh-convert';
import { isCoverOf } from '$lib/services/song-variant';
import { COVER_ORDER } from '$lib/sources/source-order';
import { coverPickKeys } from '$lib/services/cover-pick-shared';
import { scoreMatch } from '$lib/services/score-match';

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

/** One acceptable identity for a card: the request {artist, title} pair in ONE script (the
 *  chain searches in two — original + t2s-converted — so a candidate may echo either). */
export interface OgIdentity {
	artist: string;
	title: string;
}

type Tier = (
	type: OgType,
	artist: string,
	title: string,
	deadline: AbortSignal,
	wants: readonly OgIdentity[]
) => Promise<TierOutcome>;

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
	// quick-261020-batch2: thin wrapper over the canonical safeImageUrl(raw, APPLE_IMAGE_HOSTS)
	// — byte-identical behavior. Kept as a named export: og-endpoint.test.ts exercises it directly.
	return safeImageUrl(raw, APPLE_IMAGE_HOSTS);
}

/**
 * Validate a kuwo cover URL — the kuwo-ONLY half of the per-tier allow-list (T-wv8-05). Same
 * guard shape as safeDeezerImageUrl / safeItunesImageUrl; hosts observed live are img1.kuwo.cn
 * and img4.kuwo.cn, so the suffix check is `.kuwo.cn`. Never throws.
 */
export function safeKuwoImageUrl(raw: string | null | undefined): string | null {
	// quick-261020-batch2: thin wrapper over the canonical safeImageUrl(raw, KUWO_IMAGE_HOSTS).
	return safeImageUrl(raw, KUWO_IMAGE_HOSTS);
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
	// quick-261020-batch2: thin wrapper over the canonical safeImageUrl(raw, LASTFM_IMAGE_HOSTS);
	// the grey-star placeholder reject stays as the 1-line pre-check (it is a real 200 image).
	if (raw?.includes(LASTFM_GREY_STAR)) return null; // ENRICH-02: never the placeholder
	return safeImageUrl(raw, LASTFM_IMAGE_HOSTS);
}

/**
 * quick-261120-mediacard: validate a NETEASE cover URL — the seam stage's own allow-list
 * (T-wv8-05 discipline: a netease body must never smuggle another host past its check).
 * Hosts are the p1–p4.music.126.net shards the album picUrl lives on. Never throws.
 */
export function safeNeteaseImageUrl(raw: string | null | undefined): string | null {
	return safeImageUrl(raw, NETEASE_IMAGE_HOSTS);
}

/**
 * quick-261120-mediacard: validate a QQ cover URL — the seam stage's own allow-list.
 * y.gtimg.cn EXACT (the tang detail's album_pic host and the T002 template host). Never throws.
 */
export function safeQqImageUrl(raw: string | null | undefined): string | null {
	return safeImageUrl(raw, QQ_IMAGE_HOSTS);
}

// =============================================================================================
// quick-260809-3uo — the `ci` COVER-ID TOKEN: closed tag set → fixed template → own allow-list
// =============================================================================================
//
// SECURITY POSTURE (read this before touching the table below).
//
// This is STRICTLY TIGHTER than BOTH the retired `?c=` URL carrier AND a would-be "validated URL"
// carrier. No attacker-supplied scheme, host or path segment reaches the fetcher. The host is a
// LITERAL in this file, so the allow-list stops being a check an attacker can probe for parser
// bypasses (`@`, `\`, unicode host confusables, userinfo tricks, double-encoding) and becomes
// STRUCTURAL: there is no host string in the request to smuggle anything into. What crosses the
// boundary is an ID matched against an ANCHORED per-tier pattern. `/` and `.` cannot appear where a
// path segment could be forged, so traversal is UNGRAMMATICAL rather than filtered (T-3uo-01).
//
// The carrier may change WHICH allow-listed host is picked, NEVER the SET (T-3uo-02): every tag maps
// to a host an existing tier already fetches. netease / qq / joox cover hosts are not expressible.
//
// The last step of every tag re-asserts the rebuilt URL through THAT TIER'S OWN existing
// safe*ImageUrl. That is redundant by construction and is kept ON PURPOSE: it is the assertion that
// the token path and the tier path can never drift apart, and it inherits the Last.fm grey-star
// reject for free.
//
// SIZE IS NORMALIZED, NOT CARRIED: the client tokenizer accepts any size variant and this rebuilds
// at the CARD size. Carrying a size would put another attacker-influenced field in the token for no
// benefit. The live probes behind each size choice are recorded per row.

/**
 * Total token cap. The LONGEST legal token is 38 chars (`l:<32hex>.png`), so 64 is headroom, never a
 * truncation point — an over-cap token is REJECTED whole (T-3uo-04). MAX_TERM_CHARS in
 * routes/api/og/+server.ts is the sibling precedent for capping request text at the boundary.
 */
const TOKEN_MAX_CHARS = 64;

/**
 * The `i` tag's ONE lookup subrequest.
 *
 * quick-261119-sharecard: raised 900 → 2500. The 900 budget sat ON the measured median:
 * itunes.apple.com/lookup probed 2026-11-19 at 0.79–1.33 s (median ~0.87 s) from the VM, and a
 * cold-PoP edge fetch adds TLS on top — so in production the lookup timed out as a matter of
 * routine, the token silently degraded to the tier chain, and the chain misses exactly the
 * obscure songs the `ci` carrier exists for (live-verified: PetPetShawn/夜行 with a valid
 * `i:` token returned the branded fallback card, while a `d:` token — no lookup — returned
 * the real cover). A success is bytes-cached for 24 h, so the cost is paid once per song.
 *
 * Post-fix live distribution (same day, isolated `i:`-token probes with nonsense text so no
 * tier could rescue): at 2500 the lookup succeeded ~1/3 of first crawls — the edge→Apple
 * latency is bimodal (fast successes land lookup+image in ~1.1 s; the slow mode sits past
 * 2.5 s). Raised to 4000 to catch more of the slow mode: the typical failure total stays
 * ~4.3 s (tiers miss fast on the obscure songs this path serves), and only the pathological
 * every-tier-hangs case approaches the crawler ceiling — for one crawl, with nothing
 * negative-cached, so the next crawl retries.
 */
const TOKEN_LOOKUP_MS = 4000;

/**
 * `d` — Deezer album cover. PROBED 2026-08-09: the rebuilt
 * `.../images/cover/fe1082c5ef54876802146897e76b592e/500x500-000000-80-0-0.jpg` → 200 image/jpeg,
 * 72,650 B. 500x500 is `cover_big`, the same size the deezerTier already asks for (208 KB at
 * cover_xl is past the crawler budget). ARTIST pictures (`/images/artist/`) are deliberately NOT
 * expressible — a song share never needs one, and a closed grammar beats a kind flag.
 */
const DEEZER_HASH_RE = /^[0-9a-f]{32}$/;

/**
 * `l` — Last.fm art. PROBED 2026-08-09: `/i/u/300x300/<hash>.png` → 200 image/png, 112,810 B.
 * 300x300 IS the card size on purpose: the same hash at 500x500 is 274 KB and at 600x600 is 342 KB,
 * both past the WhatsApp budget Pitfall 6 records. The extension is a CLOSED two-value set chosen by
 * us — Last.fm serves both and the wrong one transcodes to a different asset (the `.jpg` render of
 * that hash is 16,716 B, a visibly worse image), so guessing would silently degrade the parity tier
 * quick-260809-38i just added.
 */
const LASTFM_HASH_RE = /^([0-9a-f]{32})\.(jpg|png)$/;

/**
 * `k` — kuwo album cover. PROBED 2026-08-09: `/star/albumcover/600/s4s27/11/1502064321.jpg` → 200
 * image/jpeg, 97,759 B — already the right size class, the same `/600/` the kuwoTier reads off
 * `pic`. The variable part is the two shard directories + the numeric id, HYPHEN-joined: no `/` ever
 * enters a token. `img1.kuwo.cn` was probed serving the identical bytes for that path, so pinning
 * `img4` as a literal loses nothing. `/star/starheads/` (artist heads) is not expressible.
 */
const KUWO_SHARD_RE = /^([a-z0-9]{1,8})-([0-9]{1,4})-([0-9]{4,12})$/;

/**
 * `i` — iTunes, by NUMERIC ID. This is the tag the reported bug actually needed: 你瞞我瞞 / 陳柏宇's
 * in-app cover is `is1-ssl.mzstatic.com/...` (the client's iTunes tier), and an mzstatic path is a
 * ~90-char irregular fragment — carrying THAT would be neither short nor structural and would
 * reintroduce the attacker-supplied-path property this whole design removes. So the path is not
 * carried at all. `i` is the SHORTEST token of the four and its structural property is the STRONGEST:
 * every character of host and path is a literal here and the variable part is digits only.
 *
 * It is the one tag that costs a LOOKUP rather than a pure template — `itunes.apple.com/lookup?id=`
 * → `artworkUrl100` → the existing upgradeArtwork transform → safeItunesImageUrl. PROBED 2026-08-09:
 * lookup?id=446760418 → the Quinquennium artwork, 600x600bb = 200 image/jpeg, 54,671 B.
 * 12 digits is well past Apple's current 9–10 digit ids and still bounded.
 */
const ITUNES_ID_RE = /^[0-9]{1,12}$/;

/**
 * Rebuild a cover URL from a `<tag>:<variable-part>` cover-id token (quick-260809-3uo).
 *
 * Order, and it matters: reject falsy → reject over TOKEN_MAX_CHARS → split ONCE on the FIRST `:`
 * (so a `:` inside the variable part stays part of it and simply fails its anchored pattern, rather
 * than re-splitting into a different tag) → look the tag up in the CLOSED set (unknown → null) →
 * test the variable part against that tag's ANCHORED pattern (fail → null) → build from the fixed
 * template → return it through that tier's OWN existing safe*ImageUrl.
 *
 * Async only because of the `i` tag's single lookup; `d`/`l`/`k` never touch the network.
 * NEVER THROWS for any input — null is the only failure mode, and /api/og treats null as "no
 * carrier" and falls through to the ordinary tier chain.
 *
 * LEGACY COMPAT (quick-261120-mediacard): the client half of this grammar (`coverToken` in
 * $lib/services/share) is DELETED — share links stopped EMITTING `?ci=` under Hector's
 * keyword-only ruling. This RECEPTION half stays: og:image URLs and share links already sent
 * with a `ci` token must keep resolving. Do not delete while such links can still arrive;
 * do not re-add emission.
 */
export async function coverUrlFromToken(token: string | null | undefined): Promise<string | null> {
	if (!token || typeof token !== 'string') return null;
	if (token.length > TOKEN_MAX_CHARS) return null; // rejected whole, never truncated (T-3uo-04)
	const sep = token.indexOf(':');
	if (sep <= 0) return null; // no tag, or an empty tag (`:<hash>`)
	const tag = token.slice(0, sep);
	const v = token.slice(sep + 1);

	if (tag === 'd') {
		if (!DEEZER_HASH_RE.test(v)) return null;
		return safeDeezerImageUrl(
			`https://cdn-images.dzcdn.net/images/cover/${v}/500x500-000000-80-0-0.jpg`
		);
	}
	if (tag === 'l') {
		const m = LASTFM_HASH_RE.exec(v);
		if (!m) return null;
		return safeLastfmImageUrl(`https://lastfm.freetls.fastly.net/i/u/300x300/${m[1]}.${m[2]}`);
	}
	if (tag === 'k') {
		const m = KUWO_SHARD_RE.exec(v);
		if (!m) return null;
		return safeKuwoImageUrl(
			`https://img4.kuwo.cn/star/albumcover/600/${m[1]}/${m[2]}/${m[3]}.jpg`
		);
	}
	if (tag === 'i') {
		if (!ITUNES_ID_RE.test(v)) return null;
		return itunesArtworkById(v);
	}
	return null; // closed tag set — anything else is not a token
}

/**
 * The `i` tag's ONE lookup. `id` has ALREADY passed ITUNES_ID_RE (digits only), so the upstream URL
 * is a fixed template with a numeric hole — there is nothing to escape. retries=0 and a
 * TOKEN_LOOKUP_MS budget, the same posture every tier uses; a crawler is waiting.
 *
 * The reconstructed artwork URL is re-asserted through safeItunesImageUrl before it can be fetched,
 * exactly like a tier result — Apple's own JSON is still untrusted third-party input here, so this
 * is the step that stops a compromised/odd `artworkUrl100` from widening the fetched host set.
 * Never throws: any fault → null → /api/og's branded card.
 */
async function itunesArtworkById(id: string): Promise<string | null> {
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): edge-side fetch of an absolute
		// itunes.apple.com URL. apiFetch is the CLIENT seam and must never run edge-side.
		const res = await fetchWithRetry(
			`https://itunes.apple.com/lookup?id=${id}`,
			{ signal: AbortSignal.timeout(TOKEN_LOOKUP_MS) },
			0
		);
		if (!res.ok) return null;
		const body = (await res.json()) as { results?: { artworkUrl100?: string }[] } | null;
		const art = Array.isArray(body?.results) ? body.results[0]?.artworkUrl100 : null;
		if (!art) return null;
		return safeItunesImageUrl(upgradeArtwork(art, OG_ARTWORK_SIZE));
	} catch {
		return null;
	}
}

// =============================================================================================
// quick-261120-mediacard — THE SEAM STAGE: resolving a media card IS resolving a song
// =============================================================================================
//
// HECTOR'S DOCTRINE (2026-11-20): "Resolving a media card is same as song" — the card cover
// must come from the system's ONE song-resolver seam, not from a card-local chain. The seam
// (share-arrival's path) resolves a name through resolveStub (discovery.ts: searchAll fan-out
// → dedupeBest/rankPool under the isAutoAcceptable gate + scoreMatch) and fills a missing
// cover through the shared cover chain (cover-backfill.ts resolveTrackChain: crowd pick →
// iTunes → CN fan-out under COVER_ORDER + the isCoverOf gate → qq detail → Deezer → YTM) —
// the best version, by the original singer, with its true album cover.
//
// WHY THE SEAM IS DRIVEN, NOT IMPORTED (investigated 2026-11-20 — do not re-litigate):
// catalog.ts / discovery.ts / cover-backfill.ts cannot execute in this server context.
//  1. Every adapter fetch rides apiFetch ($lib/services/api-base), which on the web build
//     returns RELATIVE `/api/...` URLs (apiUrl passes the path through when VITE_API_BASE is
//     unset) — workerd's global fetch rejects relative URLs, so the fan-out's relative-path
//     sources (qq / kuwo / joox search + detail) can never run here. There is no injection
//     seam either: the adapters call the module singleton directly.
//  2. The import graph drags the client world into the route — runes stores
//     (settings.svelte / actionLog.svelte), the localStorage cover cache — and the repo's
//     SSR contract (share-arrival.ts's header) forbids importing that graph from a +server.ts.
// So this stage DRIVES the seam's own calls through the existing proxy dispatch layer — the
// SAME builders the /api/[source] routes wrap (qqProxy, buildKuwoSearchUrl/mapSearch, the
// netease adapter's Meting search template) and the SAME /api/cover-pick endpoint the cover
// chain's crowd layer reads — and selects with the seam's OWN shared helpers: isCoverOf (the
// cover identity gate, via ogIdentityMatches), COVER_ORDER (the CN-tier source order) and
// scoreMatch (resolveStub's re-rank). No new upstream template is invented; every call below
// names the adapter call it replays. (Self-origin HTTP to /api/[source] was the alternative;
// the kuwoTier below already documents why this module fetches upstreams through the builders
// instead — a self-hop doubles subrequests and re-enters the Worker.)
//
// SHAPE: keyword-only. The share URL carries no identity any more (Hector's keyword-only
// ruling retired `?u=` / `?ci=` emission the same day), so the stage takes {artist, title} —
// exactly what resolveStub takes. In the handler it runs AFTER the resolve cache and the
// legacy `ci` carrier, BEFORE the text tier chain (demoted to fallback-only), and a HIT is
// written to the keyword-keyed resolve cache like any tier hit.
//
// SOURCES: the seam's tier-1 CN set that can yield a cover from a name — netease (Meting
// search rows carry the pic), kuwo (search rows carry the albumpic), qq (search rows carry
// NO cover by design, so the gated winner takes the cover chain's qq detail hop). joox is
// excluded with cause: its search rows also map cover:null (sources/joox.ts) and its detail
// is POSITIONAL (msg + row index, not name-keyed), so it cannot contribute a name-resolved
// cover. iTunes / Deezer / YTM are NOT replayed here — the tier chain below already resolves
// them from the same text, and duplicating those tiers would be a second chain, not the seam.

/** One seam search row reduced to what selection needs. `mid` is qq's detail key. */
interface SeamCandidate {
	source: 'netease' | 'qq' | 'kuwo';
	artist: string;
	title: string;
	cover: string | null;
	mid?: string;
}

/**
 * Validate a netease seam cover: either a direct album picUrl on the 126.net shards
 * (safeNeteaseImageUrl), or the Meting pic redirector the adapters themselves emit as a
 * cover (sources/gdnetease.ts coverUrl) — accepted ONLY in its exact template shape
 * (host + path + server/type/id params, digits-only id), never as a free-form URL.
 */
function safeMetingPicUrl(raw: string | null | undefined): string | null {
	const direct = safeNeteaseImageUrl(raw);
	if (direct) return direct;
	if (!raw) return null;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:' || u.hostname !== 'api.qijieya.cn' || u.pathname !== '/meting/')
			return null;
		if (u.searchParams.get('server') !== 'netease' || u.searchParams.get('type') !== 'pic')
			return null;
		if (!/^[0-9]+$/.test(u.searchParams.get('id') ?? '')) return null;
		return raw;
	} catch {
		return null;
	}
}

/**
 * The crowd layer of the shared cover chain, read through its own endpoint. Keys come from
 * coverPickKeys — the chain's own builder (NAME key only: a keyword card has no uid) — and
 * the returned cover is re-screened through the pick allow-list exactly as fetchCoverPick
 * screens it client-side (cover-pick-shared.ts). One subrequest; never throws.
 */
async function crowdPickCover(
	origin: string,
	artist: string,
	title: string,
	signal: AbortSignal
): Promise<string | null> {
	if (!origin) return null;
	try {
		const keys = await coverPickKeys('', artist, title);
		if (!keys?.n) return null;
		// RAW fetch (not apiFetch — fetch→apiFetch audit): edge-side fetch of an absolute
		// own-origin URL. apiFetch is the CLIENT seam and must never run edge-side.
		const res = await fetchWithRetry(
			`${origin}/api/cover-pick?n=${encodeURIComponent(keys.n)}`,
			{ signal },
			0
		);
		if (!res.ok) return null;
		const body = (await res.json()) as { n?: unknown } | null;
		return safeImageUrl(typeof body?.n === 'string' ? body.n : null, COVER_PICK_IMAGE_HOSTS);
	} catch {
		return null;
	}
}

/** netease rows — replays the netease adapter's own search (sources/netease.ts): the Meting
 *  pipe it hits browser-direct; /api/netease is the retained non-browser dispatch of the same
 *  template. Rows: { name, artist, pic } with pic the album art (see safeMetingPicUrl). */
async function neteaseSeamRows(keyword: string, signal: AbortSignal): Promise<SeamCandidate[]> {
	try {
		const upstream =
			`https://api.qijieya.cn/meting/?server=netease&type=search&id=${encodeURIComponent(keyword)}` +
			`&limit=10`;
		// RAW fetch (not apiFetch — fetch→apiFetch audit): edge-side fetch of an absolute upstream.
		const res = await fetchWithRetry(upstream, { signal }, 0);
		if (!res.ok) return [];
		const body = (await res.json()) as { name?: string; artist?: string; pic?: string }[] | null;
		if (!Array.isArray(body)) return [];
		return body.map((r) => ({
			source: 'netease' as const,
			artist: (r.artist ?? '').trim(),
			title: (r.name ?? '').trim(),
			cover: safeMetingPicUrl(r.pic ?? null)
		}));
	} catch {
		return [];
	}
}

/** qq rows — replays the qq adapter's search through qqProxy (the /api/qq/search dispatch
 *  core). Body is the tang list: a bare array or { data: [...] } (sources/qq.ts). Rows carry
 *  NO cover by design — `mid` is kept for the detail hop. */
async function qqSeamRows(keyword: string, signal: AbortSignal): Promise<SeamCandidate[]> {
	try {
		const upstream = qqProxy.buildUrl('search', new URLSearchParams({ msg: keyword }), undefined);
		// RAW fetch (not apiFetch — fetch→apiFetch audit): edge-side fetch of an absolute upstream.
		const res = await fetchWithRetry(upstream, { signal }, 0);
		if (!res.ok) return [];
		const body = (await res.json()) as unknown;
		const list = Array.isArray(body)
			? body
			: Array.isArray((body as { data?: unknown })?.data)
				? (body as { data: unknown[] }).data
				: [];
		return (list as { song_mid?: string; song_title?: string; singer_name?: string }[])
			.filter((r) => !!r?.song_mid)
			.map((r) => ({
				source: 'qq' as const,
				artist: (r.singer_name ?? '').trim(),
				title: (r.song_title ?? '').trim(),
				cover: null,
				mid: String(r.song_mid)
			}));
	} catch {
		return [];
	}
}

/** kuwo rows — the shared search builder + mapper, the kuwoTier's own calls, at seam depth
 *  (10 rows: the gate needs a pool, not a first hit). pic is the row's albumpic. */
async function kuwoSeamRows(keyword: string, signal: AbortSignal): Promise<SeamCandidate[]> {
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): edge-side fetch of the upstream kuwo API.
		const res = await fetchWithRetry(buildKuwoSearchUrl(keyword, 10, 1), { signal }, 0);
		if (!res.ok) return [];
		const rows = mapSearch(await res.json());
		if (!rows) return [];
		return rows.map((r) => ({
			source: 'kuwo' as const,
			artist: r.artist,
			title: r.name,
			cover: safeKuwoImageUrl(r.pic)
		}));
	} catch {
		return [];
	}
}

/** The album mid inside a tang album_pic filename: `T002R500x500M000<albumMid>[_n].jpg`. */
const QQ_ALBUM_MID_RE = /T002R[0-9]+x[0-9]+M000([A-Za-z0-9]+)/;

/**
 * The qq card cover from a tang album_pic: re-template the embedded album mid at 800x800 when
 * the filename parses (the size class QQ's own CDN serves for every album); otherwise the
 * detail pic itself, https-upgraded (32-D-05 — the qq adapter's own boundary rule). Either
 * way the result re-enters through safeQqImageUrl.
 */
function qqAlbumCover(albumPic: string | null | undefined): string | null {
	if (!albumPic) return null;
	const httpsPic = albumPic.replace(/^http:\/\//i, 'https://');
	const mid = QQ_ALBUM_MID_RE.exec(httpsPic)?.[1];
	if (mid) return safeQqImageUrl(`https://y.gtimg.cn/music/photo_new/T002R800x800M000${mid}.jpg`);
	return safeQqImageUrl(httpsPic);
}

/** The cover chain's qq detail hop (cover-backfill qqSongCover's second half), replayed
 *  through qqProxy — the /api/qq/detail dispatch core. Liveness = `song_mid` present AND
 *  echoing the requested mid (tang answers an unknown mid with a 200 all-null body —
 *  sources/qq.ts's discriminator). One subrequest; never throws. */
async function qqDetailByMid(
	mid: string,
	signal: AbortSignal
): Promise<{ artist: string; title: string; cover: string | null } | null> {
	try {
		const upstream = qqProxy.buildUrl('detail', new URLSearchParams({ mid }), undefined);
		// RAW fetch (not apiFetch — fetch→apiFetch audit): edge-side fetch of an absolute upstream.
		const res = await fetchWithRetry(upstream, { signal }, 0);
		if (!res.ok) return null;
		const d = (await res.json()) as {
			song_mid?: string | null;
			song_title?: string | null;
			song_name?: string | null;
			singer_name?: string | null;
			album_pic?: string | null;
		} | null;
		if (!d || typeof d !== 'object' || !d.song_mid || String(d.song_mid) !== mid) return null;
		return {
			artist: (d.singer_name ?? '').trim(),
			title: (d.song_title ?? d.song_name ?? '').trim(),
			cover: qqAlbumCover(d.album_pic)
		};
	} catch {
		return null;
	}
}

/**
 * Resolve a share card's cover through the system's single song-resolver seam
 * (quick-261120-mediacard — see the section header for why it is driven, not imported).
 * `origin` is the request's own origin (the crowd-pick dispatch base). Returns the validated
 * cover URL or null; the handler treats null as "seam miss" and falls through to the tier
 * chain. NEVER throws.
 */
export async function resolveCoverViaSeam(
	origin: string,
	artist: string,
	title: string,
	signal: AbortSignal
): Promise<string | null> {
	try {
		if (!`${artist}${title}`.trim() || signal.aborted) return null;
		// isCoverOf compares script-folded identity keys — never gate cold.
		await ensureFoldReady();

		// Stage 1 — the cover chain's crowd layer.
		const crowd = await crowdPickCover(origin, artist, title, signal);
		if (crowd) return crowd;
		if (signal.aborted) return null;

		// Stage 2 — resolveStub's search fan-out, replayed through the dispatch builders on
		// the cover chain's folded search terms (coverSearchTerms: the CN catalogs index the
		// Simplified fold, so the seam searches folded while identity stays the caller's).
		const qArtist = await foldScriptReady(artist);
		const qTitle = await foldScriptReady(title);
		const keyword = `${qArtist} ${qTitle}`.trim();
		if (!keyword) return null;
		const rows = (
			await Promise.all([
				neteaseSeamRows(keyword, signal),
				qqSeamRows(keyword, signal),
				kuwoSeamRows(keyword, signal)
			])
		).flat();
		if (signal.aborted) return null;

		// THE seam's own identity gate — the same predicate every in-app cover rung asks.
		const wants: readonly OgIdentity[] = [{ artist, title }];
		const gated = rows.filter((r) => ogIdentityMatches(wants, r.artist, r.title));
		// resolveStub's re-rank, applied within a source's gated pool.
		const query = { artist, title };
		const best = (list: SeamCandidate[]): SeamCandidate | null =>
			list.reduce<SeamCandidate | null>(
				(acc, r) => (acc === null || scoreMatch(query, r) > scoreMatch(query, acc) ? r : acc),
				null
			);

		// Stage 3a — a cover the resolved song already carries, in the cover chain's CN
		// source order (COVER_ORDER; joox/migu carry none at search, so netease precedes kuwo).
		for (const src of COVER_ORDER) {
			const hit = best(gated.filter((r) => r.source === src && r.cover));
			if (hit?.cover) return hit.cover;
		}

		// Stage 3b — the cover chain's qq tier: the gated qq winner's detail album_pic,
		// itself identity-gated (a detail naming NEITHER field is drift, not a candidate).
		const qqRow = best(gated.filter((r) => r.source === 'qq' && r.mid));
		if (qqRow?.mid) {
			const detail = await qqDetailByMid(qqRow.mid, signal);
			if (
				detail?.cover &&
				(detail.title || detail.artist) &&
				ogIdentityMatches(wants, detail.artist, detail.title)
			)
				return detail.cover;
		}
		return null;
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

// =============================================================================================
// quick-261102-covgate — the CANDIDATE IDENTITY GATE (read this before touching any tier)
// =============================================================================================
//
// WHY IT EXISTS. Every tier used to take its keyword search's FIRST result and trust its cover
// outright. The incident (2026-11-02, Hector's screenshot): the song page for 高爾宣 OSN
// 《Without You (Explicit)》 (uid qq:003OVf2Y349s0Z) showed a photo of a stranger in a red
// hoodie while the nowbar on the same screen showed the real album art. Proven byte-identical
// (md5) to Deezer cover hash 1a18a3631eb049dbd2fbd2fc4afae088 — 'Without you explicit' by
// Lilcory_offical, a DIFFERENT artist. The path: Deezer has no such track under the full term
// (total 0, probed), iTunes' top hits were OTHER OSN songs, the kuwo tier's correct row never
// got to win that run — and Fallback B, a TITLE-ONLY Deezer search with no artist term at all,
// returned the Lilcory track as data[0] and the chain believed it. The 24 h resolve cache then
// pinned the wrong answer.
//
// THE RULE — the same identity discipline the playback chain applies to audio: a cover
// candidate is acceptable only if the track it belongs to canonically IS the requested song
// (title + artist, compared against the request in BOTH scripts the chain searches with). A
// candidate that fails the gate is a MISS for its tier — never an error, never a hit — so the
// chain falls through and, at worst, serves the branded card. A wrong cover is worse than no
// cover: it is the one outcome this endpoint must never produce again.
//
// COMPARISON rides `norm` (dedupe.ts): case/space/punctuation-insensitive, bracketed
// qualifiers dropped. Two deliberate loosenings, both forced by real catalog shapes:
//  - ogTitleKey ALSO strips a BARE trailing explicit/clean/remaster/live/acoustic word —
//    norm() drops those only after a dash or inside brackets, but Deezer literally titles the
//    incident's wrong candidate "Without you explicit". Its title SHOULD match (it is the
//    artist gate that rejects it), and a pressing titled without the "(Explicit)" must too.
//  - Artist matching accepts segment equality and containment either way, because catalogs
//    credit this catalog's artists inconsistently: request "高爾宣 OSN" vs iTunes' "Osn" vs a
//    CN row's "高爾宣" are one artist. A different artist ("Lilcory_offical") shares no segment
//    and contains nothing — rejected.
//
// ABSENT IDENTITY: a candidate carrying NO identity fields at all (both empty) is accepted.
// Every probed upstream contract (module header) carries title+artist on every hit, so total
// absence means a synthetic body, not a real candidate; a PARTIALLY present identity is
// validated on the fields it does carry. Tighten this only alongside a fixture-wide contract
// change — the endpoint suite's minimal bodies rely on it.

/**
 * quick-261102-tdc (DECISIONS.md §6): the gate is the SHARED cover identity predicate
 * (song-variant isCoverOf) — the same one every in-app cover rung asks — so /api/og renders the
 * in-app decision instead of keeping its own. Artist identity is whole-segment / script-run alias
 * (product call 2026-11-03), no longer ≥2-char containment; keys fold script, so one want covers
 * both scripts.
 */
function ogIdentityMatches(
	wants: readonly OgIdentity[],
	candArtist: string,
	candTitle: string
): boolean {
	return wants.some((w) => isCoverOf(w, { artist: candArtist, title: candTitle }));
}

/**
 * Tier 0 — Last.fm track.getInfo, built ONLY when a key is present (see the module header). ONE
 * subrequest, retries=0 like every other tier. The key is interpolated into the fixed upstream
 * template and NEVER logged, never echoed into the response — only the validated image URL leaves
 * this function (T-38i-01).
 */
function lastfmTier(key: string): Tier {
	return async (type, artist, title, deadline, wants) => {
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
				track?: {
					name?: string;
					artist?: string | { name?: string };
					image?: unknown;
					album?: { image?: unknown };
				};
				error?: number;
			} | null;
			// Last.fm answers its own faults with a 200 + { error, message } — drift, never a clean miss.
			if (!body || body.error != null) return { kind: 'error' };
			if (!body.track) return { kind: 'error' }; // contract drift (kuwoTier's posture)
			// The SAME preference api/lastfm/info/+server.ts:249 uses, so the card matches the client.
			const url = pickLastfmImage(body.track.image) ?? pickLastfmImage(body.track.album?.image);
			if (!url) return { kind: 'miss' }; // no art / placeholder-only → cacheable
			// quick-261102-covgate: this tier queries with autocorrect=1, so the track Last.fm
			// hands back may be a SUBSTITUTED song, not the requested one. The body's own
			// name/artist must pass the identity gate or the art is treated as not found.
			const candArtist =
				typeof body.track.artist === 'string'
					? body.track.artist
					: (body.track.artist?.name ?? '');
			if (!ogIdentityMatches(wants, candArtist, body.track.name ?? '')) return { kind: 'miss' };
			return { kind: 'hit', url };
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
 *  OG_RESOLVE_MS deadline cannot afford fetchWithRetry's 150–300 ms backoff.
 *  quick-261102-covgate: the search now asks for up to 5 hits and the tier returns the first
 *  candidate that passes the identity gate — same ONE subrequest, just a wider net, so a wrong
 *  first hit is skipped instead of trusted. */
const deezerTier: Tier = async (type, artist, title, deadline, wants) => {
	const term = tierTerm(type, artist, title);
	if (!term) return { kind: 'miss' };
	const dz = await fetchDeezerCover(term, tierSignal(TIER_MS.deezer, deadline), 0, 'big', 5);
	// null = fault (non-ok / malformed / abort / network) — never negative-cacheable.
	if (!dz) return { kind: 'error' };
	// Re-apply the Deezer allow-list at the tier boundary: reshapeDeezerSearch already filtered,
	// and this keeps the "every tier gates its own host" invariant true by construction.
	if (type === 'artist') {
		// The picture belongs to data[0]'s artist (results[0] IS data[0], reshaped) — validate
		// THAT artist. A body whose hits carry no identity at all takes the gate's absent-
		// identity accept, exactly like the pre-gate behaviour.
		if (!ogIdentityMatches(wants, dz.results?.[0]?.artist ?? '', '')) return { kind: 'miss' };
		const url = safeDeezerImageUrl(dz.artistPicture);
		return url ? { kind: 'hit', url } : { kind: 'miss' };
	}
	const candidates = dz.results ?? [];
	for (const hit of candidates) {
		if (!ogIdentityMatches(wants, hit.artist, type === 'album' ? hit.album : hit.title)) continue;
		const url = safeDeezerImageUrl(hit.cover);
		if (url) return { kind: 'hit', url };
	}
	if (candidates.length > 0) return { kind: 'miss' }; // real candidates, none of them this song
	// No reshaped candidates (an id-less body): data[0]'s cover keeps its pre-gate meaning via
	// the gate header's absent-identity rule.
	const url = safeDeezerImageUrl(dz.cover);
	return url ? { kind: 'hit', url } : { kind: 'miss' };
};

/** Tier 2 — iTunes. Reuses buildItunesSearchUrl as-is; the artist card uses the top-album proxy.
 *  quick-261102-covgate: asks for up to 5 results and takes the first that passes the identity
 *  gate. iTunes' relevance order put OTHER songs by the right artist ahead of the right song
 *  in the incident, so results[0] alone is not evidence of identity any more. */
const itunesTier: Tier = async (type, artist, title, deadline, wants) => {
	const term = tierTerm(type, artist, title);
	if (!term) return { kind: 'miss' };
	const upstream =
		type === 'artist'
			? buildItunesSearchUrl(term, 'album', 'artistTerm', 5)
			: buildItunesSearchUrl(term, type, undefined, 5);
	try {
		// RAW fetch (not apiFetch — fetch→apiFetch audit): this is the SERVER-SIDE (Cloudflare edge)
		// fetch of an ABSOLUTE itunes.apple.com URL. apiFetch is the CLIENT seam — it prepends the
		// /api base and must never run edge-side.
		const res = await fetchWithRetry(upstream, { signal: tierSignal(TIER_MS.itunes, deadline) }, 0);
		if (!res.ok) return { kind: 'error' };
		const body = (await res.json()) as {
			results?: {
				artworkUrl100?: string;
				trackName?: string;
				collectionName?: string;
				artistName?: string;
			}[];
		} | null;
		const results = Array.isArray(body?.results) ? body.results : [];
		for (const r of results) {
			// The candidate's title is the TRACK name for a song card, the COLLECTION name for an
			// album card, and unconstrained for an artist card (any top album by that artist).
			const candTitle =
				type === 'song' ? (r.trackName ?? '') : type === 'album' ? (r.collectionName ?? '') : '';
			if (!ogIdentityMatches(wants, r.artistName ?? '', candTitle)) continue;
			const url = safeItunesImageUrl(upgradeArtwork(r.artworkUrl100, OG_ARTWORK_SIZE));
			if (url) return { kind: 'hit', url };
		}
		return { kind: 'miss' };
	} catch {
		// Non-ok / abort / timeout / malformed JSON / network failure → fault, not a miss.
		return { kind: 'error' };
	}
};

/** Tier 3 — kuwo, the CN tier, ONE subrequest (the search body already carries `pic`). */
const kuwoTier: Tier = async (type, artist, title, deadline, wants) => {
	const term = tierTerm(type, artist, title);
	if (!term) return { kind: 'miss' };
	try {
		// Building the upstream url directly (rather than fetching our own /api/kuwo/search) avoids a
		// self-origin hop that would double the subrequest count and re-enter the Worker.
		const upstream = buildKuwoSearchUrl(term, 1, 1);
		// RAW fetch (not apiFetch — fetch→apiFetch audit): edge-side fetch of the upstream kuwo API.
		const res = await fetchWithRetry(upstream, { signal: tierSignal(TIER_MS.kuwo, deadline) }, 0);
		if (!res.ok) return { kind: 'error' };
		// res.json() parses r.s's text/plain body fine — Response.json ignores the content-type.
		const rows = mapSearch(await res.json());
		// Contract drift (no abslist array) is an ERROR rather than a miss, so it is never
		// negative-cached (quick-261004-n1i keeps the posture the old code:200 guard had).
		if (rows === null) return { kind: 'error' };
		if (rows.length === 0) return { kind: 'miss' }; // clean "no such song" → cacheable
		// quick-261102-covgate: the one row is validated like every other tier's candidate —
		// kuwo's first row for an exact artist+title query is usually right, but "usually" is
		// what the gate exists to replace. rn stays 1: validation, not volume, is the fix here.
		const row = rows[0];
		if (!ogIdentityMatches(wants, row.artist, type === 'album' ? row.album : row.name))
			return { kind: 'miss' };
		const url = safeKuwoImageUrl(row.pic);
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
	// quick-261102-covgate: the identity pairs every tier validates against. The Last.fm tier
	// searches the ORIGINAL pair, so it validates against that pair alone; the tiers below
	// validate against every script form of the request (a candidate may echo any of them —
	// see the wants construction after the convert-first block, and the gate header above
	// ogTitleKey).
	const wantOriginal: OgIdentity = { artist, title };
	if (type === 'song' && lastfmKey && !deadline.aborted) {
		const lf = await lastfmTier(lastfmKey)(type, artist, title, deadline, [wantOriginal]);
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
		// quick-261102-sdm: the one identity fold (per character), not the phrase table.
		const nArtist = await foldScriptReady(artist);
		const nTitle = await foldScriptReady(title);
		if (nArtist !== artist || nTitle !== title) {
			qArtist = nArtist;
			qTitle = nTitle;
			substituted = true;
		}
	}

	// quick-261102-covgate widened the wants across scripts (original + t2s + s2t) because its own
	// comparison did not fold. quick-261102-tdc: isCoverOf compares script-folded identity keys
	// (the fold is warm — foldScriptReady above), so the original identity alone covers every
	// script form a catalog may credit.
	const wants: readonly OgIdentity[] = [wantOriginal];

	for (const tier of [deezerTier, itunesTier, kuwoTier]) {
		if (deadline.aborted) break;
		const out = await tier(type, qArtist, qTitle, deadline, wants);
		if (out.kind === 'hit') return out.url;
		if (out.kind === 'error') sawError = true;
	}

	// quick-260807-vl1 — FALLBACK A: the ORIGINAL (unconverted) terms, Deezer ONLY, one subrequest.
	// Runs ONLY when a substitution actually happened — otherwise it would re-issue a byte-identical
	// copy of the primary query above. Covers the case where the catalog indexes the Traditional
	// name after all (or the t2s output over-converts a proper noun).
	if (substituted && !deadline.aborted) {
		const orig = await deezerTier(type, artist, title, deadline, wants);
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
		// quick-261102-covgate: the SEARCH is title-only, but the identity gate still validates
		// against the full request pair — this fallback is the incident rung (it served a
		// different artist's cover for the OSN song), and a title-only search makes the gate
		// MORE necessary, not less: the artist half can now only come from validation.
		const titleOnly = await deezerTier(type, '', title, deadline, wants);
		if (titleOnly.kind === 'hit') return titleOnly.url;
		if (titleOnly.kind === 'error') sawError = true;
	}

	return sawError ? 'ERROR' : null;
}
