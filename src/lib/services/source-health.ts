// source-health — a reusable, in-memory, never-throw health gate for a flaky upstream source.
//
// EXTRACTED from netease-health (Plan 26-05, NETEASE-01), whose logic was sound but hard-wired to
// one source. A second source then needed exactly the same treatment: `kw-api.cenguigui.cn` (kuwo)
// serves an INVALID TLS CERTIFICATE, so Cloudflare returns 526 for every request, persistently,
// at ~1.0s each. kuwo is FIRST in the resolve floor (kuwo-first, RESOLVE-01), so every cold resolve
// and every cross-source fallback walk burned that second on a source that cannot succeed.
//
// Rather than copy the gate (the duplication that let the freshness check go missing from four of
// five readiness guards), the state machine lives here once and each source gets its own instance.
//
// DESIGN (unchanged from 26-05, just parameterised):
//  - A consecutive-FAILURE counter trips the gate after `threshold` failures.
//  - The trip is held only for a BOUNDED window. Once it elapses `isGated()` returns false so the
//    adapter issues exactly ONE probe, whose outcome re-decides the gate — a source is therefore
//    NEVER hidden permanently (T-26-05-02).
//  - `recordOk()` clears streak + trip IMMEDIATELY (instant recovery on a real hit).
//  - PURE + in-memory: no window / no localStorage / no runes, so it is node-testable AND
//    edge/SSR-safe (the app SSRs on Cloudflare). Never throws.
//
// "Failure" is deliberately defined by the CALLER, because it differs per source: netease's failure
// is a VALID-but-empty array (a dry spell), kuwo's is a thrown 526. The gate only counts.

/** Consecutive failures that trip the gate. Small so a real outage is caught fast, but >1 so a
 *  single fluke never gates a healthy upstream. */
export const DEFAULT_THRESHOLD = 3;

/** How long the gate stays closed before auto-opening for one probe. ~60s: long enough not to
 *  hammer a dead upstream, short enough that recovery is fast. During a persistent outage the
 *  counter stays at/above threshold, so the first failing probe re-trips immediately — exactly ONE
 *  wasted call per window, not `threshold` of them. */
export const DEFAULT_WINDOW_MS = 60_000;

export interface HealthGate {
	/** Record a failed call (however this source defines failure). Trips once the streak hits the
	 *  threshold. */
	recordFail(): void;
	/** Record a healthy call — instant recovery: clears the streak AND the trip. */
	recordOk(): void;
	/** True while this source should be SKIPPED. Opens itself for one probe when the window
	 *  elapses. */
	isGated(): boolean;
	/** TEST-ONLY: clear all state so it cannot leak across tests (mirrors __clearSearchCache). */
	__reset(): void;
}

export function createHealthGate(
	threshold: number = DEFAULT_THRESHOLD,
	windowMs: number = DEFAULT_WINDOW_MS
): HealthGate {
	// Closure state, one set per instance. Plain fields, never $state — nothing reactive reads them.
	let consecutiveFail = 0;
	let trippedAt = 0; // wall-clock ms the gate last tripped; 0 = not tripped

	return {
		recordFail(): void {
			consecutiveFail++;
			// Trip only on the TRANSITION (trippedAt === 0) so a still-failing probe arms a FRESH
			// window rather than extending an old timestamp.
			if (consecutiveFail >= threshold && trippedAt === 0) trippedAt = Date.now();
		},

		recordOk(): void {
			consecutiveFail = 0;
			trippedAt = 0;
		},

		isGated(): boolean {
			if (trippedAt === 0) return false;
			if (Date.now() - trippedAt < windowMs) return true;
			// Window elapsed → open for one probe. The failure counter is deliberately LEFT at
			// (>= threshold) so a failing probe re-trips immediately on its single recordFail().
			trippedAt = 0;
			return false;
		},

		__reset(): void {
			consecutiveFail = 0;
			trippedAt = 0;
		}
	};
}
