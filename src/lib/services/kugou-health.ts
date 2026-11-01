// kugou-health — the health gate for the Kugou upstream (song_search_v2 + the
// tracker/privilege url chain, via the dedicated /api/kugou/* routes). Instance of the
// shared state machine in source-health.ts, added in the universal-gate rollout
// (2026-11-01). Vocabulary mirrors netease-health: this is a DRY gate.
//
// FAILURE SHAPE (from the real routes, verified in src/routes/api/kugou/*):
//   - search: the route wraps the upstream in cachedUpstreamJson with an `empty`
//     fallback — an upstream outage therefore arrives at the adapter as a WELL-FORMED
//     {status:1, data:{lists:[]}} with ZERO rows, indistinguishable from a no-hit
//     search. That is exactly netease's dry shape, so an empty result counts as a dry
//     (recordDry) and rows count as recordOk. The accepted trade-off is netease's: a
//     run of genuinely unfindable queries can trip the gate for one window; Kugou's
//     catalogue answers rows for any real query, and the gate auto-probes back.
//     A body missing the {status:1, data:{lists}} anchor, or a fetch/parse throw, is
//     recordFail (contract drift / transport).
//   - resolve: the url route ALWAYS answers HTTP 200 JSON — {url:null} when every leg
//     refuses (paid song) — so a parsed body proves the route+upstream answered: url
//     obtained OR a well-formed refusal both recordOk. Only when EVERY ladder rung
//     fails at transport level (fetch reject / non-ok status / non-JSON body) does
//     resolve recordFail, once per resolve (never per rung).
import { createHealthGate, DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS } from './source-health';

/** Consecutive dry ([]) search responses that trip the gate. */
export const DRY_THRESHOLD = DEFAULT_THRESHOLD;

/** How long the gate stays closed before it auto-opens for one probe. */
export const GATE_WINDOW_MS = DEFAULT_WINDOW_MS;

const gate = createHealthGate(DRY_THRESHOLD, GATE_WINDOW_MS);

export const kugouHealth = {
	/** Record a dry ([]) search result. Trips the gate once DRY_THRESHOLD consecutive drys accrue. */
	recordDry: () => gate.recordFail(),
	/** Record any other failed call (drift / transport). Same counter as a dry. */
	recordFail: () => gate.recordFail(),
	/** Record a healthy call — instant recovery: clears the streak AND the trip. */
	recordOk: () => gate.recordOk(),
	/** True while kugou should be SKIPPED (tripped AND still inside the window). */
	isGated: () => gate.isGated(),
	/** TEST-ONLY: clear all state so it cannot leak across tests. */
	__reset: () => gate.__reset()
};
