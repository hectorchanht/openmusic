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
