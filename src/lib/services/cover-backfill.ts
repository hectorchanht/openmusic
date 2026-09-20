// cover-backfill — the LAZY, concurrency-capped cover resolver that fills the cover-cache
// for discovery tiles that have no Last.fm image and no MusicBrainz mbid.
//
// quick-260607-0bb (supersedes wv8; rvy FIX-A is the original lazy/capped scaffold). This is the
// 4th attempt at the "most home tiles are color blocks" symptom. The root cause of the persistence
// was twofold: (a) a single-source (Deezer-only) miss stranded a tile as a gradient, and (b) the
// home only ever ATTEMPTED the first ~24 tracks / ~12 artists (fixed `max`), so every other tile
// stayed a gradient forever. This module fixes (a) by restoring a multi-tier fall-through chain and
// (b) by lifting the default cap (the home now passes a cap = the full gathered gradient set).
//
// MULTI-TIER CHAINS (stop at the first SOLID — non-empty, https — cover):
//  - TRACK: iTunes → Deezer → CN → YouTube Music.
//    quick-260920-nyq REORDER (partial revert of quick-260919-0mw's YTM-first, which was itself a
//    reorder of Deezer → iTunes → CN). The user delegated the RANK to us, to be decided on FETCH
//    SPEED and PICTURE SIZE. That ranking, and the reasoning behind each position:
//    - Tier 1 iTunes (itunesSongCover — no-auth, CORS-open DIRECT fetch to itunes.apple.com that
//      never touches our edge, soft-limited). FIRST because it is both the fastest hop and the
//      largest artwork in the chain (1200px).
//    - Tier 2 Deezer (deezerSongCover via the own-origin /api/deezer/search proxy — no key, no env
//      var, edge-cached, CORS-blocked direct so proxied). cover_xl is 1000px and the tier is
//      reliable. Fires ONLY on an iTunes miss.
//    - Tier 3 CN (searchAll with default prefs → dedupeBest[0].cover — the SAME resolver resolveStub
//      / picks / similar use; NO new endpoint, NO rate limit). Genuinely high quality WHEN PRESENT
//      (the user's own observation about qq art), but it is the SLOWEST tier (~2.7s upstream qq
//      detail, measured) and the one that misses most often, so it must not sit in front of two
//      faster, larger tiers. It still wins exactly where the user saw it winning: the CJK catalog
//      iTunes and Deezer do not carry falls through to it. There is deliberately NO qq-only tier —
//      this fan-out already contains qq and dedupeBest(…, preferredSource) already picks it.
//      Fires ONLY on an iTunes+Deezer miss. CAA-by-mbid stays a tileCover-level step.
//    - Tier 4 YouTube Music (searchAll with onlySource('ytmusic') → dedupeBest[0].cover — the SAME
//      resolver the CN tier uses, just pointed at one source, so there is NO new module and NO new
//      fetch path here). LAST because its art is the search-shelf thumbnail at 120x120 — frequently
//      a CHANNEL AVATAR rather than album art — on a Google host (yt3/lh3.googleusercontent.com,
//      i.ytimg.com) that CN-facing users routinely cannot load (see
//      .planning/debug/ytmusic-cover-blank-hero.md). It is kept as the last fall-through because it
//      does cover indie/CJK long-tail catalog nothing above it carries.
//  - ARTIST: Deezer → iTunes.  DELIBERATELY UNCHANGED by quick-260919-0mw and quick-260920-nyq —
//    both reorders were about SONG covers; YTM has no artist-picture endpoint worth a tier here.
//    - Tier 1 deezerArtistCover (real artist picture). Tier 2 itunesArtistCover (entity=album&
//      attribute=artistTerm → the artist's top-album cover as the artist-image proxy). Cached under
//      the ARTIST-only key (never collides with a track of the same name).
//  - LAST.FM tier note: the Last.fm tier is the CHEAP item.image pre-check ALREADY handled
//    synchronously in tileCover() (+page.svelte) — it is NOT a backfill network call here. A
//    Last.fm-imaged tile never reaches this resolver, so there is deliberately no Last.fm
//    track.getInfo backfill step (the optional album.getInfo last-resort is not worth the extra
//    call — we stop at CN).
//
// RATE-LIMIT / COST REASONING AFTER THE REORDER (quick-260920-nyq; supersedes the quick-260919-0mw
// note that tier-1 was an InnerTube POST through /api/ytmusic/search): tier-1 is again a direct
// CORS-open iTunes GET that never touches our edge — CHEAPER for us than either the YTM POST it
// replaces or the edge-cached Deezer GET that preceded that. Deezer/CN/YTM fire ONLY on a miss, so
// the deep chain runs rarely. Everything is bounded by the SAME machinery as before and needs NO new
// throttle: the CAP=6 in-flight pool below, the 5-minute negative-miss cache, the skip-already-cached
// gate, and — for the tiers that go through searchAll → the adapter → apiFetch — the outbound
// governor (GET dedupe, MAX_CONCURRENT_REQUESTS=8, 25s timeout, circuit breaker). A warm visit still
// issues ~0 requests. Do NOT add another limiter here.
//
// PER-TIER NEVER-THROW: each tier is wrapped so a throw in one tier falls through to the NEXT tier
// (not the whole-function catch); the outer try/catch is a backstop. The whole call never rejects.
//
// HTTPS-ONLY GUARD (T-0bb-01): the resolved URL is rendered as an `<img src>` attribute. Only a
// non-empty string starting with `https:` is treated as SOLID — an http/data/blank URL is a miss
// and falls through (or → gradient). Deezer is host-allow-listed to https *.dzcdn.net by its proxy,
// iTunes returns https mzstatic URLs, CN covers come through the existing pipeline; the guard is a
// cheap client-side backstop. Rendered as `<img src>` ONLY (never CSS url()) → no injection surface.
//
// LAZY (post-paint): callers fire-and-forget this AFTER first render — it never blocks the critical
//   path. A miss leaves the gradient (never a broken image, never a blocked first paint).
// CAPPED (T-0bb-02 self-DoS): at most CAP=6 resolves in flight via mapWithConcurrency (NOT
//   Promise.all over every row). Every resolver call is bounded by its own AbortSignal.timeout
//   (inside deezer.ts / itunes-cover.ts) — do NOT add another. The total `max` cap defaults high
//   (DEFAULT_MAX) so an unsupplied caller is not artificially throttled; the home passes an explicit
//   cap = its full gathered gradient set. Already-cached items are SKIPPED + names de-duped, so a
//   warm visit issues ~0 requests regardless of the high cap. Rate-limit math after quick-260920-nyq:
//   iTunes first (direct CORS-open GET, never touches our edge); Deezer/CN/YTM fire ONLY on an iTunes
//   miss, so the deep chain runs rarely.
// CACHED: a SOLID (https) resolved cover is written via setCachedCover / setCachedArtistCover; an
//   onResolved callback lets the page bump a reactive counter so each cover appears as it lands.
// NEVER throws: per-item failures degrade to null (like resolveStub / mapWithConcurrency).
import { searchAll } from '$lib/services/catalog';
import { dedupeBest } from '$lib/services/dedupe';
import { settings } from '$lib/stores/settings.svelte';
import {
	getCachedCover,
	setCachedCover,
	setCachedCoverByUid,
	coverCacheKey,
	getCachedArtistCover,
	setCachedArtistCover,
	artistCoverCacheKey
} from '$lib/services/cover-cache';
import { mapWithConcurrency } from '$lib/services/discovery';
import { deezerSongCover, deezerArtistCover, deezerSearchTopN } from '$lib/services/deezer';
import { itunesSongCover, itunesArtistCover } from '$lib/services/itunes-cover';
import { onlySource } from '$lib/sources/registry';
import type { Track } from '$lib/sources/types';
import { hasHttpsScheme } from './url-safety';

/** A cover-needing row — callers pass DiscoveryTrack rows (artist tiles are excluded). */
export interface CoverNeed {
	artist: string;
	title: string;
}

export interface BackfillOpts {
	/** Abort the remaining resolves (e.g. on unmount / a newer refresh). */
	signal?: AbortSignal;
	/** Called with (cacheKey, url) as each cover lands, so the page can re-render reactively. */
	onResolved?: (key: string, url: string) => void;
	/** Total cap on how many uncached items to resolve this call (default DEFAULT_MAX). */
	max?: number;
}

const CAP = 6; // ≤6 searches in flight (reuse mapWithConcurrency — do NOT Promise.all all rows)
// High default so an unsupplied caller is not artificially throttled — the home passes an explicit
// cap (= its full gathered gradient set). The CAP=6 pool + per-call timeout + skip-cached bound the
// cost regardless; a warm visit issues ~0 requests (every tile is already cached).
const DEFAULT_MAX = 400;

// ── NEGATIVE-MISS CACHE (debug-nowbar-frozen-audius-spam follow-up) ─────────────────────────────
// A cover search that finds NOTHING is deliberately NOT written to the cover-cache, so it retries
// (the cover-cache stale-URL design — failures must not pin "no result"). But because a miss was
// never REMEMBERED at all, every Home refresh/randomize re-ran the full Deezer→iTunes→CN fan-out for
// the SAME imageless tiles — the sustained /api/* flood (a cold, all-imageless Home = hundreds of
// searches, re-fired on every refresh). So remember a miss in a SESSION-SCOPED, short-TTL set. This
// is NOT the cover-cache: it stores NO url — only "we looked recently and found nothing" — so it can
// never serve a broken image (the concern that keeps failures out of the cover-cache). A repeat pass
// within MISS_TTL_MS skips the re-search; after the TTL — or a page reload, since this is in-memory
// and never persisted — it retries, preserving the "failures eventually retry" contract. A later
// SOLID hit clears the miss immediately so a now-resolvable tile is never skipped.
const MISS_TTL_MS = 5 * 60 * 1000; // 5 min — kills rapid refresh/randomize re-fires; still retries later
const missAt = new Map<string, number>();
function recentlyMissed(key: string): boolean {
	const t = missAt.get(key);
	if (t === undefined) return false;
	if (Date.now() - t < MISS_TTL_MS) return true;
	missAt.delete(key); // expired — allow a fresh retry on the next pass
	return false;
}
function markMiss(key: string): void {
	missAt.set(key, Date.now());
}
function markHit(key: string): void {
	missAt.delete(key); // recovered — never skip a now-resolvable tile
}
/** TEST-ONLY: clear the session-scoped negative-miss cache so it cannot leak across tests. */
export function __resetCoverMissCache(): void {
	missAt.clear();
}

// ── SHARE-CARD COVER MEMO (quick-260920-kn4, relocated here by quick-260920-l82) ────────────────
// SESSION MEMO for the share-card carrier chain: track.uid → the resolved https cover URL.
//
// MODULE scope, not instance scope: every list page mounts its OWN <TrackMenu>, so an instance
// field would re-issue the same iTunes GET each time the user crosses pages. The retained
// `itunes:<artworkKey>` ID family already persists 14 days in the cover cache, but the mzstatic
// URL that KEYS it is stored nowhere the UI is allowed to read (see resolveShareCover — writing it
// into the shared cover cache would change the art every row renders), so the URL itself is
// memoised here for the session.
//
// quick-260920-l82: it moved out of TrackMenu's `<script module>` because a service module is the
// natural cross-instance home — the memo belongs beside the chain it memoises, and every future
// share surface gets it for free instead of re-declaring a second Map.
//
// HITS ONLY. A miss or an abort is never memoised, so a transient iTunes failure does not stick
// for the rest of the session (CLAUDE.md: never cache a failure).
const shareCoverMemo = new Map<string, string>();
/** TEST-ONLY: clear the session-scoped share-cover memo so a hit cannot leak across tests. */
export function __resetShareCoverMemo(): void {
	shareCoverMemo.clear();
}


/**
 * Per-tier never-throw wrapper: a THROW in one tier falls through to the NEXT tier (returns null on
 * any throw); only a SOLID https result is returned, else null (treated as a miss → fall through).
 * Hoisted to module scope so both backfillCovers and the single-item resolveCoverForTrack reuse the
 * SAME tier mechanics (no duplicated fetch ladder).
 */
async function tier(fn: () => Promise<string | null>): Promise<string | null> {
	try {
		const url = await fn();
		return hasHttpsScheme(url) ? url : null;
	} catch {
		return null;
	}
}

/**
 * The YouTube Music cover tier (quick-260919-0mw), shaped EXACTLY like the CN tier below: the same
 * `searchAll → dedupeBest[0].cover` resolver, just aimed at one source via `onlySource('ytmusic')`
 * (registry.ts — it zeroes every other source explicitly, so a user-enabled source cannot leak into
 * a walk meant to touch one). No new module, no new endpoint, no new fetch: it inherits the apiFetch
 * governor and the adapter's own error handling for free. `signal` is threaded like every other tier.
 *
 * quick-260920-nyq: this tier is unchanged, but it is now the LAST tier of the chain rather than the
 * first, and it is no longer offered as an HQ upgrade at all — see the module header's rank.
 */
async function ytmusicSongCover(
	artist: string,
	title: string,
	signal?: AbortSignal
): Promise<string | null> {
	const r = await searchAll(`${artist} ${title}`, 1, onlySource('ytmusic'), signal);
	return dedupeBest(r.interleaved, settings.preferredSource)[0]?.cover ?? null;
}

/**
 * The shared TRACK tier chain: iTunes → (on miss) Deezer → (on miss) CN → (on miss) YouTube Music.
 * Stops at the first SOLID https cover; a non-https / empty result is a miss and falls through.
 * Returns the SOLID URL or null on a total miss. Never throws (per-tier never-throw + backstop).
 * This is the single source of truth for the track chain — resolveOne and resolveCoverForTrack
 * both call it so the tier order + https guard live in exactly one place (D-10).
 *
 * quick-260919-0mw: the order was Deezer → iTunes → CN; YTM was inserted at the FRONT.
 * quick-260920-nyq: YTM demoted from tier 1 to tier 4 and iTunes promoted to tier 1 — the rank is
 * now ordered on fetch speed + picture size; the full rationale per tier is in the module header.
 * Editing this one function moves every consumer — resolveCoverForTrack, backfillCovers.resolveOne,
 * lazyCover, the player's resolveCoverAsync and healCover all route through here.
 */
async function resolveTrackChain(
	artist: string,
	title: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	try {
		// Tier 1 — iTunes (PRIMARY: fastest hop, largest artwork). A SOLID hit is used as-is;
		// Deezer + CN + YTM are NOT issued.
		let cover = await tier(() => itunesSongCover(artist, title, signal));
		if (signal?.aborted) return null;

		// Tier 2 — Deezer (fires only on an iTunes miss).
		if (!cover) {
			cover = await tier(() => deezerSongCover(artist, title, signal));
			if (signal?.aborted) return null;
		}

		// Tier 3 — CN (existing resolver; fires only on an iTunes+Deezer miss). Slowest tier, but
		// the one that carries the CJK catalog the two above do not.
		if (!cover) {
			cover = await tier(async () => {
				// WR-01: thread `signal` (and explicit `{}` prefs) so the CN
				// fan-out is cancelled on supersede/unmount like the tiers above,
				// rather than running to completion on the abort path.
				const r = await searchAll(`${artist} ${title}`, 1, {}, signal);
				return dedupeBest(r.interleaved, settings.preferredSource)[0]?.cover ?? null;
			});
			if (signal?.aborted) return null;
		}

		// Tier 4 — YouTube Music (fires only on an iTunes+Deezer+CN miss — a 120px thumbnail on a
		// host many users cannot reach is a last resort, not a lead; quick-260920-nyq).
		if (!cover) {
			cover = await tier(() => ytmusicSongCover(artist, title, signal));
			if (signal?.aborted) return null;
		}

		return hasHttpsScheme(cover) ? cover : null;
	} catch {
		// Backstop — a miss leaves the gradient (never a broken image / never blocks).
		return null;
	}
}

/**
 * Single-item cover resolve helper (Plan 21-02, COVER-02) — the seam Plans 03/04/05 consume.
 *
 * Runs the SAME iTunes(1200) → Deezer → CN → YTM tier chain as backfillCovers (quick-260920-nyq;
 * was YTM → iTunes → Deezer → CN per quick-260919-0mw) via resolveTrackChain — reusing the shared
 * `tier()` never-throw wrapper + hasHttpsScheme guard, NOT a new fetch ladder.
 * Returns the first SOLID https URL or null on a total miss. NEVER throws.
 *
 * On a SOLID hit it writes the {artist,title} name layer always, and the uid layer ONLY when the
 * track carries a real uid (D-13 two-layer):
 *   setCachedCoverByUid(track.uid, url)  AND  setCachedCover(track.artist, track.title, url).
 * An EMPTY uid (synthetic discovery stub from charts/tags, charts/countries) MUST NOT write the uid
 * layer: that layer is a shared flat record keyed by `'uid:' + uid`, so an empty uid would store
 * every distinct row under the single `'uid:'` slot and the first row's cover would then read back
 * for ALL rows (the charts-tags-same-cover bug). The name layer is keyed by {artist,title} and
 * stays per-song, so an empty-uid stub still caches correctly under its own identity.
 * On a miss / non-https result nothing is cached (the caller keeps the gradient — T-0bb-01).
 */
export async function resolveCoverForTrack(
	track: Track,
	signal?: AbortSignal
): Promise<string | null> {
	const cover = await resolveTrackChain(track.artist ?? '', track.title ?? '', signal);
	if (hasHttpsScheme(cover)) {
		// Only a real uid writes the shared uid layer — an empty stub uid would collapse every row
		// onto one slot (charts-tags-same-cover fix). The name layer is always per-song-safe.
		if (track.uid) setCachedCoverByUid(track.uid, cover);
		setCachedCover(track.artist, track.title, cover);
		return cover;
	}
	return null;
}

/**
 * HQ cover UPGRADE (Plan 26-02, COVER-01) — the bounded, short counterpart to resolveCoverForTrack.
 * This is NOT the miss-recovery chain: it issues iTunes and, only on an iTunes miss, Deezer, and
 * NEVER touches YouTube Music or the CN `searchAll` tier. Purpose: a track that already painted from
 * its inline source cover (kuwo `pic` / qq `album_pic` / netease `pic`) can lazily, post-paint, pick
 * up higher-quality album art — the single OPTIONAL cover step in the click-to-play ~3-call budget.
 *
 * quick-260919-0mw: was `resolveDeezerHQ`, a single Deezer tier; it became YTM → Deezer.
 * quick-260920-nyq: YTM is REMOVED from the upgrade entirely, and iTunes leads. An "HQ upgrade" must
 * never replace a larger cover with a smaller one, and a YTM thumbnail's pixel size is NOT knowable
 * from its URL contract (`bestThumb` takes the largest LISTED size, which is a 120x120 search-shelf
 * image and often a channel AVATAR). Observed live on the hero: lastfm-300 → yt3-120 → lastfm-300,
 * with the 120px url written into the SHARED name cache layer. The lazy correct answer to "never
 * downgrade" is to not offer that tier as an upgrade at all, rather than to add a size oracle.
 *
 * T-26-02-01 IS PRESERVED: still bounded to the now-playing track by its caller, still at most 2
 * calls, still NEVER a per-tile fan-out and never the 7-source CN searchAll. The ONE change to that
 * guard's wording is that iTunes is now ALLOWED here — it is a direct CORS-open GET that never
 * touches our edge, i.e. cheaper than the YTM InnerTube POST it replaces.
 *
 * Reuses the SAME never-throw `tier()` wrapper + https guard as resolveTrackChain, so the
 * https-only render/cache guard (T-0bb-01 / T-26-02-02) lives in exactly one place. On a SOLID https hit
 * it writes the cache with the SAME posture as resolveCoverForTrack — the uid layer ONLY for a real uid
 * (an empty stub uid would collapse every row onto the shared `'uid:'` slot) plus the always-safe name
 * layer. The reactive `coverVersion()` bump is the CALLER's job (mirrors resolveCoverForTrack, which the
 * player's resolveCoverAsync/healCover follow with a separate bumpCoverVersion) so cover-backfill.ts
 * stays a pure `.ts` (no runes wrapper imported here). Never throws; honors an AbortSignal.
 */
export async function resolveHqCover(
	track: Track,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	// TWO TIERS — iTunes, then Deezer on a miss. YTM + CN are NEVER issued (upgrade, not a chain).
	let cover = await tier(() => itunesSongCover(track.artist ?? '', track.title ?? '', signal));
	if (signal?.aborted) return null;
	if (!cover) {
		cover = await tier(() => deezerSongCover(track.artist ?? '', track.title ?? '', signal));
		if (signal?.aborted) return null;
	}
	if (hasHttpsScheme(cover)) {
		// Mirror resolveCoverForTrack's write posture: real-uid uid layer + always-safe name layer.
		if (track.uid) setCachedCoverByUid(track.uid, cover);
		setCachedCover(track.artist, track.title, cover);
		return cover;
	}
	return null;
}

/**
 * SHARE-CARD CARRIER chain (quick-260920-l82, generalises quick-260920-kn4) — the THIRD sibling of
 * resolveCoverForTrack (miss-recovery: iTunes → Deezer → CN → YTM, WRITES the cache) and
 * resolveHqCover (upgrade: iTunes → Deezer, WRITES the cache). Same `tier()` never-throw wrapper and
 * the same `hasHttpsScheme` guard (T-0bb-01) — this is NOT a new fetch ladder, only a different
 * tier subset for a different question: "which cover can the share link actually CARRY?"
 *
 * WHY A DIFFERENT SUBSET. `coverToken` (share.ts) is a CLOSED grammar — `d:` Deezer, `l:` Last.fm,
 * `k:` kuwo, `i:` iTunes-by-retained-id. YouTube Music (lh3.googleusercontent.com / i.ytimg.com) is
 * EXCLUDED because it is not in that grammar: its artwork URLs are opaque irregular paths, and
 * widening the host set /api/og fetches is forbidden by T-3uo-02. That exclusion is the whole reason
 * this function exists — calling resolveTrackChain here would hand back the untokenizable YTM cover
 * and regress the card to the branded OpenMusic fallback. CN is excluded too: netease/qq/joox hosts
 * are on no /api/og allow-list, and a 7-source searchAll is far too expensive for a menu-open prewarm.
 *
 * WHY iTUNES FIRST: `itunesSongCover → fetchTopArtwork → rememberItunesId` retains the numeric id
 * against that URL in the DISJOINT `itunes:` cache family, so `recallItunesId` yields it at share
 * time and `coverToken` emits `i:<id>`. DEEZER SECOND is the quick-260920-l82 addition over kn4
 * (which issued iTunes only): a song iTunes does not carry now yields `d:<32hex>` instead of the
 * branded card. `deezerSongCover` returns `album.cover_*` only (`/images/cover/<32hex>/…` — artist
 * pictures live on a separate field), so its output always tokenizes; Deezer's art-less placeholder
 * has an empty md5, fails DZ_COVER_PATH and simply yields no carrier — the carrier is advisory and
 * the card falls through to today's server chain.
 *
 * quick-260920-nyq: the nyq reorder deliberately does NOT reach this function — `coverToken`
 * (share.ts) is a CLOSED `?ci=` host grammar and reordering the display chain silently killed
 * share-card art once already (YTM-first). Its iTunes → Deezer subset now happens to match the HEAD
 * of the display chain; that is COINCIDENCE, not coupling, so do not "deduplicate" the two later —
 * the display chain may be reranked again and this subset must not follow it. Pinned by a unit test
 * asserting zero `searchAll` calls from here.
 *
 * 🔴 THE ONE DIVERGENCE FROM ITS TWO SIBLINGS: this function MUST NOT write the uid or name layer of
 * the cover cache (no setCachedCoverByUid / setCachedCover / writeCoverBoth), and must not touch the
 * `missAt` negative cache (that one keys the DISPLAY chain by name and must not be poisoned by a
 * share-only probe). `activeCover` in TrackMenu reads readCoverByUidOrName, so caching this URL would
 * flip the art the app DISPLAYS — every list row and the hero — from the YTM cover to this one. The
 * ask was about the share card ONLY. The result lives in the caller's `$state` and the session memo
 * above, nowhere else. The `itunes:` id-family write inside itunesSongCover is fine: disjoint key
 * family, no display surface reads it. Pinned by the "NO cover-cache write on a hit" unit test.
 *
 * COST: at most 2 requests per menu open, 0 on a memo hit, 0 when the displayed cover already
 * tokenizes (the caller's guard). iTunes is a direct CORS-open GET; Deezer goes through the
 * own-origin proxy and inherits the apiFetch governor. Never throws; honors an AbortSignal.
 */
export async function resolveShareCover(
	track: Track,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	// HITS-ONLY memo, keyed by uid. An EMPTY uid is never memoised — that would collapse every
	// distinct stub onto one slot (the same posture the siblings take with the uid cache layer).
	if (track.uid) {
		const hit = shareCoverMemo.get(track.uid);
		if (hit) return hit;
	}
	let cover = await tier(() => itunesSongCover(track.artist ?? '', track.title ?? '', signal));
	if (signal?.aborted) return null;
	if (!cover) {
		cover = await tier(() => deezerSongCover(track.artist ?? '', track.title ?? '', signal));
		if (signal?.aborted) return null;
	}
	if (hasHttpsScheme(cover)) {
		if (track.uid) shareCoverMemo.set(track.uid, cover);
		return cover;
	}
	return null;
}

/**
 * Lazily resolve + cache real covers (track chain iTunes → Deezer → CN → YTM, quick-260920-nyq) for
 * the given {artist,title} rows.
 *
 * Skips any row already in the cover-cache (never re-searches a cached cover), slices the
 * remaining work to `max`, then resolves it through a concurrency-capped pool. Each SOLID (https,
 * non-empty) cover is written to the cache and surfaced via `onResolved`. Best-effort: never throws.
 */
export async function backfillCovers(items: CoverNeed[], opts: BackfillOpts = {}): Promise<void> {
	const { signal, onResolved, max = DEFAULT_MAX } = opts;

	// (1) Skip rows that already have a cached cover — repeat visits issue zero searches.
	const seen = new Set<string>();
	const remaining: CoverNeed[] = [];
	for (const it of items) {
		const artist = it.artist ?? '';
		const title = it.title ?? '';
		if (!artist && !title) continue;
		const key = coverCacheKey(artist, title);
		if (seen.has(key)) continue; // de-dupe identical rows across shelves
		seen.add(key);
		if (getCachedCover(artist, title)) continue; // already cached
		if (recentlyMissed(key)) continue; // searched recently, no cover found — don't re-fan the fan-out
		remaining.push({ artist, title });
	}

	// (2) Cap the total fan-out for a cold visit.
	const work = remaining.slice(0, Math.max(0, max));
	if (!work.length) return;

	// (3) resolveOne: run the SHARED iTunes → Deezer → CN → YTM chain (resolveTrackChain — same tier()
	//     never-throw + https guard); cache + notify only a SOLID https cover (quick-260607-0bb).
	async function resolveOne(item: CoverNeed): Promise<void> {
		if (signal?.aborted) return;
		const cover = await resolveTrackChain(item.artist, item.title, signal);
		if (signal?.aborted) return; // abort ≠ miss — never poison the negative cache on a supersede
		const key = coverCacheKey(item.artist, item.title);
		if (hasHttpsScheme(cover)) {
			setCachedCover(item.artist, item.title, cover);
			markHit(key);
			onResolved?.(key, cover);
		} else {
			markMiss(key); // no cover this pass — skip re-searching it for MISS_TTL_MS (kills the re-fire flood)
		}
	}

	await mapWithConcurrency(work, CAP, resolveOne);
}

/**
 * Lazily resolve + cache real ARTIST cover images (chain Deezer → iTunes) for the given names
 * (quick-260607-0bb).
 *
 * 熱門歌手 tiles never had a real cover source from Last.fm (artist art is deprecated → null). This
 * mirrors backfillCovers but resolves via the Deezer artist picture, then falls back to the iTunes
 * artist-image proxy on a miss, and stores under the ARTIST-only key: de-dupes names, skips already-
 * cached artists, slices to `max`, then runs the resolves through the same CAP=6 pool. Each SOLID
 * (https) image is cached + surfaced via onResolved (keyed by artistCoverCacheKey). Best-effort:
 * per-tier never-throw, whole call never rejects; a miss → gradient.
 */
export async function backfillArtistCovers(
	names: string[],
	opts: BackfillOpts = {}
): Promise<void> {
	const { signal, onResolved, max = DEFAULT_MAX } = opts;

	// (1) De-dupe + skip already-cached artists (warm visit issues zero requests).
	const seen = new Set<string>();
	const remaining: string[] = [];
	for (const raw of names) {
		const name = (raw ?? '').trim();
		if (!name) continue;
		const key = artistCoverCacheKey(name);
		if (seen.has(key)) continue;
		seen.add(key);
		if (getCachedArtistCover(name)) continue;
		if (recentlyMissed(key)) continue; // searched recently, no artist image found — skip the re-fan
		remaining.push(name);
	}

	// (2) Cap the total fan-out for a cold visit.
	const work = remaining.slice(0, Math.max(0, max));
	if (!work.length) return;

	// (3) resolveOneArtist: Deezer → (on miss) iTunes; stop at the first SOLID cover; cache +
	//     notify only a SOLID https image under the artist key.
	async function resolveOneArtist(name: string): Promise<void> {
		if (signal?.aborted) return;
		try {
			// Tier 1 — Deezer artist picture.
			let url = await tier(() => deezerArtistCover(name, signal));
			if (signal?.aborted) return;

			// Tier 2 — iTunes artist-image proxy (fires only on a Deezer miss).
			if (!url) {
				url = await tier(() => itunesArtistCover(name, signal));
				if (signal?.aborted) return;
			}

			const key = artistCoverCacheKey(name);
			if (hasHttpsScheme(url)) {
				setCachedArtistCover(name, url);
				markHit(key);
				onResolved?.(key, url);
			} else {
				markMiss(key); // no artist image this pass — skip re-searching for MISS_TTL_MS
			}
		} catch {
			// Backstop — a miss leaves the artist tile's gradient.
		}
	}

	await mapWithConcurrency(work, CAP, resolveOneArtist);
}

// ── COVER CANDIDATE COLLECTION (quick-260915-w4f) ───────────────────────────────────────────────
// The cover picker needs the OPPOSITE of resolveTrackChain: not the first solid cover, but EVERY
// cover the resolvers know, labelled by where it came from, so the user can choose. That is a
// different shape of work (parallel, enumerate-all) from the chain (sequential, stop-at-first), so
// it lives ALONGSIDE the chain and never inside it — the click-to-play fast path pays nothing for
// this feature and resolveTrackChain / resolveCoverForTrack / resolveHqCover are unchanged.
//
// It is called ONLY from the picker's tap handler, never on menu open — the same opt-in posture as
// the Play-from-source variant fan-out (T-26-10-02). Every candidate passes the https guard
// (T-0bb-01 / T-w4f-01); no new image origin is introduced (Deezer is host-allowlisted at the edge
// proxy, iTunes mzstatic and the CN covers are what every row already paints).

/** One offered cover: a https URL plus the tier/source that produced it (used as the grid label). */
export interface CoverCandidate {
	/** The https cover URL — rendered as an `<img src>` attribute, never CSS url() (T-rvy-01). */
	url: string;
	/** `'deezer'` | `'itunes'` | a SourceId (`'kuwo'`, `'qq'`, …) — the raw label the grid shows. */
	source: string;
}

// ponytail: hard cap of 12. The CN `interleaved` list alone can be dozens of rows, and 12 fills a
// 375px 3-column grid four rows deep — enough to choose from without an endless scroll of
// near-identical thumbnails. Raise it if users ask for more.
const MAX_CANDIDATES = 12;

// quick-260920-nyq: per-tier ceiling — 12 tiles / 3 multi-hit network tiers (YTM, Deezer, CN; the
// iTunes service exposes only its top hit). Before this the grid was single-tier: a live check of
// 知己知彼 / 王菲 showed 12 of 12 tiles from ytmusic, and Dracula / Tame Impala 11 of 12, so whatever
// the user picked was almost certainly a Google-hosted URL. A cap keeps the grid MIXED, which is the
// whole point of a picker. `own` is never capped — it is a single tile and it is what the user is
// looking at right now.
const PER_TIER_CAP = 4;

/**
 * Every https cover candidate for `track`, ordered own → iTunes → Deezer → CN → YTM, deduped by URL,
 * with each network tier capped at PER_TIER_CAP.
 *
 * quick-260919-0mw / quick-260920-nyq: the order mirrors resolveTrackChain's ranking so the picker
 * grid agrees with what the chain would have chosen on its own — which after nyq means YTM tiles
 * come LAST. `own` still leads (it is what the user is looking at).
 *
 * The four network tiers run in PARALLEL (unlike the chain's sequential fall-through) because the
 * picker wants all of them regardless of which ones hit; each is wrapped so one tier throwing or
 * timing out still yields the others. Returns [] on an aborted signal or a total miss. Never throws.
 */
export async function collectCoverCandidates(
	track: Track,
	signal?: AbortSignal
): Promise<CoverCandidate[]> {
	if (signal?.aborted) return [];
	const artist = track.artist ?? '';
	const title = track.title ?? '';
	const term = `${artist} ${title}`.trim();

	// Per-tier never-throw, mirroring `tier()` above but returning a LIST instead of a first hit.
	const safe = async (fn: () => Promise<CoverCandidate[]>): Promise<CoverCandidate[]> => {
		try {
			return await fn();
		} catch {
			return [];
		}
	};

	// quick-260920-nyq: the per-tier ceiling, applied to a tier's OWN list before the tiers are
	// concatenated — a cap applied after the merge would still let the first tier eat the grid.
	// The https filter moves up here so the cap counts RENDERABLE tiles, not rejected ones.
	const capTier = (hits: CoverCandidate[]): CoverCandidate[] =>
		hits.filter((c) => hasHttpsScheme(c.url)).slice(0, PER_TIER_CAP);

	const [ytmHits, itunesHit, deezerHits, cnHits] = await Promise.all([
		// quick-260919-0mw — the ytmusic tier, sourced exactly like the CN tier but pinned to one
		// source via onlySource(). Labelled 'ytmusic' so the grid names where each tile came from.
		safe(async () => {
			const r = await searchAll(term, 1, onlySource('ytmusic'), signal);
			return r.interleaved.map((t) => ({ url: t.cover ?? '', source: 'ytmusic' }));
		}),
		safe(async () => {
			const url = await itunesSongCover(artist, title, signal);
			// iTunes exposes only its top hit through this service (fetchTopArtwork is private), so
			// this tier contributes at most one candidate. Deferred: a multi-hit iTunes tier.
			return url ? [{ url, source: 'itunes' }] : [];
		}),
		safe(async () =>
			(await deezerSearchTopN(term, 5, signal)).map((h) => ({
				url: h.cover ?? '',
				source: 'deezer'
			}))
		),
		safe(async () => {
			const r = await searchAll(term, 1, {}, signal);
			// Every CN result carries its own `source`, so each source is labelled for free.
			return r.interleaved.map((t) => ({ url: t.cover ?? '', source: String(t.source) }));
		})
	]);

	// The track's own inline cover leads: it is what the user is looking at right now, so it should
	// be the first (and usually the pre-selected) tile. The rest follow the chain's tier ranking
	// (quick-260920-nyq: iTunes → Deezer → CN → YTM), each capped at PER_TIER_CAP. CN rows stay
	// self-labelled by source, so a qq cover shows as `qq`.
	const all: CoverCandidate[] = [
		{ url: track.cover ?? '', source: String(track.source ?? '') },
		...capTier(itunesHit),
		...capTier(deezerHits),
		...capTier(cnHits),
		...capTier(ytmHits)
	];

	const seen = new Set<string>();
	const out: CoverCandidate[] = [];
	for (const c of all) {
		if (!hasHttpsScheme(c.url)) continue; // T-w4f-01 — https only, empty/http is a miss
		if (seen.has(c.url)) continue; // same image from two tiers → keep the first (better label)
		seen.add(c.url);
		out.push(c);
		if (out.length >= MAX_CANDIDATES) break;
	}
	return out;
}
