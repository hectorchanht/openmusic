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
import { findOfficial, isAcceptableSubstitute } from '$lib/services/song-variant';
import { getEnabledAdapters, onlySource, isAutoResolveEligible } from '$lib/sources/registry';
import { isDeviceUid } from '$lib/services/device-track';
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
 * OFF-THE-HOT-PATH EXCLUSION (Plan 27-04, YT-RESILIENCE-01): a source flagged
 * `autoResolveEligible === false` (ytmusic — adversarial + IP-locked upstream, 27-CONTEXT) is NEVER
 * offered as a failover TARGET for a track it did not originate. The filter reads the REGISTRY FLAG,
 * not a literal id, so the "names NO source itself" invariant holds. Note this bars only the reverse
 * direction: a FAILED ytmusic track still falls FORWARD to the unchanged kuwo→qq→netease→joox floor
 * (ytmusic is the `failed` source there, dropped by the `s !== failed` clause regardless).
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
	const remaining = enabled.filter(
		// Plan 27-04: drop the failed source, every already-attempted source, AND every source flagged
		// off the auto-resolve floor (autoResolveEligible === false → ytmusic) so it can never become a
		// failover target. Registry-flag-driven — no source named here.
		// quick-260926-c69: predicate hoisted to registry.ts isAutoResolveEligible, behaviour identical.
		(s) => s !== failed && !attempted?.has(s) && isAutoResolveEligible(s)
	);
	if (preferred && remaining.includes(preferred)) {
		return [preferred, ...remaining.filter((s) => s !== preferred)];
	}
	return remaining;
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
	// 34-D-06 / RESEARCH Open Q2 / UI-SPEC Contract 8: an imported device file that will not play is the
	// USER'S OWN file gone missing or undecodable. Failover is SILENT by design, so substituting some
	// other recording scraped off a streaming source would tell the user their file played when it did
	// not — the opposite of the quick-260913-jq4 truthfulness posture ("the user sees why it won't
	// play"). Returning null routes the caller into its existing total-failure path, which skips with a
	// notice. The bar lives HERE, in the service, so every caller route — play(), the audio `error`
	// listener, handleDefinitiveFailure's retry — is covered by one line. `fallbackOrder` is untouched:
	// a device uid has no source to order from in the first place.
	if (isDeviceUid(failed.uid)) return null;
	const query = `${failed.artist} ${failed.title}`.trim();
	if (!query) return null;
	const order = fallbackOrder(failed.source, preferred, attempted);
	if (order.length === 0) return null;
	// quick-261020-race1: RACE instead of sequential walk. All sources launch in parallel;
	// the first to return a playable URL wins. Worst case drops from sum(latencies) to
	// max(latency) — typically 3s instead of 10s+. The per-source gates (sameSongKey,
	// isAcceptableSubstitute, findOfficial) still ensure authenticity; speed decides ties.
	// Mark every raced source attempted upfront (CR-03: tried once per episode).
	for (const src of order) attempted?.add(src);
	return raceSources(order, (src, sig) => tryOneSource(src, query, failed, sig), signal);
}

/**
 * Race N sources in parallel; resolve with the first valid (playable) result.
 * Losers are left to settle (their AbortSignal fires when the winner is picked).
 * Resolves null when every source fails or the outer signal aborts.
 */
function raceSources<T>(
	sources: SourceId[],
	tryFn: (src: SourceId, signal: AbortSignal) => Promise<T | null>,
	signal?: AbortSignal
): Promise<T | null> {
	// Already aborted — do not launch anything.
	if (signal?.aborted) return Promise.resolve(null);
	return new Promise((resolve) => {
		const ac = new AbortController();
		let remaining = sources.length;
		let done = false;
		const finish = (value: T | null) => {
			if (done) return;
			done = true;
			ac.abort(); // cancel the losers
			resolve(value);
		};
		const onAbort = () => finish(null);
		signal?.addEventListener('abort', onAbort, { once: true });
		for (const src of sources) {
			tryFn(src, ac.signal)
				.then((result) => {
					// A result counts only if it is playable (has audioUrl) — a resolved
					// stub without audio is not a win, keep racing the rest.
					if (result && (result as { audioUrl?: string }).audioUrl) finish(result);
					else if (--remaining === 0) finish(null);
				})
				.catch(() => {
					if (--remaining === 0) finish(null);
				});
		}
	});
}

/**
 * One source's attempt: search → gate → resolve. Never throws (returns null on any failure).
 */
async function tryOneSource(
	src: SourceId,
	query: string,
	failed: Track,
	signal: AbortSignal
): Promise<Track | null> {
	try {
		const result = await searchAll(query, 1, onlySource(src), signal);
		if (signal.aborted) return null;
		const candidates = dedupeBest(result.interleaved, src);
		// WR-06: a fuzzy upstream search can return a DIFFERENT song; adopting candidates[0]
		// unconditionally would silently auto-play the wrong track under the original's
		// identity (successful failover is silent by design). Gate adoption on a normalized
		// title+artist match before resolving, reusing dedupe's own key normalization.
		// TWO gates, and both are load-bearing. sameSongKey answers "same song?" — but it is built
		// on dedupe's key(), which deliberately STRIPS bracketed suffixes, so it also answers "yes"
		// for `告白氣球（純音樂版）` vs `告白氣球`. isAcceptableSubstitute answers the second
		// question, "same KIND of recording?", and keeps a failover from silently swapping in an
		// instrumental / karaoke / cover under the original's name. Live takes still pass.
		// quick-261020-off1: findOfficial tries the OFFICIAL pool first — even among
		// acceptable substitutes, the plain original outranks a live/remix/DJ variant.
		const stub = findOfficial(
			candidates,
			failed.title,
			(c) => sameSongKey(c, failed) && isAcceptableSubstitute(failed.title, c.title)
		);
		if (!stub) return null;
		const resolved = await ensureTrackDetails(stub, signal);
		if (signal.aborted) return null;
		return resolved.audioUrl ? resolved : null;
	} catch {
		return null;
	}
}
