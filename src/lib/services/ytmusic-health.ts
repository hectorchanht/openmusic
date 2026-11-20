// ytmusic-health — the health gate for the YouTube Music upstream (InnerTube
// WEB_REMIX search via the /api/ytmusic/search route). Instance of the shared
// state machine in source-health.ts, added in the universal-gate rollout
// (2026-11-01). Vocabulary mirrors netease-health: this gate's distinctive
// failure is a DRY-equivalent (see below), exposed as recordDry.
//
// FAILURE SHAPE (from the adapter's real paths):
//   - search: a fetch reject / non-JSON body is recordFail (transport); a body
//     with NO musicShelfRenderer is contract drift (parseSearchEnvelope throws)
//     — also recordFail. A parsed envelope whose shelves yield ZERO playable
//     tracks is recordDry: YTM fuzzy-matches EVERY query (even gibberish gets
//     rows), so a shelf with no resolvable videoId anywhere is an upstream/row-
//     shape pathology, not a legit no-hit — netease's dry reasoning, one level
//     down. Rows > 0 is recordOk (instant recovery).
//   The page>1 early return makes NO upstream call and records NOTHING.
// Resolve is NOT wired, deliberately: on web it stamps a deterministic proxy
// url (no upstream JSON hop), and the stream leg behind it is bot-gated PER
// INVOCATION by YouTube (~25-50% of requests 502 even while the source is
// healthy — see ytmusic.ts loadRetries) — counting stream outcomes would gate
// a healthy source permanently. The lyrics fetch is a never-throw best-effort
// boundary by design and likewise says nothing reliable about source health.
import { createHealthGate, DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS } from './source-health';

/** Consecutive dry (shelf-present, zero-playable-row) search responses that trip the gate. */
export const DRY_THRESHOLD = DEFAULT_THRESHOLD;

/** How long the gate stays closed before it auto-opens for one probe. */
export const GATE_WINDOW_MS = DEFAULT_WINDOW_MS;

const gate = createHealthGate(DRY_THRESHOLD, GATE_WINDOW_MS);

export const ytmusicHealth = {
	/** Record a dry (shelf parsed, zero playable rows) search result. Same counter as a fail. */
	recordDry: () => gate.recordFail(),
	/** Record any other failed call (drift / transport). Same counter as a dry. */
	recordFail: () => gate.recordFail(),
	/** Record a healthy call — instant recovery: clears the streak AND the trip. */
	recordOk: () => gate.recordOk(),
	/** True while ytmusic should be SKIPPED (tripped AND still inside the window). */
	isGated: () => gate.isGated(),
	/** TEST-ONLY: clear all state so it cannot leak across tests. */
	__reset: () => gate.__reset()
};
