// Similar-vibe queue builder (Phase 26, UPNEXT-01 — the single highest-impact API-call
// reduction in the phase: 56 → 1).
//
// PRIMARY path: Last.fm `track.getSimilar` (via /api/lastfm/similar-tracks) returns exact
// {artist, title} pairs pre-ranked by `match` in ONE call. Each pair maps to a lazy
// name-only stub Track (Plan 26-01's `resolveByName` marker) that resolves on play through
// the kuwo-first single source — NO per-item searchAll at build time. This replaces the old
// artist.getSimilar → 8× searchAll fan-out (8 artists × 7 sources = 56 /api/* calls, spike 003).
//
// FALLBACK path (REQUIRED, T-26-03-05): some newer CN songs have thin Last.fm scrobble data
// and track.getSimilar returns 0 (spike 002: 2/10 CN seeds dry). Then fall through to
// artist.getSimilar (getSimilarArtists) and resolve each candidate's top track SINGLE-source
// (kuwo-first) — NOT an 8-source searchAll per artist. Best-effort, never-throws.
//
// The Last.fm key stays server-side; this client module only ever sees the clean
// { tracks: [...] } / { artists: [...] } shapes (threat T-26-03-01).
import { searchAll } from '$lib/services/catalog';
import { dedupeBest } from '$lib/services/dedupe';
import { deezerRelatedArtists, deezerArtistRadio } from '$lib/services/deezer';
import { matchKey } from '$lib/services/match-key';
import { settings } from '$lib/stores/settings.svelte';
import { cached } from '$lib/services/ttl-cache';
import { apiFetch } from '$lib/services/api-base';
import { SOURCES, getEnabledAdapters } from '$lib/sources/registry';
import type { SourceId, Track } from '$lib/sources/types';

const SIMILAR_ARTIST_COUNT = 8; // fallback: how many similar artists to search (top N)
const FALLBACK_LIMIT = 20; // same-artist fallback cap (matches the Related tab)
const SIMILAR_TRACK_LIMIT = 20; // primary: how many similar TRACKS to build the Up-Next from
const TTL_SIMILAR = 6 * 60 * 60 * 1000; // 6h (lry-followup: similar sets are stable)

/**
 * Fetch artists similar to `artist`. Last.fm primary; on empty (no LASTFM_KEY, or Last.fm
 * dry/errored) fall through to Deezer's `artist/{id}/related` via /api/deezer/related
 * (quick-260607-jau — gives the no-key state a genuinely useful path). On both miss the
 * caller falls back to same-artist (today). Returns the clean name list (never throws).
 */
export async function getSimilarArtists(artist: string): Promise<string[]> {
	const clean = (artist ?? '').trim();
	if (!clean) return [];
	return cached(`lf:similar:${clean}|${SIMILAR_ARTIST_COUNT}`, TTL_SIMILAR, async () => {
		try {
			const res = await apiFetch(
				`/api/similar?artist=${encodeURIComponent(clean)}&limit=${SIMILAR_ARTIST_COUNT}`
			);
			const data = (await res.json()) as { artists?: string[] };
			if (data?.artists?.length) return data.artists;
		} catch {
			/* fall through to Deezer */
		}
		// jau: Deezer is the metadata-only fallback. Same shape, no secret.
		return deezerRelatedArtists(clean, SIMILAR_ARTIST_COUNT);
	});
}

/**
 * PRIMARY: one `track.getSimilar` call → the clean {artist,title,match}[] list, pre-ranked
 * by `match` (descending). Wrapped in the existing `cached()` TTL idiom keyed on artist+title
 * (excludeUids/seed filtering happens per-call OUTSIDE the cache, so the memoized value is
 * excludeUids-independent). Never-throws (→ [] on absent key / dry / error).
 */
async function fetchSimilarTracks(artist: string, title: string): Promise<Track[]> {
	const a = (artist ?? '').trim();
	const t = (title ?? '').trim();
	if (!a || !t) return [];
	return cached(`lf:simtracks:${a}|${t}|${SIMILAR_TRACK_LIMIT}`, TTL_SIMILAR, async () => {
		try {
			const res = await apiFetch(
				`/api/lastfm/similar-tracks?artist=${encodeURIComponent(a)}&track=${encodeURIComponent(t)}&limit=${SIMILAR_TRACK_LIMIT}`
			);
			const data = (await res.json()) as {
				tracks?: { artist?: string; title?: string; match?: number; image?: string }[];
			};
			return (data?.tracks ?? [])
				// Gap 3 (26-07): thread the endpoint's per-track https image into the stub cover so the
				// Up-Next tile paints without a per-song Deezer→iTunes→CN chain (nameStub https-guards it).
				.map((p) => nameStub((p.artist ?? '').trim(), (p.title ?? '').trim(), p.image))
				.filter((s): s is Track => s !== null);
		} catch {
			return [];
		}
	});
}

/**
 * The kuwo-FIRST primary source id, inherited from the registry order (RESOLVE-01) — no
 * source is NAMED here. Used only as the never-dispatched placeholder `source` on a name
 * stub (its songid carries the stable synthetic identity; resolveByName routes resolution
 * through resolveNameStub, so SOURCES[source].resolve is never called on it).
 */
function primarySourceId(): SourceId {
	return getEnabledAdapters({})[0]?.id ?? 'kuwo';
}

/**
 * Per-source prefs that restrict a `searchAll` to exactly ONE source, mirroring catalog.ts
 * `onlySource`. Every registered source is explicitly set false so none falls through
 * `getEnabledAdapters` to "enabled"; only `id` is flipped true, so a FALLBACK search resolves
 * through exactly ONE source — never the 8-source fan-out this phase deleted (spike 003).
 */
function onlySource(id: SourceId): Partial<Record<SourceId, boolean>> {
	const prefs: Partial<Record<SourceId, boolean>> = {};
	for (const sid of Object.keys(SOURCES) as SourceId[]) prefs[sid] = false;
	prefs[id] = true;
	return prefs;
}

/**
 * The source ladder for the fallback paths: EVERY enabled adapter, in registry order. Each RUNG is
 * still a strictly single-source search (onlySource); the ladder walks to the next rung ONLY when
 * the one above produced NOTHING, and returns on the first rung that yields. So the healthy path
 * costs exactly what it always did — the extra rungs are spent only when a source is dead.
 *
 * debug/upnext-diverse-fallback-kuwo-dead (2026-08-31): this replaces a hard pin to
 * `getEnabledAdapters({})[0]`. That pin made both fallback paths a single point of failure — when
 * kuwo's upstream TLS cert expired, `getEnabledAdapters({})[0]` was a source that could not answer
 * ANY query, so both paths returned empty for EVERY track and Up-Next silently collapsed to the
 * buildDiversePicks grab-bag. The registry reorder fixed that instance; the ladder fixes the class.
 *
 * NOT a return of the deleted 56-call fan-out (spike 003): that was N artists × ALL sources issued
 * CONCURRENTLY on every build. This is sequential, short-circuiting, and only ever reached after
 * Last.fm track.getSimilar AND Deezer artist radio have both come up dry.
 */
function sourceLadder(): SourceId[] {
	const ids = getEnabledAdapters({}).map((a) => a.id);
	return ids.length ? ids : [primarySourceId()];
}

/** A SOLID cover is a non-empty https string (mirrors player.svelte.ts `httpsOnly` / share.ts
 * `isHttpsUrl`; kept inline so similar.ts stays a PURE, node-testable .ts with no store import). */
function isHttps(url: string | null | undefined): url is string {
	return typeof url === 'string' && url.startsWith('https:');
}

/**
 * Build a lazy name-only stub Track from an exact {artist, title} pair (Plan 26-01's shape).
 * Carries the exact artist/title/keyword, `resolveByName: true` (so ensureTrackDetails resolves
 * it kuwo-first via resolveNameStub — never a per-item searchAll at build time), no audio / lrc
 * yet, and a STABLE synthetic uid derived from the normalized artist+title (matchKey). The uid is
 * COLON form (D-10) over a `similar-`-prefixed synthetic songid so it never collides with a real
 * numeric source songid, and same-song pairs collapse to one identity (dedupe/exclude work).
 * The `source` is a never-dispatched placeholder (see primarySourceId). Returns null for a
 * blank/incomplete pair so it is dropped.
 *
 * Gap 3 (26-07): `image` is the OPTIONAL Last.fm per-track cover from the endpoint. When it is a
 * SOLID https URL it seeds `cover` so the Up-Next tile paints without a per-song cover chain; a
 * missing / non-https value keeps cover:null (today's coverless-similar behavior, T-26-07-01).
 */
function nameStub(artist: string, title: string, image?: string | null): Track | null {
	if (!artist || !title) return null;
	const key = matchKey(artist, title); // `${norm(artist)}|${norm(title)}`, artist-first
	if (!key || key === '|') return null;
	const source = primarySourceId();
	const songid = `similar-${key}`;
	return {
		uid: `${source}:${songid}`,
		source, // placeholder — resolveByName short-circuits dispatch (never SOURCES[source].resolve)
		songid,
		title,
		artist,
		album: '',
		cover: isHttps(image) ? image : null, // Gap 3: seed the Last.fm https cover, else coverless
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: `${artist} ${title}`.trim(),
		displayIndex: 1,
		resolveByName: true // Plan 26-01: resolve kuwo-first through ONE source on play
	};
}

/**
 * Build the auto portion of Up-Next from songs similar in vibe/genre to `track`.
 *
 * PRIMARY (56→1): `track.getSimilar` → lazy name-only stubs (resolveByName), match-descending,
 * with the seed + excludeUids dropped and same-song dupes deduped. ZERO searchAll at build time.
 * FALLBACK (route dry): `artist.getSimilar` → resolve each artist's top track SINGLE-source
 * (kuwo-first) → dedupeBest → drop seed + excludeUids. Last resort: single-source same-artist
 * search (Related-tab behavior). NEVER an all-enabled 8-source fan-out on any path.
 *
 * Signature + never-throw/best-effort contract are backward-compatible so the player callers
 * (regenerate, ensureAhead) are untouched — the play() queue-swap already adopts a resolved
 * track's real uid via indexOf on resolve, so a synthetic→real uid change survives. The trailing
 * `report` param is OPTIONAL and additive (plan 26-09 opts in to log the up-next source).
 *
 * `report(via)` fires once on the terminal path: 'similar' (primary track.getSimilar produced
 * results), 'radio' (Deezer artist radio produced results), 'artist' (similar-artists fallback
 * produced results), 'lastresort' (same-artist search produced results), 'empty' (every path dry → []).
 */
export async function buildSimilarQueue(
	track: Track,
	excludeUids: Set<string> = new Set(),
	report?: (via: 'similar' | 'radio' | 'artist' | 'lastresort' | 'empty') => void
): Promise<Track[]> {
	// PRIMARY: the seed is a REAL track (real uid), while stubs carry SYNTHETIC uids — so the seed
	// cannot be dropped by uid. Drop it by normalized song identity instead; drop stubs by synthetic
	// uid (catches an already-queued unresolved stub / a swiped-away stub whose stable uid is in
	// excludeUids); dedupe same-song stubs by synthetic uid. (A resolved real track already in the
	// queue head carries a real uid, so it is not matched here — a bounded, documented dedup gap
	// vs. the old real-uid path; the player is intentionally not edited, per plan.)
	const stubs = await fetchSimilarTracks(track.artist, track.title);
	if (stubs.length) {
		const seedKey = matchKey(track.artist, track.title);
		const seen = new Set<string>();
		const out: Track[] = [];
		for (const s of stubs) {
			if (matchKey(s.artist, s.title) === seedKey) continue; // drop the seed song
			if (excludeUids.has(s.uid)) continue; // drop excluded (stable synthetic uid)
			if (seen.has(s.uid)) continue; // same-song dedupe
			seen.add(s.uid);
			out.push(s);
		}
		// CR-01 (26-REVIEW): gate on the POST-filter `out.length`, NOT the pre-filter `stubs.length`.
		// A thin/collision-heavy response whose every pair is the seed or already in excludeUids used
		// to `return out` (== []) here, leaving the working artist.getSimilar fallback below unused —
		// a silent empty Up-Next. Only short-circuit when the primary ACTUALLY produced candidates.
		if (out.length) {
			report?.('similar');
			return out; // already match-descending from the route
		}
		// else: primary was fully filtered → fall through to the artist.getSimilar fallback.
	}

	const keep = (t: Track) => t.uid !== track.uid && !excludeUids.has(t.uid);

	// SECOND PATH — Deezer artist RADIO (debug/upnext-diverse-fallback-kuwo-dead, 2026-08-31).
	// ONE upstream call returning a ready-made taste-based {artist,title} list, mapped through the
	// same nameStub as the Last.fm primary, so these stay lazy name stubs (no per-song search at
	// build time). It sits here because it is both CHEAPER and BETTER than the per-similar-artist
	// search below: that path spends one search per artist and can only ever surface each artist's
	// single most-popular song, while radio is an actual recommendation feed. Live-verified for the
	// reported seed (Drake): Future / Kanye West / Lil Baby / A$AP Rocky / Travis Scott / Young Thug.
	// Same seed/exclude/dedupe post-filter discipline as the primary (CR-01): only short-circuit
	// when this path ACTUALLY produced candidates, else fall through.
	const radioPairs = await deezerArtistRadio(track.artist, SIMILAR_TRACK_LIMIT);
	if (radioPairs.length) {
		const seedKey = matchKey(track.artist, track.title);
		const seen = new Set<string>();
		const radioOut: Track[] = [];
		for (const p of radioPairs) {
			const stub = nameStub((p.artist ?? '').trim(), (p.title ?? '').trim(), p.image);
			if (!stub) continue;
			if (matchKey(stub.artist, stub.title) === seedKey) continue; // drop the seed song
			if (excludeUids.has(stub.uid)) continue;
			if (seen.has(stub.uid)) continue;
			seen.add(stub.uid);
			radioOut.push(stub);
		}
		if (radioOut.length) {
			report?.('radio');
			return radioOut;
		}
	}

	// FALLBACK: same/similar-artist resolution. Each attempt is SINGLE-source — never a concurrent
	// fan-out — but it now walks every enabled adapter instead of pinning to one, so a single dead
	// upstream cannot take the whole feature down (see sourceLadder).
	const ladder = sourceLadder();

	const names = await getSimilarArtists(track.artist);
	if (names.length) {
		for (const sid of ladder) {
			const results = await Promise.allSettled(
				names.slice(0, SIMILAR_ARTIST_COUNT).map((n) => searchAll(n, 1, onlySource(sid)))
			);
			const tops: Track[] = [];
			for (const r of results) {
				if (r.status !== 'fulfilled') continue;
				const top = r.value.interleaved[0];
				if (top) tops.push(top);
			}
			// Mirror the CR-01 post-filter discipline: only short-circuit when similar-artists produced
			// a USABLE result; an empty artist result falls through to the NEXT ladder rung, then to the
			// same-artist last resort, so 'empty' genuinely means "every path dry on every rung"
			// (never a premature empty return).
			const artistOut = dedupeBest(tops, settings.preferredSource).filter(keep);
			if (artistOut.length) {
				report?.('artist');
				return artistOut;
			}
		}
	}

	// Last resort: single-source same-artist search (Related-tab behavior), same ladder discipline.
	for (const sid of ladder) {
		try {
			const r = await searchAll(track.artist, 1, onlySource(sid));
			const lastOut = dedupeBest(r.interleaved, settings.preferredSource)
				.filter(keep)
				.slice(0, FALLBACK_LIMIT);
			if (lastOut.length) {
				report?.('lastresort');
				return lastOut;
			}
		} catch {
			/* never-throw — try the next rung, then the empty terminal below */
		}
	}
	report?.('empty');
	return [];
}
