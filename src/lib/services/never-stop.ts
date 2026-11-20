// never-stop — the pure decision core of the Never-Stop Engine (quick-261116-nstop,
// Car Mode plan Phase 1, grill Q1/Q8–Q14). When the systemic skip ceiling trips, playback
// must NOT stop: it enters a Fallback Interlude over the user's LOCAL tracks (Downloads
// first, Cached mixed in when the pool is small) while the streaming queue waits, saved,
// for a budgeted revival probe. Everything in this module is PURE, in-memory, never-throw
// and node-testable — the player store (player.svelte.ts) thin-calls it and owns all I/O
// (audio element, queue writes, timers). No runes, no window/localStorage, no imports
// beyond types.
//
// The three pieces:
//  1. orderFallbackPool — least-recently-played rotation over Downloads + Cached (Q13).
//  2. SourceCooldowns — per-source exponential cooldown for PROBE scheduling. Semantics
//     deliberately mirror createHealthGate (source-health.ts): a marked source is never
//     hidden permanently, one probe decides, markOk recovers instantly. The difference is
//     the window: health gates use a fixed 60s; an interlude probe that keeps failing must
//     back off exponentially (Q10) or a long outage still gets probed once per song.
//  3. ProbeBudget — at most ONE outstanding revival probe per interlude track (Q10). The
//     cap that used to stop playback now caps PROBING; local playback is uncapped.
import type { SourceId } from '$lib/sources/types';
import type { DefaultQuality } from '$lib/stores/settings.svelte';

/** Base cooldown after a source is first marked (ms). Matches the health-gate window. */
export const NS_COOLDOWN_BASE_MS = 60_000;
/** Cooldown ceiling (ms): exponential backoff never waits longer than ~15 min (Q10). */
export const NS_COOLDOWN_CAP_MS = 900_000;
/** Zero-asset retry probe interval (ms): with no local track to play, probe every 60s
 *  with no user action needed (Q14). */
export const NS_RETRY_PROBE_MS = 60_000;
/** A Downloads pool smaller than this mixes Cached tracks in evenly instead of appending
 *  them at the end (Q13: a small pool repeats too fast on its own). */
export const NS_SMALL_POOL = 5;

/**
 * Order the fallback pool (Q13): least-recently-played FIRST, no repeat until the pool is
 * exhausted (the caller tracks the played-this-cycle set; unplayed tracks always sort
 * before played ones). Recency comes from `historyUids`, the play-history uid list in
 * MOST-RECENT-FIRST order: a track absent from it was never played — the oldest of all —
 * so it leads. Downloads are the primary pool (downloaded = user-endorsed); Cached tracks
 * join only as filler — appended after Downloads when the pool is big enough, interleaved
 * 1:1 when Downloads alone are under NS_SMALL_POOL so a small pool varies sooner.
 *
 * Pure + never throws: malformed entries (no uid) are dropped, duplicates collapse to the
 * first occurrence (Downloads win over Cached for the same uid).
 */
export function orderFallbackPool<T extends { uid: string }>(
	downloads: readonly T[],
	cached: readonly T[],
	historyUids: readonly string[],
	playedUids: ReadonlySet<string> = new Set()
): T[] {
	const rank = new Map<string, number>();
	historyUids.forEach((uid, i) => {
		if (!rank.has(uid)) rank.set(uid, i);
	});
	// Oldest first: never-played (no rank) outranks every ranked track; among ranked tracks
	// the LARGER history index is the older play. Played-this-cycle always sorts last.
	const byAge = (a: T, b: T): number => {
		const pa = playedUids.has(a.uid) ? 1 : 0;
		const pb = playedUids.has(b.uid) ? 1 : 0;
		if (pa !== pb) return pa - pb;
		const ra = rank.has(a.uid) ? (rank.get(a.uid) as number) : Number.POSITIVE_INFINITY;
		const rb = rank.has(b.uid) ? (rank.get(b.uid) as number) : Number.POSITIVE_INFINITY;
		return rb - ra;
	};
	const seen = new Set<string>();
	const take = (list: readonly T[]): T[] => {
		const out: T[] = [];
		for (const t of list ?? []) {
			if (!t?.uid || seen.has(t.uid)) continue;
			seen.add(t.uid);
			out.push(t);
		}
		return out;
	};
	const dl = take(downloads).sort(byAge);
	const ca = take(cached).sort(byAge);
	if (dl.length >= NS_SMALL_POOL) return [...dl, ...ca];
	// Small pool: interleave Cached between Downloads so variety arrives early.
	const out: T[] = [];
	const n = Math.max(dl.length, ca.length);
	for (let i = 0; i < n; i++) {
		if (i < dl.length) out.push(dl[i]);
		if (i < ca.length) out.push(ca[i]);
	}
	return out;
}

interface CooldownEntry {
	streak: number;
	until: number; // wall-clock ms the source stays un-probeable until
}

/**
 * Per-source exponential cooldown tracker for revival-probe scheduling (Q10). A source is
 * marked when the systemic ceiling trips with it among the attempted/failed sources; each
 * failed probe re-marks it and the window doubles (base 60s → cap ~15 min). markOk clears
 * instantly, mirroring the health gate's recordOk. This tracker gates ONLY the interlude's
 * revival probes — normal playback and the per-source health gates are untouched.
 */
export class SourceCooldowns {
	private entries = new Map<SourceId, CooldownEntry>();

	/** Mark a source failed at `now`: streak + 1, cooldown window doubles from the base. */
	markFailed(source: SourceId, now: number): void {
		if (!source) return;
		const prev = this.entries.get(source);
		const streak = (prev?.streak ?? 0) + 1;
		const window = Math.min(NS_COOLDOWN_CAP_MS, NS_COOLDOWN_BASE_MS * 2 ** (streak - 1));
		this.entries.set(source, { streak, until: now + window });
	}

	/** Instant recovery (health-gate recordOk semantics): streak + cooldown cleared. */
	markOk(source: SourceId): void {
		this.entries.delete(source);
	}

	/** True while `source` is inside its cooldown window at `now`. Unmarked = never cooling. */
	isCooling(source: SourceId, now: number): boolean {
		const e = this.entries.get(source);
		return !!e && now < e.until;
	}

	/** True when a revival probe may run at `now`: no marks at all, or at least one marked
	 *  source has cooled down (the probe walks sources, so one eligible source is enough). */
	anyEligible(sources: readonly SourceId[], now: number): boolean {
		if (sources.length === 0) return true;
		return sources.some((s) => !this.isCooling(s, now));
	}

	/** The marked sources (for incident logging). */
	markedSources(): SourceId[] {
		return [...this.entries.keys()];
	}

	/** TEST-ONLY: clear all state so it cannot leak across tests. */
	__reset(): void {
		this.entries.clear();
	}
}

/**
 * Revival-probe budget (Q10): at most ONE probe may be earned per interlude track, and
 * tokens never accumulate — a long interlude track does not bank probes. The player grants
 * a token when an interlude (local) track starts and spends it at a track boundary when a
 * probe is due; a boundary with no token (or all sources still cooling) just plays the
 * next local track.
 */
export class ProbeBudget {
	private tokens = 0;

	/** An interlude track started: exactly one probe is now outstanding-able. */
	onInterludeTrackStart(): void {
		this.tokens = 1;
	}

	/** Spend the outstanding probe token. False when none is available. */
	tryConsume(): boolean {
		if (this.tokens <= 0) return false;
		this.tokens = 0;
		return true;
	}

	/** True when a probe token is outstanding (diagnostics/tests). */
	get pending(): boolean {
		return this.tokens > 0;
	}

	/** TEST-ONLY: clear all state so it cannot leak across tests. */
	__reset(): void {
		this.tokens = 0;
	}
}

// ─── Adaptive Pre-Buffer (quick-261116-prebuf, Car Mode plan Phase 2, Q7/Q15) ───────────
// The interlude pool above is only a safety net if it holds enough LOCAL audio to matter.
// Q15 (as corrected by Hector 2026-11-16: "一程車 Downloads 總長度 ≥30 分鐘 is enough"):
// the pool target is 30 MINUTES of playable local audio — one car trip. Users whose
// Downloads already reach it get NO pre-buffering (their data is not spent re-fetching
// what they own); users below it get their upcoming queue byte-buffered into the cache
// (never the Downloads library) until the pool tops up to the target. The four helpers
// below are the pure math of that: measure, plan, tier-cap, evict. The player owns the
// I/O (resolves, fetches, blobStore, the registry) and thin-calls them.

/** Local-pool target (seconds): 30 minutes of playable local audio (Q15, corrected). */
export const NS_POOL_TARGET_SEC = 30 * 60;
/** Per-track duration estimate (seconds) when NO track anywhere reports a duration:
 *  a typical ~3.5-minute song, rounded DOWN so an all-unknown pool over-delivers
 *  slightly rather than leaving the driver short. */
export const NS_DEFAULT_TRACK_SEC = 210;

/** One track's length in seconds: its real duration when finite and positive, else the
 *  supplied fallback (the pool average, or NS_DEFAULT_TRACK_SEC). Never throws. */
export function estimateTrackSec(
	duration: number | undefined | null,
	fallbackSec: number
): number {
	return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
		? duration
		: fallbackSec;
}

export interface PoolMeasure {
	/** Total playable local seconds (real durations + estimates for unknown ones). */
	totalSec: number;
	/** The per-track estimate applied to duration-less tracks: the average of every
	 *  KNOWN duration across both lists, or NS_DEFAULT_TRACK_SEC when none are known. */
	fallbackSec: number;
	/** How many tracks contributed a real duration. */
	knownTracks: number;
	/** How many tracks were estimated. */
	estimatedTracks: number;
}

/**
 * Measure the local pool (Q15): Downloads + byte-present Cached tracks. A track with no
 * reported duration is estimated at the pool's own average known duration — a user's
 * library is self-similar, so its average is a better guess than any global constant;
 * only a pool with NO known durations at all falls back to NS_DEFAULT_TRACK_SEC.
 * Pure + never throws: malformed entries are dropped, duplicates collapse (Downloads win).
 */
export function measureLocalPool(
	downloads: readonly { uid: string; duration?: number }[],
	cached: readonly { uid: string; duration?: number }[]
): PoolMeasure {
	const seen = new Set<string>();
	const all: { uid: string; duration?: number }[] = [];
	for (const t of [...(downloads ?? []), ...(cached ?? [])]) {
		if (!t?.uid || seen.has(t.uid)) continue;
		seen.add(t.uid);
		all.push(t);
	}
	let knownSum = 0;
	let knownTracks = 0;
	for (const t of all) {
		if (typeof t.duration === 'number' && Number.isFinite(t.duration) && t.duration > 0) {
			knownSum += t.duration;
			knownTracks++;
		}
	}
	const fallbackSec = knownTracks > 0 ? knownSum / knownTracks : NS_DEFAULT_TRACK_SEC;
	let totalSec = 0;
	for (const t of all) totalSec += estimateTrackSec(t.duration, fallbackSec);
	return {
		totalSec,
		fallbackSec,
		knownTracks,
		estimatedTracks: all.length - knownTracks
	};
}

/**
 * Plan a top-up (Q15): walk `upcoming` IN QUEUE ORDER and take the prefix whose estimated
 * durations close the gap between `poolSec` and `targetSec` (the last taken track may
 * overshoot — a whole track is the smallest bufferable unit). Uids in `skipUids`
 * (already downloaded / already buffered / the playing track) are passed over and do
 * not count toward the gap. An already-full pool plans nothing — that is the Q15
 * no-wasted-data gate. Pure + never throws.
 */
export function planBufferTopUp<T extends { uid: string; duration?: number }>(
	poolSec: number,
	targetSec: number,
	upcoming: readonly T[],
	skipUids: ReadonlySet<string> = new Set(),
	fallbackSec: number = NS_DEFAULT_TRACK_SEC
): T[] {
	if (!(poolSec < targetSec)) return [];
	const out: T[] = [];
	let acc = poolSec;
	for (const t of upcoming ?? []) {
		if (acc >= targetSec) break;
		if (!t?.uid || skipUids.has(t.uid)) continue;
		out.push(t);
		acc += estimateTrackSec(t.duration, fallbackSec);
	}
	return out;
}

/**
 * The buffer tier cap (Q7): buffered bytes are capped at the 320K tier even when the
 * user's download quality is 'lossless' or 'auto' (best-available) — in a car the
 * difference is inaudible over Bluetooth + road noise, and 320K buffers 3–4x faster.
 * An explicit '128' choice is a data-saving decision and is respected, never upscaled.
 * The tier is threaded through ensureTrackDetails per call (the WR-07 seam
 * probeDownload/downloadTrack use), so no settings value is ever mutated.
 */
export function bufferTierFor(downloadQuality: DefaultQuality): DefaultQuality {
	return downloadQuality === '128' ? '128' : '320';
}

export interface BufferEntryLike {
	uid: string;
	/** Wall-clock ms the entry was buffered (LRU key: oldest evicts first). */
	at: number;
	/** The entry's measured/estimated seconds in the pool. */
	sec: number;
}

/**
 * Plan cache evictions: when the buffered entries alone exceed `keepSec`, evict
 * OLDEST-first until the remainder fits. Entries whose uid is in `protectedUids`
 * (tracks that are now real Downloads) are NEVER returned — their bytes belong to
 * the download, and the caller merely unregisters them. Pure + never throws.
 */
export function planBufferEvictions<T extends BufferEntryLike>(
	entries: readonly T[],
	protectedUids: ReadonlySet<string> = new Set(),
	keepSec: number = NS_POOL_TARGET_SEC
): T[] {
	const list = [...(entries ?? [])].filter((e) => e?.uid);
	let total = 0;
	for (const e of list) total += e.sec > 0 ? e.sec : 0;
	if (total <= keepSec) return [];
	const evict: T[] = [];
	const oldestFirst = list
		.filter((e) => !protectedUids.has(e.uid))
		.sort((a, b) => a.at - b.at);
	for (const e of oldestFirst) {
		if (total <= keepSec) break;
		evict.push(e);
		total -= e.sec > 0 ? e.sec : 0;
	}
	return evict;
}
