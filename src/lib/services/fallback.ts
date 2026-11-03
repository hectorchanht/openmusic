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
import { cjkSearchQuery } from '$lib/services/dedupe';
import { rankAutoCandidates, candidateTier } from '$lib/services/song-variant';
import { SOURCES, getEnabledAdapters, onlySource, isAutoResolveEligible } from '$lib/sources/registry';
import { PRIORITY_WINDOW_MS } from '$lib/sources/source-order';
import { isDeviceUid } from '$lib/services/device-track';
import type { SourceId, Track } from '$lib/sources/types';

/**
 * Build the ordered list of source ids to try as a fallback, given the source that just failed.
 * Drops the failed source AND every source in `attempted` (sources already tried for this logical
 * song — CR-03); surfaces `preferred` first when set. Pure — exported for testability.
 *
 * ORDER: `getEnabledAdapters({})` order = source-order.ts PLAYBACK_ORDER (quick-261102-sqn; it
 * absorbed quick-261021-fb2's measured pass-rate ranking). An explicit user
 * `settings.preferredSource`, threaded in as `preferred`, still wins (hoisted first). This function
 * names NO source — change PLAYBACK_ORDER to change the floor.
 *
 * OFF-THE-HOT-PATH EXCLUSION (Plan 27-04, YT-RESILIENCE-01): a source flagged
 * `autoResolveEligible === false` (ytmusic — adversarial + IP-locked upstream, 27-CONTEXT) is NEVER
 * offered as a failover TARGET for a track it did not originate. The filter reads the REGISTRY FLAG,
 * not a literal id, so the "names NO source itself" invariant holds. Note this bars only the reverse
 * direction: a FAILED ytmusic track still falls FORWARD to the unchanged pass-rate floor
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
	// quick-261102-sqn (DECISIONS.md §5): no local rank table — getEnabledAdapters already returns
	// PLAYBACK_ORDER (registry SOURCES is built from it). The fb2 pass-rate ranking (joox/kuwo/kugou
	// > qq/netease/gdnetease/migu > suyin) IS that table now, shared with every other walk.
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
 * the caller's loop-guard counter engages — closing the unbounded A↔B ping-pong. The set is mutated
 * in place by design so the caller sees what was tried.
 *
 * quick-261102-exh1 (user report 2026-11-02 — the "not playable" bar): a source joins `attempted`
 * ONLY once it has been GENUINELY tried — its search pool was actually fetched and considered AND
 * a resolve was actually attempted on its best acceptable candidates (verdicts hit / rejected /
 * empty, see SourceVerdict). The old code marked the whole order attempted UP FRONT, but the race
 * aborts every loser the moment a winner is picked, so sources that never got a real attempt were
 * poisoned for the rest of the episode: when the winner's URL then failed at the audio layer, the
 * follow-up episode found an empty order and the song was skipped as unplayable although good
 * sources had never rejected it (J.Sheon《別問很可怕》 — skipped automatically, played fine from
 * a manual JOOX pick). Sources the race leaves INCONCLUSIVE instead get one sequential exhaustive
 * attempt (pass 2 in the body below) before this call may return null.
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
	// isAcceptableSubstitute, rankAcceptable) still ensure authenticity; speed decides ties.
	// quick-261103-cjk: one full race + exhaustive pass for ONE query string, extracted so
	// the bilingual-split pass below reuses it verbatim. `attempted` marking is per-pass:
	// a source genuinely tried under one query string is marked once, and the split pass
	// re-tries the whole order because a different query is a genuinely different attempt.
	const runPass = async (q: string): Promise<Track | null> => {
		const race = await raceSources(order, (src, sig) => walkSource(src, q, failed, sig), signal);
		// quick-261102-exh1: only GENUINELY tried sources join the attempted set (see the
		// doc-block above). A source the race aborted mid-flight or whose search threw was
		// never really tried — it stays eligible for this call's second pass AND for the
		// caller's next episode if this call's winner later fails at the audio layer.
		for (const src of order) {
			const v = race.verdicts.get(src);
			if (v && v !== 'inconclusive') attempted?.add(src);
		}
		if (race.hit) return race.hit.track;
		// Superseded (a newer play owns the session) or cut off by the caller's budget
		// watchdog — the caller discards this result either way; spend no second pass.
		if (signal?.aborted) return null;
		// EXHAUSTIVE SECOND PASS (quick-261102-exh1): every source the race left INCONCLUSIVE
		// (its search threw, or it was still in flight when the race finished) gets ONE
		// sequential attempt with the full candidate walk before this song may be called
		// unplayable. "Not playable" from here on means every eligible source genuinely
		// fetched its pool and had its best acceptable candidates resolved and refused —
		// never merely that the race ran out of patience with a slower good source.
		const sig = signal ?? new AbortController().signal;
		for (const src of order) {
			const v = race.verdicts.get(src);
			if (v && v !== 'inconclusive') continue;
			if (sig.aborted) return null;
			const attempt = await walkSource(src, q, failed, sig);
			if (attempt.verdict !== 'inconclusive') attempted?.add(src);
			if (attempt.hit) return attempt.hit.track;
		}
		return null;
	};
	const hit = await runPass(query);
	if (hit || signal?.aborted) return hit;
	// quick-261103-cjk (user report 2026-11-03): a bilingual title ("車匙 - Car Key")
	// defeats the strict CN search engines under its full spelling (live probe
	// 2026-11-03: junk or nothing on kuwo / migu / netease; the CJK half alone hits
	// the original), so a total miss earns ONE more pass with
	// the CJK-half search string (dedupe.cjkSearchQuery). walkSource's gates still
	// compare candidates against the FAILED track itself, so the split pool can only
	// adopt the same song by the same artist — never a stranger's same-title cover.
	const splitQuery = cjkSearchQuery(failed.artist, failed.title);
	if (splitQuery && splitQuery !== query) return runPass(splitQuery);
	return null;
}

/** One source's race result: the resolved track plus its candidate tier (song-variant). */
export interface FallbackHit {
	track: Track;
	/** 0 = official, plausible-length pick; 1 = variant and/or implausibly short. */
	tier: 0 | 1;
}

/**
 * Whether one source GENUINELY rejected the song (quick-261102-exh1 — the "not playable" bar):
 * - `hit`: a candidate resolved to a playable URL.
 * - `rejected`: the pool was fetched and considered, and either no candidate passed the
 *   identity/substitute/artist gates or every walked candidate's resolve failed to yield
 *   a URL. A pool whose only same-title rows are OTHER artists' covers lands here too
 *   (quick-261102-cov1): the covers are not a `hit`, and the source has genuinely
 *   rejected the ORIGINAL — the exhaustion accounting never credits their presence.
 * - `empty`: the pool was fetched and came back with zero rows (a health-gate short-circuit
 *   lands here too — the gate's own probe re-opens it on its 60s cycle).
 * - `inconclusive`: the source was NEVER really tried — its search threw, its per-source
 *   result is an upstream error, or the attempt was aborted before it could settle. An
 *   inconclusive source does NOT count as a rejection and is never marked attempted.
 */
export type SourceVerdict = 'hit' | 'rejected' | 'empty' | 'inconclusive';

/** One source's full attempt: the hit when it produced one, plus its verdict either way. */
interface SourceAttempt {
	hit: FallbackHit | null;
	verdict: SourceVerdict;
}

/** The race's outcome: the winning hit (if any) plus every SETTLED source's verdict. */
interface RaceOutcome {
	hit: FallbackHit | null;
	verdicts: Map<SourceId, SourceVerdict>;
}

/**
 * Race N sources in parallel; resolve with the best valid (playable) result.
 * Losers are left to settle (their AbortSignal fires when the winner is picked).
 * Resolves null when every source fails or the outer signal aborts.
 *
 * quick-261021-race2 (user): "parallel and race with prioritise".
 * Pure speed race lets a fast-but-unreliable source (suyin 0%) win over a slower
 * Tier-1 source (joox 100%) that returns 50ms later. Fix: when the first result
 * arrives, wait up to PRIORITY_WINDOW_MS for higher-priority sources (earlier in
 * the `sources` order, which fallbackOrder sorts by pass rate) to also return,
 * then pick the highest-priority valid result. If none arrive in the window,
 * the first result wins. Adds at most 300ms in the contested case, zero in the
 * common case (only one source returns).
 *
 * quick-261101-ring1: race2's window only arbitrated SOURCE priority — it could not
 * see candidate QUALITY. suyin answers in ONE direct fetch with the URL already
 * attached, while a tier-1 source needs search + resolve through the edge proxies,
 * so a suyin VARIANT (the 48s ringtone) routinely landed alone inside the 300ms
 * window and won over clean studio cuts that were still in flight. Results now
 * carry a candidate tier (song-variant.candidateTier): finish() prefers tier 0
 * over tier 1 BEFORE source order, and a tier-1 first arrival arms the much longer
 * DEGRADED window — a degraded hit is a last resort, so it waits for something
 * better; a tier-0 arrival shortens a pending long window back to the fast one.
 * All-sources-settled still finishes immediately, and the player's
 * FALLBACK_BUDGET_MS watchdog caps the total either way.
 */
const DEGRADED_PRIORITY_WINDOW_MS = 2500;
function raceSources(
	sources: SourceId[],
	tryFn: (src: SourceId, signal: AbortSignal) => Promise<SourceAttempt>,
	signal?: AbortSignal
): Promise<RaceOutcome> {
	// Already aborted — do not launch anything.
	if (signal?.aborted) return Promise.resolve({ hit: null, verdicts: new Map() });
	return new Promise((resolve) => {
		const ac = new AbortController();
		let remaining = sources.length;
		let done = false;
		// Collect valid results keyed by source; pick best (tier, then priority) at the end.
		const results = new Map<SourceId, FallbackHit>();
		// quick-261102-exh1: every source that SETTLES before the race finishes records its
		// verdict, so the caller can tell a genuine rejection from a source the race simply
		// ran out of patience with (still in flight at finish = absent from this map).
		const verdicts = new Map<SourceId, SourceVerdict>();
		const finish = () => {
			if (done) return;
			done = true;
			ac.abort();
			// Best tier first; within a tier, the highest-priority source (earliest in order).
			for (const tier of [0, 1] as const) {
				for (const src of sources) {
					const r = results.get(src);
					if (r && r.tier === tier && r.track.audioUrl) {
						resolve({ hit: r, verdicts });
						return;
					}
				}
			}
			resolve({ hit: null, verdicts });
		};
		const onAbort = () => {
			if (!done) {
				done = true;
				ac.abort();
				resolve({ hit: null, verdicts });
			}
		};
		signal?.addEventListener('abort', onAbort, { once: true });
		let windowTimer: ReturnType<typeof setTimeout> | null = null;
		let windowTier = Infinity;
		// Arm (or shorten) the pick window for an arriving result's tier. A longer
		// window already armed for a worse tier is replaced; an equal/better armed
		// window is left alone.
		const armWindow = (tier: 0 | 1) => {
			if (tier >= windowTier) return;
			if (windowTimer) clearTimeout(windowTimer);
			windowTier = tier;
			windowTimer = setTimeout(
				finish,
				tier === 0 ? PRIORITY_WINDOW_MS : DEGRADED_PRIORITY_WINDOW_MS
			);
		};
		for (const src of sources) {
			tryFn(src, ac.signal)
				.then((attempt) => {
					if (done) return;
					verdicts.set(src, attempt.verdict);
					if (attempt.hit && attempt.hit.track.audioUrl) {
						results.set(src, attempt.hit);
						armWindow(attempt.hit.tier);
					}
					if (--remaining === 0) {
						if (windowTimer) clearTimeout(windowTimer);
						finish();
					}
				})
				.catch(() => {
					// tryOneSource never throws by contract; a rejection here is a bug in an
					// attempt, which is by definition inconclusive — record it as such.
					if (!done) verdicts.set(src, 'inconclusive');
					if (--remaining === 0 && !done) {
						if (windowTimer) clearTimeout(windowTimer);
						finish();
					}
				});
		}
	});
}

/** How many of a source's acceptable candidates get a resolve attempt before the source
 * counts as a genuine rejection (quick-261102-exh1). The manual VersionPicker offers the
 * user EVERY row; three covers the realistic shapes (album cut + single cut + one spare)
 * without turning one dead source into a long serial stall inside the race. */
const MAX_CANDIDATE_RESOLVES = 3;

/**
 * One source's attempt: search → gate → resolve. Never throws.
 * On success the hit carries its candidate tier so the race can arbitrate quality,
 * not just speed (quick-261101-ring1). Either way the attempt carries its SourceVerdict
 * so the caller can tell a genuine rejection from a source that was never really
 * tried (quick-261102-exh1).
 */
export async function walkSource(
	src: SourceId,
	query: string,
	failed: Track,
	signal: AbortSignal
): Promise<SourceAttempt> {
	let result: Awaited<ReturnType<typeof searchAll>>;
	try {
		// quick-261021-fb1 (user): limit 1 was too aggressive — a source's top hit is often
		// a Live/DJ/instrumental variant that the gates reject, marking the source as
		// failed even though the official studio version is at #2 or #3. Fetch 8 and let
		// the ranking pick the right ones. Parallel race keeps it fast.
		result = await searchAll(query, 8, onlySource(src), signal);
	} catch {
		// The search itself never completed (transport failure / abort): this source
		// never got to consider the song — inconclusive, NOT a rejection.
		return { hit: null, verdict: 'inconclusive' };
	}
	if (signal.aborted) return { hit: null, verdict: 'inconclusive' };
	// searchAll isolates a source's own failure into its perSource entry (DATA-03): an
	// 'error' status means the upstream search threw (contract drift / 5xx) and produced
	// no pool at all — again never really tried, however empty `interleaved` looks.
	const settled = result.perSource.find((s) => s.source === src);
	if (settled && settled.status === 'error') return { hit: null, verdict: 'inconclusive' };
	// quick-261101-ring1: the ranking gets the RAW per-source rows, NOT dedupeBest's
	// collapse. dedupe's key() strips brackets, so dedupeBest had already collapsed
	// this source's clean cut and its ringtone/live/剪輯 variants into ONE winner chosen
	// by quality/first-order (every suyin row claims 320K) before the official/variant
	// partition ever ran — the partition was arbitrating a pool of one. The sameSongKey
	// predicate below is the identity gate, so uncollapsed rows are safe here.
	const candidates = result.interleaved;
	// quick-261102-sy0: a health-gated adapter short-circuits to [] WITHOUT asking upstream —
	// that is "never tried", not "the pool is empty". Counting it as tried poisoned the source
	// for the episode (the 別問很可怕 false-unplayable shape); it stays inconclusive and gets
	// the sequential pass (where the gate's own probe window may have reopened it).
	if (candidates.length === 0) {
		return { hit: null, verdict: SOURCES[src].health?.isGated() ? 'inconclusive' : 'empty' };
	}
	// WR-06: a fuzzy upstream search can return a DIFFERENT song; adopting candidates[0]
	// unconditionally would silently auto-play the wrong track under the original's
	// identity (successful failover is silent by design). Gate adoption on a normalized
	// title+artist match before resolving, reusing dedupe's own key normalization.
	// TWO gates, and both are load-bearing. sameSongKey answers "same song?" — but it is built
	// on dedupe's key(), which deliberately STRIPS bracketed suffixes, so it also answers "yes"
	// for `告白氣球（純音樂版）` vs `告白氣球`. isAcceptableSubstitute answers the second
	// question, "same KIND of recording?", and keeps a failover from silently swapping in an
	// instrumental / karaoke / cover under the original's name. Live takes still pass.
	// quick-261020-off1: the ranking tries the OFFICIAL pool first — even among
	// acceptable substitutes, the plain original outranks a live/remix/DJ variant.
	// quick-261101-ring1: it also walks plausible lengths before short clips, with the
	// failed track's own duration as the expectation when it carries one.
	// quick-261102-cov1: THIRD gate — the artist-identity gate (isAutoAcceptableArtist).
	// sameSongKey's artist half already refuses a plainly different artist today, but it
	// is a SHARED predicate whose looseness other consumers deliberately rely on (its own
	// caller audit says so), so the substitution seam states the artist rule explicitly:
	// a 同人 cover by a different artist is never adopted over the failed track, and a
	// covers-only pool ranks empty → verdict 'rejected' below (the covers do not count
	// as this source having the song). The identity term is `sameSongKey OR
	// sameSongByCredit`: sameSongKey's equal-shape artist rule excludes duet credits
	// outright, so a 周杰倫/蔡依林 original could never substitute for the 周杰倫
	// track — sameSongByCredit admits it via whole-segment containment (same title key
	// + same artist by credit), which still refuses every different act.
	// quick-261102-sy0: those three gates are ONE predicate now (song-variant isAutoAcceptable),
	// shared with the name-stub walk, discovery, JBSou and the edge resolve.
	const ranked = rankAutoCandidates(candidates, failed, { expectedSec: failed.duration });
	// The pool was genuinely fetched and considered; the gates refused every row in it.
	if (ranked.length === 0) return { hit: null, verdict: 'rejected' };
	// CANDIDATE WALK (quick-261102-exh1): resolve the acceptable rows in ranked order
	// until one yields a URL. Previously only the FIRST pick was resolved — a single
	// failed resolve (locked tier map, a positional-id mismatch like joox's `n`, one
	// transient detail error) burned the whole source even though its #2 row — the very
	// row a manual VersionPicker tap plays by id — was fine.
	for (const stub of ranked.slice(0, MAX_CANDIDATE_RESOLVES)) {
		if (signal.aborted) return { hit: null, verdict: 'inconclusive' };
		let resolved: Track;
		try {
			resolved = await ensureTrackDetails(stub, signal);
		} catch {
			if (signal.aborted) return { hit: null, verdict: 'inconclusive' };
			continue; // this candidate's resolve blew up — try the source's next row
		}
		if (signal.aborted) return { hit: null, verdict: 'inconclusive' };
		if (resolved.audioUrl) {
			return {
				hit: {
					track: resolved,
					tier: candidateTier(stub, failed.title, candidates, failed.duration)
				},
				verdict: 'hit'
			};
		}
	}
	// Every walked candidate was genuinely resolved and refused — a real rejection.
	return { hit: null, verdict: 'rejected' };
}
