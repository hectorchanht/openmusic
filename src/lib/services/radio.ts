// Home "Your Radio" shelf (quick-260924-pgu) — seeds from the user's PLAY HISTORY and returns
// similar-but-unheard songs. It reuses the Up-Next similarity primitives (Last.fm
// track.getSimilar via fetchSimilarTracks, Deezer artist radio as the dry-seed fallback), so the
// tiles are lazy `nameStub` Tracks: never a searchAll fan-out, and no audio URL is resolved for a
// tile until the user taps it.
//
// Pure module: no runes, no `$state` — the two decision functions are node-Vitest-testable.
import type { HistoryEntry } from '$lib/history/history-logic';
import type { Track } from '$lib/sources/types';
import { matchKey } from '$lib/services/match-key';
import { mapWithConcurrency } from '$lib/services/discovery';
import { fetchSimilarTracks, nameStub } from '$lib/services/similar';
import { deezerArtistRadio } from '$lib/services/deezer';

// 4 seeds x at most 2 calls each (Last.fm, + Deezer only on a dry seed) = the whole cost of the
// shelf. 2 in flight so a cold home mount's tag/country fan-out is not starved (Pitfall 11 /
// apiFetch MAX_CONCURRENT_REQUESTS=8).
export const RADIO_SEEDS = 4;
const SEED_CONCURRENCY = 2;

/** The `n` most recent history entries with DISTINCT artists (case/space-insensitive); an entry
 *  with a blank artist or title is skipped. `entries` is already most-recent-first. */
export function pickRadioSeeds(entries: HistoryEntry[], n = RADIO_SEEDS): HistoryEntry[] {
	const out: HistoryEntry[] = [];
	const artists = new Set<string>();
	for (const e of entries) {
		if (out.length >= n) break;
		const artist = (e.artist ?? '').trim().toLowerCase();
		if (!artist || !(e.title ?? '').trim() || artists.has(artist)) continue;
		artists.add(artist);
		out.push(e);
	}
	return out;
}

/** Round-robin across the per-seed lists (so one seed's long list cannot crowd out the others),
 *  dropping every already-heard song (by matchKey) and repeat uids, stopping at `cap`. */
export function mergeRadio(lists: Track[][], heardKeys: Set<string>, cap: number): Track[] {
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
 */
export async function buildRadio(entries: HistoryEntry[], cap: number): Promise<Track[]> {
	const seeds = pickRadioSeeds(entries);
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
	return mergeRadio(lists.map((l) => l ?? []), heard, cap);
}
