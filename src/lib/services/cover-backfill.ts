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
//  - TRACK: Deezer → iTunes → CN.
//    - Tier 1 Deezer (deezerSongCover via the own-origin /api/deezer/search proxy — no key, no env
//      var, edge-cached, CORS-blocked direct so proxied). A Deezer hit is used AS-IS; iTunes + CN
//      are NOT issued. Deezer is tier-1 so a cold visit is mostly edge-cached Deezer (≤~50 req/5s).
//    - Tier 2 iTunes (itunesSongCover — no-auth, CORS-open direct fetch to itunes.apple.com, soft-
//      limited). Fires ONLY on a Deezer miss, so it runs for a minority of tiles. Restored from
//      6c44889 (wv8 deleted it; it built + passed before).
//    - Tier 3 CN (searchAll → dedupeBest[0].cover — the SAME resolver resolveStub / picks / similar
//      use; NO new endpoint, NO rate limit). Fires ONLY on a Deezer+iTunes miss → deep-chain calls
//      are rare. CAA-by-mbid stays a tileCover-level step (an <img> 404 → gradient), NOT here.
//  - ARTIST: Deezer → iTunes.
//    - Tier 1 deezerArtistCover (real artist picture). Tier 2 itunesArtistCover (entity=album&
//      attribute=artistTerm → the artist's top-album cover as the artist-image proxy). Cached under
//      the ARTIST-only key (never collides with a track of the same name).
//  - LAST.FM tier note: the user's chain is "Deezer → iTunes → CN → Last.fm". The Last.fm tier is
//    the CHEAP item.image pre-check ALREADY handled synchronously in tileCover() (+page.svelte) —
//    it is NOT a backfill network call here. A Last.fm-imaged tile never reaches this resolver, so
//    there is deliberately no Last.fm track.getInfo backfill step (the optional album.getInfo last-
//    resort is not worth the extra call — we stop at CN).
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
//   warm visit issues ~0 requests regardless of the high cap. Rate-limit math: Deezer first (edge-
//   cached, ≤~50 req/5s); iTunes/CN fire ONLY on a Deezer miss, so the deep chain runs rarely.
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
import { deezerSongCover, deezerArtistCover } from '$lib/services/deezer';
import { itunesSongCover, itunesArtistCover } from '$lib/services/itunes-cover';
import type { Track } from '$lib/sources/types';

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

/** SOLID = a non-empty https URL (the only thing safe to render as an <img src> + cache). */
function isSolidCover(url: string | null | undefined): url is string {
	return typeof url === 'string' && url.startsWith('https:');
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
		return isSolidCover(url) ? url : null;
	} catch {
		return null;
	}
}

/**
 * The shared TRACK tier chain: Deezer → (on miss) iTunes → (on miss) CN (searchAll → dedupeBest[0]).
 * Stops at the first SOLID https cover; a non-https / empty result is a miss and falls through.
 * Returns the SOLID URL or null on a total miss. Never throws (per-tier never-throw + backstop).
 * This is the single source of truth for the track chain — resolveOne and resolveCoverForTrack
 * both call it so the Deezer→iTunes→CN order + https guard live in exactly one place (D-10).
 */
async function resolveTrackChain(
	artist: string,
	title: string,
	signal?: AbortSignal
): Promise<string | null> {
	if (signal?.aborted) return null;
	try {
		// Tier 1 — Deezer (PRIMARY). A SOLID hit is used as-is; iTunes + CN are NOT issued.
		let cover = await tier(() => deezerSongCover(artist, title, signal));
		if (signal?.aborted) return null;

		// Tier 2 — iTunes (fires only on a Deezer miss).
		if (!cover) {
			cover = await tier(() => itunesSongCover(artist, title, signal));
			if (signal?.aborted) return null;
		}

		// Tier 3 — CN (existing resolver; fires only on a Deezer+iTunes miss).
		if (!cover) {
			cover = await tier(async () => {
				const r = await searchAll(`${artist} ${title}`, 1);
				return dedupeBest(r.interleaved, settings.preferredSource)[0]?.cover ?? null;
			});
			if (signal?.aborted) return null;
		}

		return isSolidCover(cover) ? cover : null;
	} catch {
		// Backstop — a miss leaves the gradient (never a broken image / never blocks).
		return null;
	}
}

/**
 * Single-item cover resolve helper (Plan 21-02, COVER-02) — the seam Plans 03/04/05 consume.
 *
 * Runs the SAME Deezer → iTunes(1200) → CN tier chain as backfillCovers (via resolveTrackChain,
 * the shared `tier()` never-throw wrapper + isSolidCover https guard — NOT a new fetch ladder).
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
	if (isSolidCover(cover)) {
		// Only a real uid writes the shared uid layer — an empty stub uid would collapse every row
		// onto one slot (charts-tags-same-cover fix). The name layer is always per-song-safe.
		if (track.uid) setCachedCoverByUid(track.uid, cover);
		setCachedCover(track.artist, track.title, cover);
		return cover;
	}
	return null;
}

/**
 * Lazily resolve + cache real covers (track chain Deezer → iTunes → CN) for the given
 * {artist,title} rows.
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
		remaining.push({ artist, title });
	}

	// (2) Cap the total fan-out for a cold visit.
	const work = remaining.slice(0, Math.max(0, max));
	if (!work.length) return;

	// (3) resolveOne: run the SHARED Deezer → iTunes → CN chain (resolveTrackChain — same tier()
	//     never-throw + https guard); cache + notify only a SOLID https cover (quick-260607-0bb).
	async function resolveOne(item: CoverNeed): Promise<void> {
		if (signal?.aborted) return;
		const cover = await resolveTrackChain(item.artist, item.title, signal);
		if (signal?.aborted) return;
		if (isSolidCover(cover)) {
			setCachedCover(item.artist, item.title, cover);
			onResolved?.(coverCacheKey(item.artist, item.title), cover);
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

			if (isSolidCover(url)) {
				setCachedArtistCover(name, url);
				onResolved?.(artistCoverCacheKey(name), url);
			}
		} catch {
			// Backstop — a miss leaves the artist tile's gradient.
		}
	}

	await mapWithConcurrency(work, CAP, resolveOneArtist);
}
