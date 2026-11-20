// Offline up-next builder (PLAY-09 / D-07). When navigator.onLine is false, the player switches
// up-next to the user's downloaded tracks so playback keeps going with no network (D-07). This is
// a PURE, synchronous, never-throw builder (mirrors picks.ts / similar.ts: a service that takes its
// inputs and returns Track[], importing no UI and no player). The player's runFallback offline gate
// (handleOffline) feeds it `library.downloads` + the already-seen uid set and writes the result
// through dedupeBest into the queue. Playability is implicit — these are registry-confirmed
// downloads; the actual blob resolution + the single cachedBlobUrl revoke discipline (Pitfall 13)
// stay in the player's existing offline-blob play path.
import type { Track } from '$lib/sources/types';

/**
 * Build the offline up-next from the downloads registry. Returns the downloaded tracks NOT already
 * in `have` (the current queue/played set), preserving the registry order — `library.addDownload`
 * prepends, so the list is most-recent-download-first, which is a sensible default order for an
 * offline session (CONTEXT leaves ordering to discretion). Pure + never throws.
 *
 * @param downloads the library Downloads list (Track[], registry order = most-recent-first)
 * @param have uids already accounted for (current track + queue) to exclude from the switch
 */
export function buildOfflineQueue(downloads: Track[], have: Set<string> = new Set()): Track[] {
	if (!Array.isArray(downloads) || downloads.length === 0) return [];
	const seen = new Set<string>();
	const out: Track[] = [];
	for (const t of downloads) {
		if (!t?.uid) continue;
		if (have.has(t.uid)) continue;
		if (seen.has(t.uid)) continue; // intra-list dedupe (registry should already be unique)
		seen.add(t.uid);
		out.push(t);
	}
	return out;
}
