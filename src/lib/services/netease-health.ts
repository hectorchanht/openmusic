// netease-health (Plan 26-05, NETEASE-01) — a pure, in-memory, never-throw health-gate for the
// intermittently-dry netease search upstream (`api.qijieya.cn/meting/`).
//
// WHY: the qijieya Meting proxy periodically returns an EMPTY array for EVERY query for a while,
// then recovers (spikes 001/004 — it whiffed the first 7 queries in 001 and all of en-pop in 004).
// An empty array is a VALID "dry" response, not a contract-drift (the adapter still THROWS on a
// non-array body). But a run of drys means netease is temporarily dead: every further call is a
// wasted /api/netease/search that only slows / strands the search fan-out. This tracker lets the
// adapter SHORT-CIRCUIT netease during a dry window, then automatically re-probe.
//
// DESIGN (mirrors cover-backfill's negative-miss cache + ttl-cache's reset-for-tests idiom):
//  - A consecutive-dry COUNTER trips the gate after DRY_THRESHOLD drys (T-26-05-01: stop the
//    fan-out-slowing wasted calls).
//  - The gate is held only for a BOUNDED window (GATE_WINDOW_MS). Once the window elapses isGated()
//    returns false so the adapter issues exactly ONE probe call, whose outcome (recordDry/recordOk)
//    re-decides the gate — guaranteeing netease is never hidden permanently (T-26-05-02).
//  - recordOk() (a non-empty result) clears the streak + trip IMMEDIATELY (instant recovery on a
//    real hit — T-26-05-02).
//  - PURE + in-memory: NO window / NO localStorage / NO runes. Plain module-scope counters + a
//    timestamp, so it is node-testable AND edge/SSR-safe (the app SSRs on Cloudflare). Never throws.
//
// Kept a plain `.ts` (not `.svelte.ts`) — no reactive UI reads this; the netease adapter calls it
// imperatively from search().

/** Consecutive dry ([]) search responses that trip the gate. Small so a genuine dry spell is caught
 *  fast, but >1 so a single fluke empty result never gates a healthy upstream. */
export const DRY_THRESHOLD = 3;

/** How long the gate stays closed (short-circuiting netease.search) before it auto-opens for one
 *  probe. ~60s: long enough that a dead upstream isn't hammered, short enough that recovery is fast.
 *  During a persistent outage the counter stays at/above the threshold, so the first dry probe after
 *  the window re-trips immediately — exactly ONE wasted call per window. */
export const GATE_WINDOW_MS = 60_000;

// Module-scope, in-memory state (no persistence — resets on reload, which is fine: a fresh session
// re-probes from scratch). Plain fields, never $state — nothing reactive reads them.
let consecutiveDry = 0;
let gateTrippedAt = 0; // wall-clock ms the gate last tripped; 0 = not tripped

export const neteaseHealth = {
	/** Record a dry ([]) search result. Trips the gate once DRY_THRESHOLD consecutive drys accrue. */
	recordDry(): void {
		consecutiveDry++;
		// Trip only on the transition (gateTrippedAt === 0) so a still-dry probe re-arms a FRESH
		// window rather than extending an old timestamp.
		if (consecutiveDry >= DRY_THRESHOLD && gateTrippedAt === 0) {
			gateTrippedAt = Date.now();
		}
	},

	/** Record a non-empty (healthy) search result — instant recovery: clears the streak + the trip. */
	recordOk(): void {
		consecutiveDry = 0;
		gateTrippedAt = 0;
	},

	/**
	 * True while netease should be SKIPPED (tripped AND still inside the window). Once the window
	 * elapses it clears the trip and returns false so the adapter issues one probe; the probe's
	 * outcome (recordDry/recordOk) re-decides. The consecutive-dry counter is deliberately LEFT at
	 * (>= threshold) on expiry so a single dry probe re-trips immediately — 1 wasted call per window
	 * during a persistent outage, not DRY_THRESHOLD.
	 */
	isGated(): boolean {
		if (gateTrippedAt === 0) return false;
		if (Date.now() - gateTrippedAt < GATE_WINDOW_MS) return true;
		// Window elapsed → open the gate for one probe (keep the dry counter so a dry probe re-trips).
		gateTrippedAt = 0;
		return false;
	},

	/** TEST-ONLY: clear all state so it cannot leak across tests (mirrors __clearSearchCache). */
	__reset(): void {
		consecutiveDry = 0;
		gateTrippedAt = 0;
	}
};
