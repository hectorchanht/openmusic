// artist-image — THE one artist-image resolver (quick-261121-canon, brief §2.3 / Phase 1).
//
// Before this module, artist images ran through three disconnected pipelines and the search
// pipeline's only Deezer leg (deezerArtistCover) looked at track-search hit #1's artist
// picture and nothing else: when hit #1 was a collaboration by another artist (the Megan
// Thee Stallion case — Maroon 5's "Beautiful Mistakes" tops her Deezer search), the identity
// gate correctly refused the stranger's photo, the resolver never looked further, and the
// resulting null was cached for 7 days. This resolver is the single path every tile surface
// now shares. Order (first hit wins):
//
//   0. PIN        — the ArtistRecord's user pin (fixes every surface at once).
//   1. RECORD     — the record's chosen image: a positive resolution persists FOREVER, so a
//                   once-resolved artist renders offline with zero network (Hector
//                   2026-11-21: "cache forever and offline ok").
//   2. SHARED     — the cover-cache artist family Home already reads/writes
//                   (getCachedArtistCover) — an image resolved anywhere serves everywhere.
//   3. DEEZER     — Deezer ARTIST search (deezerArtist → /api/deezer/artist, the endpoint
//      ARTIST       that actually carries artist pictures, with the record's aliases).
//   4. HIT SCAN   — scan the track-search hits for one whose artist IS the requested artist
//                   (the isCoverOf identity gate, artist-only) and take THAT hit's picture.
//   5. LAST.FM    — enrichArtist's lastfmArt (placeholder-filtered upstream; ~always null).
//
// A success is written to BOTH the record (forever) and the shared cache, so search and home
// serve each other's resolutions. A total miss is negative-memoised for 1 hour under the
// canonical artist key — never 7 days, never under a raw spelling. Transient failures are
// never memoised (the next call retries). Never throws: a miss returns null and the caller
// keeps its gradient.

import { getCachedArtistCover, setCachedArtistCover } from './cover-cache';
import { deezerArtist, deezerSearchTopN, downsizeDeezerCover } from './deezer';
import { enrichArtist } from './lastfm';
import { isCoverOf } from './song-variant';
import { getArtistRecord, recordArtistImage, artistRecordKey } from './artist-record';

const NEG_TTL_MS = 60 * 60 * 1000; // 1h — a miss self-heals quickly, per the brief
const negUntil = new Map<string, number>();
const inflight = new Map<string, Promise<string | null>>();

/** Test seam (mirrors ttl-cache's __clearSearchCache): drop negative memos + in-flight state. */
export function __clearArtistImageState(): void {
	negUntil.clear();
	inflight.clear();
}

async function resolveLegs(
	name: string,
	signal?: AbortSignal
): Promise<{ url: string; source: string } | null> {
	const rec = getArtistRecord(name);
	// Leg 3 — Deezer artist search (the dedicated artist endpoint). The record's aliases +
	// canonical name ride along so the proxy's best-artist pick counts any known spelling.
	const aliases = [...(rec?.aliases ?? []), ...(rec?.canonicalName ? [rec.canonicalName] : [])];
	const info = await deezerArtist(name, signal, aliases).catch(() => null);
	const fromArtistSearch = downsizeDeezerCover(info?.picture ?? null) ?? info?.picture ?? null;
	if (fromArtistSearch) return { url: fromArtistSearch, source: 'deezer-artist' };
	if (signal?.aborted) return null;
	// Leg 4 — hit scan: any hit whose artist IS the requested one (gate), not just hit #1.
	const hits = await deezerSearchTopN(name, 10, signal).catch(() => []);
	for (const hit of hits) {
		const pic = hit.artistPicture ?? null;
		if (pic && isCoverOf({ artist: name, title: '' }, { artist: hit.artist })) {
			return { url: downsizeDeezerCover(pic) ?? pic, source: 'deezer-hit' };
		}
	}
	if (signal?.aborted) return null;
	// Leg 5 — Last.fm (its artist art is placeholder-filtered on the edge; kept for parity
	// with the historic LF-primary chain and for the rare artist it does cover).
	const lf = await enrichArtist(name).catch(() => null);
	return lf?.lastfmArt ? { url: lf.lastfmArt, source: 'lastfm' } : null;
}

/**
 * Resolve the canonical image for an artist name (any spelling). See the module header for
 * the leg order. `opts.force` bypasses the negative memo (the point-of-use force refresh).
 * Concurrent calls for the same artist share one in-flight resolution.
 */
export async function resolveArtistImage(
	name: string,
	signal?: AbortSignal,
	opts: { force?: boolean } = {}
): Promise<string | null> {
	const clean = (name ?? '').trim();
	if (!clean || signal?.aborted) return null;
	// Leg 0 — the record pin.
	const rec = getArtistRecord(clean);
	if (rec?.image.pin) return rec.image.pin;
	// Leg 1 — the record's forever layer (offline-safe).
	if (rec?.image.chosen) return rec.image.chosen;
	// Leg 2 — the shared artist cache (Home's family; search joins it here).
	const shared = getCachedArtistCover(clean);
	if (shared) {
		// Adopt into the record so the forever layer holds it too (provenance: the cache).
		recordArtistImage(clean, shared, 'cache');
		return shared;
	}
	const key = artistRecordKey(clean);
	if (!opts.force) {
		const until = negUntil.get(key);
		if (until && until > Date.now()) return null;
		const pending = inflight.get(key);
		if (pending) return pending;
	} else {
		negUntil.delete(key);
	}
	const run = (async () => {
		const found = await resolveLegs(clean, signal).catch(() => null);
		if (found) {
			recordArtistImage(clean, found.url, found.source);
			setCachedArtistCover(clean, found.url);
			negUntil.delete(key);
			return found.url;
		}
		// Total miss on a COMPLETED walk → 1h negative memo under the canonical key. (A
		// walk cut short by abort does not memoise: the caller cancelled, nothing was proven.)
		if (!signal?.aborted) negUntil.set(key, Date.now() + NEG_TTL_MS);
		return null;
	})();
	inflight.set(key, run);
	try {
		return await run;
	} finally {
		if (inflight.get(key) === run) inflight.delete(key);
	}
}
