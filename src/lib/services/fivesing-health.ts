// fivesing-health — the health gate for the 5sing upstream (Kugou UGC, via the
// dedicated /api/fivesing/* routes). Instance of the shared state machine in
// source-health.ts, added in the universal-gate rollout (2026-11-01). Vocabulary
// mirrors netease-health: this is a DRY gate.
//
// FAILURE SHAPE (from the real routes, verified in src/routes/api/fivesing/*):
//   - search: the route wraps the upstream in cachedUpstreamJson with an
//     `empty: {list: []}` fallback — an upstream outage arrives as a WELL-FORMED
//     empty list, indistinguishable from a no-hit search: netease's dry shape.
//     Empty → recordDry; rows → recordOk (instant recovery). Accepted trade-off is
//     netease's: a run of unfindable queries can trip the gate for one window; the
//     UGC catalogue answers rows for any real query and the gate auto-probes back.
//     A body missing the {list} anchor, or a fetch/parse throw, is recordFail.
//   - resolve: the url route converts an upstream failure into HTTP 200
//     {code:0, data:{}} — so the adapter's existing failure branch (code!==1000 /
//     no data) IS this leg's outage shape and recordFails. A code:1000 body whose
//     tiers are ALL empty is a per-song miss from a live upstream: recordOk, then
//     the adapter throws as before. A transport throw recordFails too.
import { createHealthGate, DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS } from './source-health';

/** Consecutive dry ([]) search responses that trip the gate. */
export const DRY_THRESHOLD = DEFAULT_THRESHOLD;

/** How long the gate stays closed before it auto-opens for one probe. */
export const GATE_WINDOW_MS = DEFAULT_WINDOW_MS;

const gate = createHealthGate(DRY_THRESHOLD, GATE_WINDOW_MS);

export const fivesingHealth = {
	/** Record a dry ([]) search result. Trips the gate once DRY_THRESHOLD consecutive drys accrue. */
	recordDry: () => gate.recordFail(),
	/** Record any other failed call (drift / transport / bad resolve envelope). Same counter. */
	recordFail: () => gate.recordFail(),
	/** Record a healthy call — instant recovery: clears the streak AND the trip. */
	recordOk: () => gate.recordOk(),
	/** True while fivesing should be SKIPPED (tripped AND still inside the window). */
	isGated: () => gate.isGated(),
	/** TEST-ONLY: clear all state so it cannot leak across tests. */
	__reset: () => gate.__reset()
};
