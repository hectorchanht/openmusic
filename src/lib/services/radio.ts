// Home "Your Radio" shelf (quick-260924-pgu) — seeds from the user's PLAY HISTORY and returns
// similar-but-unheard songs. It reuses the Up-Next similarity primitives (Last.fm
// track.getSimilar via fetchSimilarTracks, Deezer artist radio as the dry-seed fallback), so the
// tiles are lazy `nameStub` Tracks: never a searchAll fan-out, and no audio URL is resolved for a
// tile until the user taps it.
//
// quick-260926-lw8 — randomized per session: the seeds are a random SAMPLE of the SEED_WINDOW most
// recent distinct artists (not simply the newest RADIO_SEEDS), and each seed's similar list is
// shuffled within its top RADIO_POOL before the round-robin merge. Every draw comes from one
// module-scope session seed, so the shelf is stable for the app session, new on relaunch, and new
// when the home Randomize button calls reseedRadio(). Zero extra upstream calls: the sampling runs
// on lists that were fetched anyway.
//
// Pure module: no runes, no `$state` — the two decision functions are node-Vitest-testable.
import type { HistoryEntry } from '$lib/history/history-logic';
import type { Track } from '$lib/sources/types';
import { matchKey } from '$lib/services/match-key';
import { mapWithConcurrency } from '$lib/services/discovery';
import { fetchSimilarTracks, nameStub } from '$lib/services/similar';
import { deezerArtistRadio } from '$lib/services/deezer';
import { shuffle, seededRng } from '$lib/services/shuffle';

// 4 seeds x at most 2 calls each (Last.fm, + Deezer only on a dry seed) = the whole cost of the
// shelf. 2 in flight so a cold home mount's tag/country fan-out is not starved (Pitfall 11 /
// apiFetch MAX_CONCURRENT_REQUESTS=8).
export const RADIO_SEEDS = 4;
const SEED_CONCURRENCY = 2;

// quick-260926-lw8 — the recent distinct-artist window the seeds are sampled from. The recency bias
// IS the window: any of the last 20 artists can seed the shelf, nothing older.
export const SEED_WINDOW = 20;
// quick-260926-lw8 — the head of each seed's similar list the picks come from, never the tail.
// ponytail: uniform shuffle within the head window; upgrade to rank-weighted sampling without
// replacement if tail picks ever look off-taste.
export const RADIO_POOL = 30;

// quick-260926-lw8 — one draw per app SESSION (R3). The module loads once per page load, so a
// relaunch = a new seed and an SPA nav / tab switch = the same seed (same shelf); the home Randomize
// button calls reseedRadio() and then rebuilds.
function newSeed(): number {
	return (Math.random() * 0x100000000) >>> 0;
}
let sessionSeed = newSeed();

/** Draw a fresh session seed — the next buildRadio() without an explicit rng samples anew. */
export function reseedRadio(): void {
	sessionSeed = newSeed();
}

/** The `n` most recent history entries with DISTINCT artists (case/space-insensitive); an entry
 *  with a blank artist or title is skipped. `entries` is already most-recent-first.
 *  quick-260926-lw8: with an `rng`, `n` entries are instead randomly SAMPLED from the
 *  max(n, SEED_WINDOW) most recent distinct-artist entries; without one, the deterministic newest-n. */
export function pickRadioSeeds(
	entries: HistoryEntry[],
	n = RADIO_SEEDS,
	rng?: () => number
): HistoryEntry[] {
	const want = rng ? Math.max(n, SEED_WINDOW) : n;
	const out: HistoryEntry[] = [];
	const artists = new Set<string>();
	for (const e of entries) {
		if (out.length >= want) break;
		const artist = (e.artist ?? '').trim().toLowerCase();
		if (!artist || !(e.title ?? '').trim() || artists.has(artist)) continue;
		artists.add(artist);
		out.push(e);
	}
	return rng ? shuffle(out, rng).slice(0, n) : out;
}

/** Round-robin across the per-seed lists (so one seed's long list cannot crowd out the others),
 *  dropping every already-heard song (by matchKey) and repeat uids, stopping at `cap`.
 *  quick-260926-lw8: with an `rng`, each list is first cut to its top RADIO_POOL and shuffled (a
 *  COPY — the caller's list is never mutated); the loop below is unchanged either way. */
export function mergeRadio(
	lists: Track[][],
	heardKeys: Set<string>,
	cap: number,
	rng?: () => number
): Track[] {
	if (rng) lists = lists.map((l) => shuffle(l.slice(0, RADIO_POOL), rng));
	const out: Track[] = [];
	const seen = new Set<string>();
	const longest = Math.max(0, ...lists.map((l) => l.length));
	for (let i = 0; i < longest && out.length < cap; i++) {
		for (const list of lists) {
			if (out.length >= cap) break;
			const t = list[i];
			if (!t || seen.has(t.uid) || heardKeys.has(matchKey(t.artist, t.title))) continue;
			seen.add(t.uid);
			out.push(t);
		}
	}
	return out;
}

/**
 * Build the shelf. [] on empty history (zero requests). Never throws: both upstream helpers are
 * never-throw and mapWithConcurrency never rejects (a failed slot is `undefined` → []).
 *
 * ponytail: no localStorage cache — fetchSimilarTracks/deezerArtistRadio are cached() 6h in memory,
 * so SPA navs are free and a hard reload costs <= RADIO_SEEDS x 2 edge-cached calls; persist a uid
 * set like LibraryShelfCache if cold-mount latency ever shows.
 *
 * quick-260926-lw8: `rng` defaults to a FRESH seeded rng over the session seed per call, so every build in a
 * session replays the same draw for the same history (a history that grew between mounts
 * legitimately changes the heard set). The per-seed fetch body and SEED_CONCURRENCY are untouched —
 * the budget stays <= RADIO_SEEDS x 2 (R2).
 */
export async function buildRadio(
	entries: HistoryEntry[],
	cap: number,
	rng: () => number = seededRng(sessionSeed)
): Promise<Track[]> {
	const seeds = pickRadioSeeds(entries, RADIO_SEEDS, rng);
	if (!seeds.length) return [];
	// Every song the user has already played is dropped, seeds included.
	const heard = new Set(entries.map((e) => matchKey(e.artist, e.title)));
	const lists = await mapWithConcurrency(seeds, SEED_CONCURRENCY, async (s) => {
		const lf = await fetchSimilarTracks(s.artist, s.title);
		if (lf.length) return lf;
		const pairs = await deezerArtistRadio(s.artist, cap);
		return pairs
			.map((p) => nameStub((p.artist ?? '').trim(), (p.title ?? '').trim(), p.image))
			.filter((t): t is Track => t !== null);
	});
	return mergeRadio(lists.map((l) => l ?? []), heard, cap, rng);
}
