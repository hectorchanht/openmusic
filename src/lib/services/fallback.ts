// Cross-source playback fallback (gte / SRC-FB-01). When a track fails to play on its native
// source (no audioUrl, region-block, expired URL, audio `error` event), this helper searches the
// OTHER enabled sources for the same {artist,title}, picks the best deduped candidate, resolves
// its audio URL, and returns it. The player store calls this from play() / the audio error
// listener; on a null return (all sources exhausted) the existing player.error surfaces.
//
// Reuses the same primitives as resolveStub: searchAll → dedupeBest → ensureTrackDetails. The
// source-filtering happens by passing per-call `prefs` to searchAll so each attempt fans out to
// exactly ONE source — keeping the per-source attempts cheap and isolating any source failure.

import { searchAll, ensureTrackDetails } from '$lib/services/catalog';
import { dedupeBest, sameSongKey } from '$lib/services/dedupe';
import { getEnabledAdapters, SOURCES } from '$lib/sources/registry';
import type { SourceId, Track } from '$lib/sources/types';

/**
 * Build the ordered list of source ids to try as a fallback, given the source that just failed.
 * Drops the failed source AND every source in `attempted` (sources already tried for this logical
 * song — CR-03); surfaces `preferred` first when set. Pure — exported for testability.
 *
 * ORDER INHERITANCE (POLICY.md / spikes 001+004): the base order is `getEnabledAdapters({})` order,
 * which is the registry SOURCES literal order — now kuwo-first. So with no `preferred` set, failover
 * walks kuwo → qq → netease → joox → (fivesing → jamendo → audius). An explicit user
 * `settings.preferredSource`, threaded in as `preferred`, still wins (hoisted first) over the
 * kuwo default. This function names NO source itself — reorder the registry to change the floor.
 *
 * `attempted` prevents the unbounded A↔B ping-pong where a resolve-but-unplayable source (URL
 * resolves, the <audio> 403s) keeps being re-offered because fallbackOrder only excluded the
 * single source that just failed: once A-netease and A-qq have both been tried for one song, both
 * are excluded so the order empties and the caller routes to total-failure (the counter engages).
 */
export function fallbackOrder(
	failed: SourceId,
	preferred?: SourceId,
	attempted?: ReadonlySet<SourceId>
): SourceId[] {
	const enabled = getEnabledAdapters({}).map((a) => a.id);
	const remaining = enabled.filter((s) => s !== failed && !attempted?.has(s));
	if (preferred && remaining.includes(preferred)) {
		return [preferred, ...remaining.filter((s) => s !== preferred)];
	}
	return remaining;
}

/**
 * Per-source prefs object that limits searchAll to a single source id. Derived from the registry
 * (SOURCES) so it covers EVERY registered source — explicitly defaulting each to false and then
 * flipping only `id` to true. getEnabledAdapters honors an explicit `prefs[id]` over user/default
 * enablement, so any source NOT present in this object would otherwise fall through to "enabled"
 * and leak into a supposedly single-source fallback. Building from SOURCES keeps this correct as
 * sources are added (e.g. fivesing/jamendo) without re-listing ids by hand (D-08 isolation).
 */
function onlySource(id: SourceId): Partial<Record<SourceId, boolean>> {
	const out: Partial<Record<SourceId, boolean>> = {};
	for (const sourceId of Object.keys(SOURCES) as SourceId[]) {
		out[sourceId] = false;
	}
	out[id] = true;
	return out;
}

/**
 * Try to find a playable equivalent of `failed` on another enabled source. Returns the resolved
 * Track (audioUrl truthy) from the first source that yields one, or null when every remaining
 * source has been tried unsuccessfully. Never throws — all per-source failures are swallowed
 * (the failure-to-find IS the fallback's signal).
 *
 * `signal` aborts the in-flight searchAll/ensureTrackDetails when a newer play() supersedes; the
 * caller is responsible for bumping its generation and aborting the controller.
 *
 * `attempted` (CR-03) carries the sources already tried for THIS logical song across the fallback
 * episode. fallbackOrder excludes every member, so a resolve-but-unplayable source is never
 * re-offered within the same episode; once the order empties this returns null (total failure) and
 * the caller's loop-guard counter engages — closing the unbounded A↔B ping-pong. Each source this
 * call touches is added to the set (it is mutated in place by design so the caller sees what was
 * tried).
 */
export async function tryFallback(
	failed: Track,
	preferred: SourceId | undefined,
	signal?: AbortSignal,
	attempted?: Set<SourceId>
): Promise<Track | null> {
	const query = `${failed.artist} ${failed.title}`.trim();
	if (!query) return null;
	const order = fallbackOrder(failed.source, preferred, attempted);
	for (const src of order) {
		if (signal?.aborted) return null;
		// Mark this source as attempted for the episode BEFORE the await — even if it throws or
		// yields no playable URL, it must not be retried for the same song (CR-03).
		attempted?.add(src);
		try {
			const result = await searchAll(query, 1, onlySource(src), signal);
			if (signal?.aborted) return null;
			const candidates = dedupeBest(result.interleaved, src);
			// WR-06: a fuzzy upstream search can return a DIFFERENT song; adopting candidates[0]
			// unconditionally would silently auto-play the wrong track under the original's
			// identity (successful failover is silent by design). Gate adoption on a normalized
			// title+artist match before resolving, reusing dedupe's own key normalization.
			const stub = candidates.find((c) => sameSongKey(c, failed));
			if (!stub) continue;
			const resolved = await ensureTrackDetails(stub, signal);
			if (signal?.aborted) return null;
			if (resolved.audioUrl) return resolved;
		} catch {
			/* this source dry / threw — move on */
		}
	}
	return null;
}
