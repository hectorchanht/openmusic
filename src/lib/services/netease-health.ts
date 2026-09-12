// netease-health (Plan 26-05, NETEASE-01) — the health gate for the intermittently-dry netease
// search upstream (`api.qijieya.cn/meting/`).
//
// WHY: the qijieya Meting proxy periodically returns an EMPTY array for EVERY query for a while,
// then recovers (spikes 001/004 — it whiffed the first 7 queries in 001 and all of en-pop in 004).
// An empty array is a VALID "dry" response, not contract-drift (the adapter still THROWS on a
// non-array body). But a run of drys means netease is temporarily dead: every further call is a
// wasted /api/netease/search that only slows / strands the search fan-out.
//
// The state machine itself now lives in `source-health.ts` — it was extracted when kuwo needed the
// identical gate for a different failure mode (a persistent 526 from a broken upstream TLS cert).
// This module is the netease INSTANCE plus the one piece of netease-specific vocabulary: here a
// "failure" is a dry ([]) response, so `recordDry` is kept as the name the adapter and its tests
// already use.
import { createHealthGate, DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS } from './source-health';

/** Consecutive dry ([]) search responses that trip the gate. */
export const DRY_THRESHOLD = DEFAULT_THRESHOLD;

/** How long the gate stays closed before it auto-opens for one probe. */
export const GATE_WINDOW_MS = DEFAULT_WINDOW_MS;

const gate = createHealthGate(DRY_THRESHOLD, GATE_WINDOW_MS);

export const neteaseHealth = {
	/** Record a dry ([]) search result. Trips the gate once DRY_THRESHOLD consecutive drys accrue. */
	recordDry: () => gate.recordFail(),
	/** Record a non-empty (healthy) search result — instant recovery: clears the streak + the trip. */
	recordOk: () => gate.recordOk(),
	/** True while netease should be SKIPPED (tripped AND still inside the window). */
	isGated: () => gate.isGated(),
	/** TEST-ONLY: clear all state so it cannot leak across tests. */
	__reset: () => gate.__reset()
};
