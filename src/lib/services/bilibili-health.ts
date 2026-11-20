// bilibili-health — the health gate for the Bilibili upstream (WBI-signed search
// via the /api/bilibili/search route). Instance of the shared state machine in
// source-health.ts, added in the universal-gate rollout (2026-11-01). Vocabulary
// mirrors netease-health: this is a DRY gate.
//
// WHY GATE A SOURCE THAT IS USUALLY DOWN FROM THE EDGE: bilibili's known posture
// is Cloudflare-edge risk-control (the health bot's baseline has it down, and the
// proxy header documents the gating). That is precisely the case a health gate
// exists for: instead of paying the doomed WBI search on EVERY fan-out for the
// whole session, the gate pays it once per window as a probe — and the moment
// the risk-control lift lets a probe through, recordOk restores the source with
// no deploy and no manual re-enable. The adapter's failure shapes fit the
// pattern cleanly (drift anchor + route empty-fallback), which is why bilibili
// is included rather than skipped.
//
// FAILURE SHAPE (from the real routes, verified in src/routes/api/bilibili/*):
//   - search: the route wraps the WBI fetch in cachedUpstreamJson with an EMPTY
//     fallback ({code:0, data:{result:[]}}) — an edge risk-control refusal
//     arrives as a WELL-FORMED empty result, indistinguishable from a no-hit
//     search: netease's dry shape. Empty → recordDry; rows → recordOk. A body
//     missing the {code:0, data:{result}} anchor (e.g. a -403 WBI/risk envelope
//     passed through), or a fetch/parse throw, is recordFail.
//   - resolve: the resolve route ALWAYS answers HTTP 200 JSON, {url:null} for
//     gone / region-locked / risk-controlled alike — indistinguishable per-song
//     vs outage, so a parsed refusal stays NEUTRAL (counts neither way). A url
//     present is recordOk; a transport throw (fetch reject / non-JSON) is
//     recordFail. Resolve is never gated (the kuwo rule).
import { createHealthGate, DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS } from './source-health';

/** Consecutive dry ([]) search responses that trip the gate. */
export const DRY_THRESHOLD = DEFAULT_THRESHOLD;

/** How long the gate stays closed before it auto-opens for one probe. */
export const GATE_WINDOW_MS = DEFAULT_WINDOW_MS;

const gate = createHealthGate(DRY_THRESHOLD, GATE_WINDOW_MS);

export const bilibiliHealth = {
	/** Record a dry ([]) search result. Trips the gate once DRY_THRESHOLD consecutive drys accrue. */
	recordDry: () => gate.recordFail(),
	/** Record any other failed call (drift / transport). Same counter as a dry. */
	recordFail: () => gate.recordFail(),
	/** Record a healthy call — instant recovery: clears the streak AND the trip. */
	recordOk: () => gate.recordOk(),
	/** True while bilibili should be SKIPPED (tripped AND still inside the window). */
	isGated: () => gate.isGated(),
	/** TEST-ONLY: clear all state so it cannot leak across tests. */
	__reset: () => gate.__reset()
};
