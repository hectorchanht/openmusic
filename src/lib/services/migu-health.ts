// migu-health — the health gate for the Migu upstream (search_all.do + the three-leg
// listen-url chain, via the dedicated /api/migu/* routes). Instance of the shared state
// machine in source-health.ts, added in the universal-gate rollout (2026-11-01).
// Vocabulary mirrors netease-health: this is a DRY gate.
//
// FAILURE SHAPE (from the real routes, verified in src/routes/api/migu/*):
//   - search: the route wraps the upstream in cachedUpstreamJson with an EMPTY
//     fallback ({songResultData:{result:[]}}) — an upstream outage arrives as a
//     WELL-FORMED empty result, indistinguishable from a no-hit search: netease's dry
//     shape. Empty → recordDry; rows → recordOk (instant recovery). Accepted trade-off
//     is netease's: a run of unfindable queries can trip the gate for one window;
//     Migu's catalogue answers rows for any real query and the gate auto-probes back.
//     A body missing the {songResultData:{result}} anchor, or a fetch/parse throw, is
//     recordFail.
//   - resolve: the url route ALWAYS answers HTTP 200 JSON, {url:null} when all three
//     legs refuse — and refusal is commonly PER-SONG or REGION posture (Migu region-
//     gates its listen endpoints by egress IP while search stays fully live), so a
//     parsed body is NOT an outage signal: url obtained OR a well-formed refusal both
//     recordOk (the upstream answered). Only when EVERY tone rung fails at transport
//     level (fetch reject / non-ok status / non-JSON) does resolve recordFail, once
//     per resolve.
import { createHealthGate, DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS } from './source-health';

/** Consecutive dry ([]) search responses that trip the gate. */
export const DRY_THRESHOLD = DEFAULT_THRESHOLD;

/** How long the gate stays closed before it auto-opens for one probe. */
export const GATE_WINDOW_MS = DEFAULT_WINDOW_MS;

const gate = createHealthGate(DRY_THRESHOLD, GATE_WINDOW_MS);

export const miguHealth = {
	/** Record a dry ([]) search result. Trips the gate once DRY_THRESHOLD consecutive drys accrue. */
	recordDry: () => gate.recordFail(),
	/** Record any other failed call (drift / transport). Same counter as a dry. */
	recordFail: () => gate.recordFail(),
	/** Record a healthy call — instant recovery: clears the streak AND the trip. */
	recordOk: () => gate.recordOk(),
	/** True while migu should be SKIPPED (tripped AND still inside the window). */
	isGated: () => gate.isGated(),
	/** TEST-ONLY: clear all state so it cannot leak across tests. */
	__reset: () => gate.__reset()
};
